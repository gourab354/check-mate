"""
Analytical Inverse Kinematics (IK) for 5-DOF / 6-DOF Robotic Arm.
Specially designed for side-mounted or rear-mounted pick-and-place chess robotics.
Ensures vertical downward gripper approach for reliable chess piece handling.
"""

import math
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass
from ..config import AppConfig, active_config

@dataclass
class JointAngles:
    base: float         # 0 to 180 deg (Base Yaw)
    shoulder: float     # 0 to 180 deg (Shoulder Pitch)
    elbow: float        # 0 to 180 deg (Elbow Pitch)
    wrist_pitch: float  # 0 to 180 deg (Wrist Pitch, ensures vertical clamp)
    wrist_roll: float = 90.0  # Optional 5th axis
    gripper: float = 40.0     # Gripper angle (open/close)
    is_reachable: bool = True
    error_msg: str = ""

    def to_dict(self) -> Dict[str, float]:
        return {
            "base": round(self.base, 2),
            "shoulder": round(self.shoulder, 2),
            "elbow": round(self.elbow, 2),
            "wrist_pitch": round(self.wrist_pitch, 2),
            "wrist_roll": round(self.wrist_roll, 2),
            "gripper": round(self.gripper, 2),
            "is_reachable": self.is_reachable,
            "error_msg": self.error_msg
        }


class ChessKinematics:
    """
    Inverse and Forward Kinematics solver for chess robot arm.
    """

    def __init__(self, config: Optional[AppConfig] = None):
        self.config = config or active_config

    def square_to_board_xy(self, square_name: str) -> Tuple[float, float]:
        """
        Convert algebraic chess square (e.g. 'e4', 'a1', 'h8') to
        coordinates (X, Y) in mm on the physical board where (0,0) is
        the outer bottom-left corner of square a1.
        """
        sq = square_name.strip().lower()
        if sq.startswith("graveyard_white"):
            return (self.config.board.graveyard_white_x + self.config.board.arm_base_x_mm,
                    self.config.board.graveyard_white_y + self.config.board.arm_base_y_mm)
        if sq.startswith("graveyard_black"):
            return (self.config.board.graveyard_black_x + self.config.board.arm_base_x_mm,
                    self.config.board.graveyard_black_y + self.config.board.arm_base_y_mm)
        
        if len(sq) != 2:
            raise ValueError(f"Invalid square notation: {square_name}")

        col_char, row_char = sq[0], sq[1]
        col_idx = ord(col_char) - ord('a')  # 0 to 7 (files a-h)
        row_idx = int(row_char) - 1         # 0 to 7 (ranks 1-8)

        if not (0 <= col_idx <= 7 and 0 <= row_idx <= 7):
            raise ValueError(f"Square out of bounds: {square_name}")

        sq_size = self.config.board.square_size_mm
        # Center of square
        x = (col_idx + 0.5) * sq_size
        y = (row_idx + 0.5) * sq_size
        return (x, y)

    def square_to_robot_xyz(self, square_name: str, height_z_mm: float) -> Tuple[float, float, float]:
        """
        Convert chess square name and height (mm above board surface)
        into coordinates (X, Y, Z) in the robot arm's base coordinate frame.
        """
        sq = square_name.strip().lower()
        if sq.startswith("graveyard_white"):
            return (self.config.board.graveyard_white_x,
                    self.config.board.graveyard_white_y,
                    height_z_mm)
        if sq.startswith("graveyard_black"):
            return (self.config.board.graveyard_black_x,
                    self.config.board.graveyard_black_y,
                    height_z_mm)

        board_x, board_y = self.square_to_board_xy(sq)
        
        # Transform board coordinates into robot base frame
        # Robot base is at (arm_base_x_mm, arm_base_y_mm, arm_base_z_mm)
        robot_x = board_x - self.config.board.arm_base_x_mm
        robot_y = board_y - self.config.board.arm_base_y_mm
        robot_z = height_z_mm - self.config.board.arm_base_z_mm

        return (robot_x, robot_y, robot_z)

    def solve_ik(self, x: float, y: float, z: float, 
                 gripper_angle: Optional[float] = None,
                 wrist_approach_deg: float = -90.0) -> JointAngles:
        """
        Solve Inverse Kinematics for target (x, y, z) in mm relative to arm base.
        wrist_approach_deg = -90.0 means vertical downward gripper approach.
        """
        L1 = self.config.arm.link1_base_height
        L2 = self.config.arm.link2_upper_arm
        L3 = self.config.arm.link3_forearm
        L4 = self.config.arm.link4_wrist_gripper

        if gripper_angle is None:
            gripper_angle = self.config.hardware.gripper_open_angle

        # 1. Base Yaw Angle (theta_base)
        # Base angle depends on arm mounting orientation
        # In side_a mount: board is mostly +X direction relative to robot base
        # atan2(y, x): angle in radians
        yaw_rad = math.atan2(y, x)
        yaw_deg = math.degrees(yaw_rad)

        # Map yaw to 0-180 degree servo range with 90 deg being straight forward along +X
        if self.config.board.arm_mount == "side_a":
            # Looking towards +X (center of board). y > 0 is left/Black side, y < 0 is right/White side
            base_servo_deg = 90.0 + yaw_deg
        elif self.config.board.arm_mount == "side_h":
            # Looking towards -X (arm on File H side).
            base_servo_deg = 90.0 - (yaw_deg - 180.0 if yaw_deg > 0 else yaw_deg + 180.0)
        else: # "rear_black"
            # Looking towards -Y (arm behind rank 8).
            base_servo_deg = 90.0 + (yaw_deg + 90.0)

        # 2. Planar Projection (R, Z)
        # Horizontal radius from shoulder axis to target
        R = math.sqrt(x**2 + y**2)

        # Gripper orientation vector:
        # phi is the angle of link4 relative to horizontal in the arm's sagittal plane
        phi_rad = math.radians(wrist_approach_deg)

        # Wrist pivot position (Rw, Zw)
        Rw = R - L4 * math.cos(phi_rad)
        # Z relative to shoulder pivot (L1 above ground)
        Zw = z - L1 - L4 * math.sin(phi_rad)

        # Distance from shoulder pivot to wrist pivot
        D = math.sqrt(Rw**2 + Zw**2)

        # Check reachability limits
        max_reach = L2 + L3
        min_reach = abs(L2 - L3)

        if D > max_reach:
            return JointAngles(
                base=max(0.0, min(180.0, base_servo_deg)),
                shoulder=90.0, elbow=90.0, wrist_pitch=90.0,
                gripper=gripper_angle, is_reachable=False,
                error_msg=f"Target out of maximum reach (D={D:.1f}mm > {max_reach:.1f}mm)"
            )
        if D < min_reach:
            return JointAngles(
                base=max(0.0, min(180.0, base_servo_deg)),
                shoulder=90.0, elbow=90.0, wrist_pitch=90.0,
                gripper=gripper_angle, is_reachable=False,
                error_msg=f"Target too close to arm base (D={D:.1f}mm < {min_reach:.1f}mm)"
            )

        # 3. Law of Cosines for Shoulder and Elbow (Elbow-Up configuration)
        cos_beta = (L2**2 + L3**2 - D**2) / (2.0 * L2 * L3)
        cos_beta = max(-1.0, min(1.0, cos_beta))
        beta = math.acos(cos_beta)  # interior elbow angle

        cos_alpha = (L2**2 + D**2 - L3**2) / (2.0 * L2 * D)
        cos_alpha = max(-1.0, min(1.0, cos_alpha))
        alpha = math.acos(cos_alpha)

        gamma = math.atan2(Zw, Rw)

        # Shoulder angle relative to horizontal:
        theta2_rad = gamma + alpha
        theta2_deg = math.degrees(theta2_rad)

        # Elbow angle relative to upper arm:
        # When arm is straight, deflection is 0 deg. Full fold is 180 deg.
        theta3_deflection_deg = 180.0 - math.degrees(beta)

        # Map to servo angles (where 90 deg is standard reference)
        # Shoulder servo: 90 deg = upright vertical (45 to 135 typical range)
        shoulder_servo_deg = theta2_deg
        
        # Elbow servo: 90 deg = 90 deg bend
        elbow_servo_deg = theta3_deflection_deg

        # 4. Wrist Pitch Angle (keeps gripper vertical pointing downward)
        # Total link angle sum: theta2 + (-theta3_deflection) + theta4_rel = wrist_approach_deg (-90 deg)
        wrist_pitch_deg = wrist_approach_deg - (theta2_deg - theta3_deflection_deg)
        # Convert relative orientation to servo 0-180 range
        wrist_servo_deg = 90.0 - wrist_pitch_deg

        # Servo mechanical clamping (0 to 180 degrees)
        base_clamped = max(0.0, min(180.0, base_servo_deg))
        shoulder_clamped = max(10.0, min(170.0, shoulder_servo_deg))
        elbow_clamped = max(10.0, min(170.0, elbow_servo_deg))
        wrist_clamped = max(10.0, min(170.0, wrist_servo_deg))

        return JointAngles(
            base=base_clamped,
            shoulder=shoulder_clamped,
            elbow=elbow_clamped,
            wrist_pitch=wrist_clamped,
            wrist_roll=90.0,
            gripper=gripper_angle,
            is_reachable=True,
            error_msg=""
        )

    def solve_for_square(self, square_name: str, height_z_mm: float, 
                         gripper_angle: Optional[float] = None) -> JointAngles:
        """
        Directly solve IK for a named square (e.g. 'e4') at specified height.
        """
        x, y, z = self.square_to_robot_xyz(square_name, height_z_mm)
        return self.solve_ik(x, y, z, gripper_angle=gripper_angle)

    def plan_pick_and_place(self, from_sq: str, to_sq: str, is_capture: bool = False,
                            is_tall_piece: bool = False) -> List[JointAngles]:
        """
        Generate collision-free waypoint sequence of JointAngles for a complete chess move:
        1. Home position
        2. If capture: pick up opponent piece on to_sq, move to graveyard, release
        3. Pick up player piece on from_sq
        4. Carry piece above board at safe clearance height
        5. Place piece on to_sq
        6. Return to Home position (clearing camera view)
        """
        z_safe = self.config.arm.z_safe_travel
        z_hover = self.config.arm.z_hover
        z_grasp = self.config.arm.z_grasp_tall if is_tall_piece else self.config.arm.z_grasp_pawn
        grip_open = self.config.hardware.gripper_open_angle
        grip_closed = self.config.hardware.gripper_closed_angle

        waypoints: List[JointAngles] = []

        # Start from Home/Rest stance
        home_stance = JointAngles(
            base=90.0, shoulder=120.0, elbow=40.0, wrist_pitch=90.0,
            gripper=grip_open
        )
        waypoints.append(home_stance)

        # Step A: Handle Capture if necessary
        if is_capture:
            # Determine graveyard target
            grave_name = "graveyard_white" if to_sq[1] in "1234" else "graveyard_black"

            # 1. Hover above target capture square
            waypoints.append(self.solve_for_square(to_sq, z_safe, grip_open))
            waypoints.append(self.solve_for_square(to_sq, z_hover, grip_open))
            # 2. Lower & grasp
            waypoints.append(self.solve_for_square(to_sq, z_grasp, grip_open))
            waypoints.append(self.solve_for_square(to_sq, z_grasp, grip_closed))
            # 3. Lift to safe height
            waypoints.append(self.solve_for_square(to_sq, z_safe, grip_closed))
            # 4. Carry to Graveyard
            waypoints.append(self.solve_for_square(grave_name, z_safe, grip_closed))
            waypoints.append(self.solve_for_square(grave_name, self.config.board.graveyard_white_z, grip_closed))
            # 5. Release into Graveyard
            waypoints.append(self.solve_for_square(grave_name, self.config.board.graveyard_white_z, grip_open))
            waypoints.append(self.solve_for_square(grave_name, z_safe, grip_open))

        # Step B: Pick up piece from from_sq
        # 1. Hover above source piece
        waypoints.append(self.solve_for_square(from_sq, z_safe, grip_open))
        waypoints.append(self.solve_for_square(from_sq, z_hover, grip_open))
        # 2. Lower & grasp
        waypoints.append(self.solve_for_square(from_sq, z_grasp, grip_open))
        waypoints.append(self.solve_for_square(from_sq, z_grasp, grip_closed))
        # 3. Lift to safe travel height (avoids bumping other pieces!)
        waypoints.append(self.solve_for_square(from_sq, z_safe, grip_closed))

        # Step C: Move to to_sq
        # 4. Travel horizontally above destination
        waypoints.append(self.solve_for_square(to_sq, z_safe, grip_closed))
        waypoints.append(self.solve_for_square(to_sq, z_hover, grip_closed))
        # 5. Lower gently to board
        waypoints.append(self.solve_for_square(to_sq, z_grasp, grip_closed))
        # 6. Release gripper
        waypoints.append(self.solve_for_square(to_sq, z_grasp, grip_open))
        # 7. Lift up
        waypoints.append(self.solve_for_square(to_sq, z_safe, grip_open))

        # Step D: Return to Home (clears overhead camera sight)
        waypoints.append(home_stance)

        return waypoints
