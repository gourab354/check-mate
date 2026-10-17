"""
Webcam Board Detector & Perspective Warp.
Captures overhead webcam frames, performs 4-corner homography warp
to rectify the chessboard into a standardized 800x800 top-down square image,
and extracts 64 individual square regions.
"""

import cv2
import numpy as np
import logging
import threading
from typing import Dict, List, Tuple, Optional
from ..config import VisionConfig, active_config

logger = logging.getLogger("BoardDetector")

class BoardDetector:
    def __init__(self, config: Optional[VisionConfig] = None):
        self.config = config or active_config.vision
        self.cap = None
        self._lock = threading.Lock()
        self._is_running = True
        self._latest_raw_frame = None

        # 4 corners in original frame: TL, TR, BR, BL
        self.corners = np.array(self.config.board_corners, dtype=np.float32)
        self.warped_size = self.config.warped_size

        # Destination rectangle for 800x800 square
        self.dst_pts = np.array([
            [0, 0],
            [self.warped_size - 1, 0],
            [self.warped_size - 1, self.warped_size - 1],
            [0, self.warped_size - 1]
        ], dtype=np.float32)

        self._init_camera()

    def _init_camera(self):
        try:
            self.cap = cv2.VideoCapture(self.config.camera_index)
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.config.frame_width)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.config.frame_height)
            ret, frame = self.cap.read()
            if ret and frame is not None:
                self._latest_raw_frame = frame
                logger.info(f"[BoardDetector] Camera index {self.config.camera_index} opened successfully.")
            else:
                logger.warning(f"[BoardDetector] Camera index {self.config.camera_index} returned no frame. Using synthetic test board.")
                self._latest_raw_frame = self._generate_test_board()
        except Exception as e:
            logger.warning(f"[BoardDetector] Failed to open camera: {e}. Using synthetic test board.")
            self._latest_raw_frame = self._generate_test_board()

    def _generate_test_board(self) -> np.ndarray:
        """Generates a synthetic realistic chessboard image if webcam is not connected."""
        img = np.ones((720, 1280, 3), dtype=np.uint8) * 40
        # Draw board in center
        sq_size = 70
        board_offset_x = 360
        board_offset_y = 80
        for r in range(8):
            for c in range(8):
                x1 = board_offset_x + c * sq_size
                y1 = board_offset_y + r * sq_size
                is_light = (r + c) % 2 == 0
                color = (200, 215, 235) if is_light else (110, 140, 90)
                cv2.rectangle(img, (x1, y1), (x1 + sq_size, y1 + sq_size), color, -1)
                cv2.rectangle(img, (x1, y1), (x1 + sq_size, y1 + sq_size), (40, 50, 40), 1)

        cv2.putText(img, "TEST SIMULATION CAMERA FEED", (400, 50),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
        return img

    def read_raw_frame(self) -> np.ndarray:
        """Capture fresh raw frame from webcam or return latest synthetic frame."""
        with self._lock:
            if self.cap and self.cap.isOpened():
                ret, frame = self.cap.read()
                if ret and frame is not None:
                    self._latest_raw_frame = frame
                    return frame.copy()
            if self._latest_raw_frame is None:
                self._latest_raw_frame = self._generate_test_board()
            return self._latest_raw_frame.copy()

    def update_corners(self, corners_list: List[List[float]]) -> None:
        """
        Update 4 corner points from Web Dashboard calibration:
        corners_list: [[xTL, yTL], [xTR, yTR], [xBR, yBR], [xBL, yBL]]
        """
        if len(corners_list) == 4:
            self.corners = np.array(corners_list, dtype=np.float32)
            self.config.board_corners = corners_list
            logger.info(f"[BoardDetector] Calibration corners updated: {corners_list}")

    def get_warped_board(self, raw_frame: Optional[np.ndarray] = None) -> np.ndarray:
        """
        Applies homography perspective transform to obtain top-down 800x800 square board.
        """
        if raw_frame is None:
            raw_frame = self.read_raw_frame()

        M = cv2.getPerspectiveTransform(self.corners, self.dst_pts)
        warped = cv2.warpPerspective(raw_frame, M, (self.warped_size, self.warped_size))
        return warped

    def get_square_bounds(self, square_name: str) -> Tuple[int, int, int, int]:
        """
        Returns (x1, y1, x2, y2) pixel bounds in the 800x800 warped image.
        Rank 8 is at top (row 0), Rank 1 is at bottom (row 7).
        File a is at left (col 0), File h is at right (col 7).
        """
        sq = square_name.lower().strip()
        col = ord(sq[0]) - ord('a')       # 0..7
        row = 8 - int(sq[1])              # '8' -> 0, '1' -> 7

        sq_px = self.warped_size // 8     # 100 px
        x1 = col * sq_px
        y1 = row * sq_px
        x2 = x1 + sq_px
        y2 = y1 + sq_px
        return (x1, y1, x2, y2)

    def extract_square_roi(self, warped_board: np.ndarray, square_name: str, margin_pct: float = 0.15) -> np.ndarray:
        """
        Extracts image patch for a single chess square, trimming margins
        to eliminate borders and grid seams.
        """
        x1, y1, x2, y2 = self.get_square_bounds(square_name)
        w = x2 - x1
        h = y2 - y1
        mx = int(w * margin_pct)
        my = int(h * margin_pct)
        return warped_board[y1 + my : y2 - my, x1 + mx : x2 - mx]

    def get_annotated_feed_frame(self, highlighted_squares: Optional[List[str]] = None,
                                 last_move: Optional[str] = None) -> np.ndarray:
        """
        Generates live preview frame with:
        - 4 calibration corner circles and connecting polygon
        - Detected move overlay
        """
        frame = self.read_raw_frame().copy()

        # Draw calibration quadrilateral
        pts = self.corners.astype(np.int32).reshape((-1, 1, 2))
        cv2.polylines(frame, [pts], isClosed=True, color=(0, 255, 128), thickness=2)

        # Draw corner handles with indices
        corner_names = ["TL (a8)", "TR (h8)", "BR (h1)", "BL (a1)"]
        colors = [(255, 100, 0), (0, 200, 255), (0, 255, 0), (255, 0, 200)]
        for idx, (pt, name, col) in enumerate(zip(self.corners, corner_names, colors)):
            x, y = int(pt[0]), int(pt[1])
            cv2.circle(frame, (x, y), 8, col, -1)
            cv2.circle(frame, (x, y), 10, (255, 255, 255), 2)
            cv2.putText(frame, name, (x + 12, y + 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)
            cv2.putText(frame, name, (x + 12, y + 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, col, 1)

        if last_move:
            cv2.putText(frame, f"Last Move: {last_move}", (30, 40),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 4)
            cv2.putText(frame, f"Last Move: {last_move}", (30, 40),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 128), 2)

        return frame

    def release(self):
        if self.cap and self.cap.isOpened():
            self.cap.release()
