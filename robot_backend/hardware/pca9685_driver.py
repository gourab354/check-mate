"""
PCA9685 16-Channel 12-Bit PWM Servo Driver for MG946R Servos.
Supports:
1. Real Raspberry Pi hardware via Adafruit PCA9685 / I2C
2. Mock / Virtual driver fallback for PC simulation and development
"""

import time
import math
import logging
from typing import Dict, List, Optional
from ..config import HardwareConfig, ServoChannelConfig, active_config

logger = logging.getLogger("PCA9685Driver")
logging.basicConfig(level=logging.INFO)

class BaseServoDriver:
    """Interface for Servo Controller."""
    def set_angle(self, channel: int, angle_deg: float) -> None:
        raise NotImplementedError

    def get_angle(self, channel: int) -> float:
        raise NotImplementedError

    def relax(self, channel: Optional[int] = None) -> None:
        """Turn off PWM signal to allow servos to rest/cool."""
        pass


class MockServoDriver(BaseServoDriver):
    """
    Virtual servo driver for simulation, PC development, and unit testing.
    Keeps track of all 16 channel angles in memory.
    """
    def __init__(self):
        self.angles: Dict[int, float] = {i: 90.0 for i in range(16)}
        logger.info("[MockServoDriver] Initialized virtual PCA9685 (Simulation mode).")

    def set_angle(self, channel: int, angle_deg: float) -> None:
        angle_deg = max(0.0, min(180.0, float(angle_deg)))
        self.angles[channel] = angle_deg

    def get_angle(self, channel: int) -> float:
        return self.angles.get(channel, 90.0)

    def relax(self, channel: Optional[int] = None) -> None:
        logger.info(f"[MockServoDriver] Relaxed channel: {channel if channel is not None else 'ALL'}")


class RealPCA9685Driver(BaseServoDriver):
    """
    Hardware driver using Adafruit CircuitPython PCA9685 or smbus2 on Raspberry Pi.
    """
    def __init__(self, hw_config: HardwareConfig):
        self.config = hw_config
        self.angles: Dict[int, float] = {i: 90.0 for i in range(16)}
        self.pca = None
        self._init_hardware()

    def _init_hardware(self):
        try:
            import board
            import busio
            from adafruit_pca9685 import PCA9685

            i2c = busio.I2C(board.SCL, board.SDA)
            self.pca = PCA9685(i2c, address=self.config.pca9685_address)
            self.pca.frequency = self.config.pwm_frequency_hz
            logger.info(f"[RealPCA9685Driver] Connected to PCA9685 at 0x{self.config.pca9685_address:02X} on RPi I2C bus.")
        except Exception as e:
            logger.error(f"[RealPCA9685Driver] Hardware initialization error: {e}")
            raise e

    def _angle_to_duty_cycle(self, angle_deg: float, min_us: int = 500, max_us: int = 2500) -> int:
        """
        Convert angle (0-180 deg) to 16-bit duty cycle (0-65535) for PCA9685.
        At 50Hz, period = 20,000 us.
        """
        pulse_us = min_us + (angle_deg / 180.0) * (max_us - min_us)
        # 16-bit range: 65535 corresponds to 20,000 us (100% duty cycle)
        duty = int((pulse_us / 20000.0) * 65535)
        return max(0, min(65535, duty))

    def set_angle(self, channel: int, angle_deg: float) -> None:
        angle_deg = max(0.0, min(180.0, float(angle_deg)))
        self.angles[channel] = angle_deg
        if self.pca:
            duty = self._angle_to_duty_cycle(angle_deg)
            self.pca.channels[channel].duty_cycle = duty

    def get_angle(self, channel: int) -> float:
        return self.angles.get(channel, 90.0)

    def relax(self, channel: Optional[int] = None) -> None:
        if self.pca:
            if channel is not None:
                self.pca.channels[channel].duty_cycle = 0
            else:
                for ch in self.pca.channels:
                    ch.duty_cycle = 0


def create_servo_driver(hw_config: Optional[HardwareConfig] = None) -> BaseServoDriver:
    """
    Factory function: returns RealPCA9685Driver on Raspberry Pi if available,
    or falls back automatically to MockServoDriver.
    """
    cfg = hw_config or active_config.hardware
    if not cfg.use_mock_hardware:
        try:
            return RealPCA9685Driver(cfg)
        except Exception as e:
            logger.warning(f"Could not initialize real PCA9685 hardware ({e}). Falling back to MockServoDriver.")
    return MockServoDriver()
