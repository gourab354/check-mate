"""
Robotic Chess Opponent - Configuration
Handles physical board dimensions, robotic arm kinematics parameters,
PCA9685 servo pin assignments, vision homography, and Stockfish engine settings.
"""

import os
import json
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Tuple, Optional

# Base directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

CALIBRATION_FILE = os.path.join(DATA_DIR, "calibration.json")
CONFIG_FILE = os.path.join(DATA_DIR, "robot_config.json")

@dataclass
class BoardConfig:
    # Size of each square on the physical board in millimeters
    square_size_mm: float = 45.0
    
    # Board orientation:
    # 'side_a': Arm mounted flanking File A (left side)
    # 'side_h': Arm mounted flanking File H (right side)
    # 'rear_black': Arm mounted behind Rank 8 (Black side)
    arm_mount: str = "side_a"
    
    # Arm base position relative to bottom-left corner of the board (a1 outer corner = 0,0,0) in mm:
    # If side_a: arm is to the left of file a (negative X), centered near rank 4-5
    arm_base_x_mm: float = -75.0
    arm_base_y_mm: float = 180.0
    arm_base_z_mm: float = 0.0

    # Graveyard / Capture drop zone coordinates (relative to arm base in mm)
    graveyard_white_x: float = -60.0
    graveyard_white_y: float = 70.0
    graveyard_white_z: float = 40.0

    graveyard_black_x: float = -60.0
    graveyard_black_y: float = -70.0
    graveyard_black_z: float = 40.0


@dataclass
class ArmDimensions:
    # Link lengths in millimeters for standard 5-6 DOF MG946R arm kit
    link1_base_height: float = 75.0   # Base to shoulder axis
    link2_upper_arm: float = 145.0    # Shoulder axis to elbow axis
    link3_forearm: float = 145.0      # Elbow axis to wrist axis
    link4_wrist_gripper: float = 95.0 # Wrist axis to gripper contact tip

    # Height levels in mm (relative to board surface Z = 0)
    z_safe_travel: float = 135.0      # High enough to clear all pieces (King ~75mm)
    z_hover: float = 75.0             # Pre-grasp alignment height
    z_grasp_pawn: float = 28.0        # Piece gripping height
    z_grasp_tall: float = 38.0        # Queen/King gripping height


@dataclass
class ServoChannelConfig:
    channel: int
    name: str
    min_angle: float = 0.0
    max_angle: float = 180.0
    default_angle: float = 90.0
    # PWM pulse width in microseconds (MG946R is typically 500us - 2500us)
    min_pulse_us: int = 500
    max_pulse_us: int = 2500
    # Direction inversion (+1 or -1)
    invert: bool = False
    trim_offset_deg: float = 0.0


@dataclass
class HardwareConfig:
    # PCA9685 I2C settings
    i2c_bus: int = 1
    pca9685_address: int = 0x40
    pwm_frequency_hz: int = 50
    use_mock_hardware: bool = False  # Auto-detected if I2C/RPi not found

    # Servo channel map
    servo_base: ServoChannelConfig = field(default_factory=lambda: ServoChannelConfig(
        channel=0, name="Base Yaw", default_angle=90.0
    ))
    servo_shoulder: ServoChannelConfig = field(default_factory=lambda: ServoChannelConfig(
        channel=1, name="Shoulder Pitch", default_angle=90.0
    ))
    servo_elbow: ServoChannelConfig = field(default_factory=lambda: ServoChannelConfig(
        channel=2, name="Elbow Pitch", default_angle=90.0
    ))
    servo_wrist_pitch: ServoChannelConfig = field(default_factory=lambda: ServoChannelConfig(
        channel=3, name="Wrist Pitch", default_angle=90.0
    ))
    servo_wrist_roll: ServoChannelConfig = field(default_factory=lambda: ServoChannelConfig(
        channel=4, name="Wrist Roll", default_angle=90.0
    ))
    servo_gripper: ServoChannelConfig = field(default_factory=lambda: ServoChannelConfig(
        channel=5, name="Gripper Clamp", min_angle=30.0, max_angle=120.0, default_angle=40.0
    ))

    # Gripper angles
    gripper_open_angle: float = 40.0
    gripper_closed_angle: float = 110.0

    # Motion speed parameters
    step_delay_sec: float = 0.015     # Delay between interpolation increments
    speed_deg_per_step: float = 2.0   # Max angle step per increment for smooth motion

    # Physical button pin (Raspberry Pi BCM GPIO)
    gpio_button_pin: int = 17


@dataclass
class VisionConfig:
    camera_index: int = 0
    frame_width: int = 1280
    frame_height: int = 720
    warped_size: int = 800            # Square 800x800 for 8x8 squares (100x100 each)
    
    # 4-corner board calibration points in camera frame [(x,y), ...]
    # Order: Top-Left, Top-Right, Bottom-Right, Bottom-Left
    board_corners: List[List[float]] = field(default_factory=lambda: [
        [160.0, 60.0],
        [1120.0, 60.0],
        [1120.0, 660.0],
        [160.0, 660.0]
    ])
    
    # Sensitivity threshold for square difference detection (0.0 to 1.0)
    change_threshold: float = 0.12
    # Number of settle frames to average before analyzing
    settle_frames_count: int = 5


@dataclass
class EngineConfig:
    # Stockfish executable path (auto-discovered if possible)
    stockfish_path: str = "/usr/games/stockfish"
    skill_level: int = 10             # 0 to 20
    depth: int = 12                   # Search depth
    move_time_sec: float = 1.0        # Max thinking time per move
    robot_plays_color: str = "black"  # 'white' or 'black'


@dataclass
class AppConfig:
    board: BoardConfig = field(default_factory=BoardConfig)
    arm: ArmDimensions = field(default_factory=ArmDimensions)
    hardware: HardwareConfig = field(default_factory=HardwareConfig)
    vision: VisionConfig = field(default_factory=VisionConfig)
    engine: EngineConfig = field(default_factory=EngineConfig)
    web_host: str = "0.0.0.0"
    web_port: int = 5000

    def save(self, filepath: str = CONFIG_FILE) -> None:
        """Save current configuration to JSON file."""
        data = asdict(self)
        with open(filepath, "w") as f:
            json.dump(data, f, indent=2)

    @classmethod
    def load(cls, filepath: str = CONFIG_FILE) -> "AppConfig":
        """Load configuration from JSON file or return defaults."""
        if os.path.exists(filepath):
            try:
                with open(filepath, "r") as f:
                    data = json.load(f)
                config = cls()
                if "board" in data:
                    config.board = BoardConfig(**data["board"])
                if "arm" in data:
                    config.arm = ArmDimensions(**data["arm"])
                if "vision" in data:
                    config.vision = VisionConfig(**data["vision"])
                if "engine" in data:
                    config.engine = EngineConfig(**data["engine"])
                return config
            except Exception as e:
                print(f"Warning: Could not load config from {filepath}: {e}. Using defaults.")
        return cls()


# Global active config instance
active_config = AppConfig.load()
