"""
High-Level Arm Controller.
Coordinates PCA9685 servos, smooth trajectory interpolation,
homing, pick-and-place, captures, and manual jogging.
"""

import time
import logging
from typing import Dict, List, Optional, Callable
from .pca9685_driver import BaseServoDriver, create_servo_driver
from ..kinematics.arm_ik import ChessKinematics, JointAngles
from ..config import AppConfig, active_config

logger = logging.getLogger("ArmController")

class ArmController:
    """
    Controls the physical / virtual robotic arm.
    """
    def __init__(self, config: Optional[AppConfig] = None, driver: Optional[BaseServoDriver] = None):
        self.config = config or active_config
        self.driver = driver or create_servo_driver(self.config.hardware)
        self.kinematics = ChessKinematics(self.config)

        # Track current actual joint angles
        self.current_angles = JointAngles(
            base=90.0,
            shoulder=120.0,
            elbow=40.0,
            wrist_pitch=90.0,
            wrist_roll=90.0,
            gripper=self.config.hardware.gripper_open_angle
        )

        self.is_busy = False
        self._stop_requested = False

        # Apply initial stance
        self._write_angles_direct(self.current_angles)

    def _write_angles_direct(self, angles: JointAngles) -> None:
        """Directly writes angles to driver channels taking inversion and trim into account."""
        hw = self.config.hardware

        def apply_channel(servo_cfg, angle):
            target = angle + servo_cfg.trim_offset_deg
            if servo_cfg.invert:
                target = 180.0 - target
            clamped = max(servo_cfg.min_angle, min(servo_cfg.max_angle, target))
            self.driver.set_angle(servo_cfg.channel, clamped)

        apply_channel(hw.servo_base, angles.base)
        apply_channel(hw.servo_shoulder, angles.shoulder)
        apply_channel(hw.servo_elbow, angles.elbow)
        apply_channel(hw.servo_wrist_pitch, angles.wrist_pitch)
        apply_channel(hw.servo_wrist_roll, angles.wrist_roll)
        apply_channel(hw.servo_gripper, angles.gripper)

    def move_smooth_to(self, target: JointAngles, step_callback: Optional[Callable[[JointAngles], None]] = None) -> bool:
        """
        Smoothly interpolates all joints from current_angles to target angles.
        Prevents jerky motion and dropping pieces.
        """
        if not target.is_reachable:
            logger.error(f"[ArmController] Target unreachable: {target.error_msg}")
            return False

        step_deg = self.config.hardware.speed_deg_per_step
        delay = self.config.hardware.step_delay_sec

        # Determine maximum angular delta across all joints
        d_base = abs(target.base - self.current_angles.base)
        d_shou = abs(target.shoulder - self.current_angles.shoulder)
        d_elb = abs(target.elbow - self.current_angles.elbow)
        d_wris = abs(target.wrist_pitch - self.current_angles.wrist_pitch)
        d_roll = abs(target.wrist_roll - self.current_angles.wrist_roll)
        d_grip = abs(target.gripper - self.current_angles.gripper)

        max_delta = max(d_base, d_shou, d_elb, d_wris, d_roll, d_grip)

        if max_delta < 0.5:
            self._write_angles_direct(target)
            self.current_angles = target
            return True

        num_steps = max(1, int(max_delta / step_deg))

        start = self.current_angles
        for i in range(1, num_steps + 1):
            if self._stop_requested:
                logger.warning("[ArmController] Movement interrupted by stop request.")
                return False

            alpha = i / float(num_steps)
            interp = JointAngles(
                base=start.base + alpha * (target.base - start.base),
                shoulder=start.shoulder + alpha * (target.shoulder - start.shoulder),
                elbow=start.elbow + alpha * (target.elbow - start.elbow),
                wrist_pitch=start.wrist_pitch + alpha * (target.wrist_pitch - start.wrist_pitch),
                wrist_roll=start.wrist_roll + alpha * (target.wrist_roll - start.wrist_roll),
                gripper=start.gripper + alpha * (target.gripper - start.gripper),
            )
            self._write_angles_direct(interp)
            self.current_angles = interp

            if step_callback:
                step_callback(interp)

            time.sleep(delay)

        self._write_angles_direct(target)
        self.current_angles = target
        return True

    def home(self) -> bool:
        """Move arm to safe resting home position away from overhead camera sight."""
        home_target = JointAngles(
            base=90.0,
            shoulder=120.0,
            elbow=40.0,
            wrist_pitch=90.0,
            wrist_roll=90.0,
            gripper=self.config.hardware.gripper_open_angle
        )
        return self.move_smooth_to(home_target)

    def open_gripper(self) -> bool:
        target = JointAngles(
            base=self.current_angles.base,
            shoulder=self.current_angles.shoulder,
            elbow=self.current_angles.elbow,
            wrist_pitch=self.current_angles.wrist_pitch,
            wrist_roll=self.current_angles.wrist_roll,
            gripper=self.config.hardware.gripper_open_angle
        )
        return self.move_smooth_to(target)

    def close_gripper(self) -> bool:
        target = JointAngles(
            base=self.current_angles.base,
            shoulder=self.current_angles.shoulder,
            elbow=self.current_angles.elbow,
            wrist_pitch=self.current_angles.wrist_pitch,
            wrist_roll=self.current_angles.wrist_roll,
            gripper=self.config.hardware.gripper_closed_angle
        )
        return self.move_smooth_to(target)

    def execute_move(self, from_sq: str, to_sq: str, is_capture: bool = False,
                     is_tall_piece: bool = False,
                     status_callback: Optional[Callable[[str], None]] = None) -> bool:
        """
        Execute full pick-and-place chess move sequence.
        """
        self.is_busy = True
        self._stop_requested = False

        try:
            if status_callback:
                status_callback(f"Planning motion for {from_sq} -> {to_sq} (Capture={is_capture})...")

            waypoints = self.kinematics.plan_pick_and_place(
                from_sq, to_sq, is_capture=is_capture, is_tall_piece=is_tall_piece
            )

            total = len(waypoints)
            for idx, wp in enumerate(waypoints):
                if self._stop_requested:
                    break
                if not wp.is_reachable:
                    msg = f"Cannot complete move: Waypoint #{idx+1} unreachable ({wp.error_msg})"
                    logger.error(msg)
                    if status_callback:
                        status_callback(msg)
                    return False

                if status_callback:
                    status_callback(f"Executing step {idx+1}/{total}...")
                
                success = self.move_smooth_to(wp)
                if not success:
                    return False
                time.sleep(0.05)

            if status_callback:
                status_callback(f"Move {from_sq}->{to_sq} completed successfully!")
            return True
        finally:
            self.is_busy = False

    def test_square(self, sq: str) -> bool:
        """Quick diagnostic: hovers arm directly above the chosen square."""
        wp = self.kinematics.solve_for_square(sq, self.config.arm.z_hover, self.config.hardware.gripper_open_angle)
        if not wp.is_reachable:
            logger.error(f"Cannot reach square {sq}: {wp.error_msg}")
            return False
        return self.move_smooth_to(wp)

    def stop(self) -> None:
        """Emergency stop: halts movement immediately."""
        self._stop_requested = True

    def relax(self) -> None:
        """Rest all servos (cuts PWM signals)."""
        self.driver.relax()

    def get_state(self) -> Dict:
        """Returns current telemetry for the web companion UI."""
        return {
            "current_angles": self.current_angles.to_dict(),
            "is_busy": self.is_busy,
            "mount": self.config.board.arm_mount,
            "gripper_open": abs(self.current_angles.gripper - self.config.hardware.gripper_open_angle) < 5.0
        }
