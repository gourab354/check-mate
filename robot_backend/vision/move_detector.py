"""
Move Detection Module using Computer Vision & python-chess.
Compares before/after warped board frames, computes square delta metrics,
and correlates against python-chess legal moves for robust, fail-safe move detection.
"""

import cv2
import chess
import numpy as np
import logging
from typing import Dict, List, Tuple, Optional
from .board_detector import BoardDetector
from ..config import VisionConfig, active_config

logger = logging.getLogger("MoveDetector")

class MoveDetector:
    def __init__(self, detector: BoardDetector, config: Optional[VisionConfig] = None):
        self.detector = detector
        self.config = config or active_config.vision
        self.baseline_warped: Optional[np.ndarray] = None
        self.last_square_diffs: Dict[str, float] = {}

    def capture_baseline(self) -> np.ndarray:
        """Capture and store the settled board state as baseline."""
        warped = self.detector.get_warped_board()
        self.baseline_warped = warped.copy()
        logger.info("[MoveDetector] Captured fresh board baseline.")
        return self.baseline_warped

    def compute_square_diff(self, img1: np.ndarray, img2: np.ndarray, sq: str) -> float:
        """
        Computes composite visual change score between two frames for a specific square:
        - Grayscale intensity delta
        - HSV color change
        - Edge structural density change (Sobel)
        """
        patch1 = self.detector.extract_square_roi(img1, sq, margin_pct=0.18)
        patch2 = self.detector.extract_square_roi(img2, sq, margin_pct=0.18)

        # 1. Grayscale pixel diff
        gray1 = cv2.cvtColor(patch1, cv2.COLOR_BGR2GRAY)
        gray2 = cv2.cvtColor(patch2, cv2.COLOR_BGR2GRAY)
        diff_gray = cv2.absdiff(gray1, gray2)
        mean_gray_diff = float(np.mean(diff_gray)) / 255.0

        # 2. HSV color difference
        hsv1 = cv2.cvtColor(patch1, cv2.COLOR_BGR2HSV)
        hsv2 = cv2.cvtColor(patch2, cv2.COLOR_BGR2HSV)
        diff_hsv = cv2.absdiff(hsv1, hsv2)
        mean_hsv_diff = float(np.mean(diff_hsv)) / 255.0

        # 3. Edge gradient difference
        edges1 = cv2.Canny(gray1, 50, 150)
        edges2 = cv2.Canny(gray2, 50, 150)
        edge_diff = float(np.mean(cv2.absdiff(edges1, edges2))) / 255.0

        # Composite weighted score (0.0 to 1.0)
        score = 0.45 * mean_gray_diff + 0.35 * mean_hsv_diff + 0.20 * edge_diff
        return score

    def evaluate_all_squares(self, current_warped: np.ndarray) -> Dict[str, float]:
        """Calculates visual delta score for all 64 squares."""
        if self.baseline_warped is None:
            self.baseline_warped = current_warped.copy()

        scores: Dict[str, float] = {}
        for file_char in "abcdefgh":
            for rank_char in "12345678":
                sq = f"{file_char}{rank_char}"
                score = self.compute_square_diff(self.baseline_warped, current_warped, sq)
                scores[sq] = round(score, 4)

        self.last_square_diffs = scores
        return scores

    def detect_move(self, board: chess.Board, current_warped: Optional[np.ndarray] = None) -> Tuple[Optional[chess.Move], float, Dict[str, float]]:
        """
        Detects which legal move was played by matching visual square deltas
        with the current position's legal moves in python-chess.

        Returns: (detected_move, confidence, square_scores_dict)
        """
        if current_warped is None:
            current_warped = self.detector.get_warped_board()

        scores = self.evaluate_all_squares(current_warped)
        legal_moves = list(board.legal_moves)

        if not legal_moves:
            logger.info("[MoveDetector] No legal moves available in current board position.")
            return None, 0.0, scores

        best_move = None
        best_score = -1.0
        second_best_score = -1.0

        for move in legal_moves:
            from_sq_name = chess.square_name(move.from_square)
            to_sq_name = chess.square_name(move.to_square)

            s_from = scores.get(from_sq_name, 0.0)
            s_to = scores.get(to_sq_name, 0.0)

            # Base score: source square changed (piece removed) + target square changed (piece arrived)
            candidate_score = s_from + s_to

            # Bonus for Castling: King moved 2 squares, Rook also moved!
            if board.is_castling(move):
                if move == chess.Move.from_uci("e1g1"):
                    candidate_score += scores.get("h1", 0.0) + scores.get("f1", 0.0)
                elif move == chess.Move.from_uci("e1c1"):
                    candidate_score += scores.get("a1", 0.0) + scores.get("d1", 0.0)
                elif move == chess.Move.from_uci("e8g8"):
                    candidate_score += scores.get("h8", 0.0) + scores.get("f8", 0.0)
                elif move == chess.Move.from_uci("e8c8"):
                    candidate_score += scores.get("a8", 0.0) + scores.get("d8", 0.0)

            # Bonus for En Passant: captured pawn removed from adjacent square
            if board.is_en_passant(move):
                ep_square = chess.square_name(chess.square(chess.square_file(move.to_square),
                                                           chess.square_rank(move.from_square)))
                candidate_score += scores.get(ep_square, 0.0)

            if candidate_score > best_score:
                second_best_score = best_score
                best_score = candidate_score
                best_move = move

        # Threshold check: both from_sq and to_sq must have noticeable change
        threshold = self.config.change_threshold * 1.5
        confidence = float(best_score)

        if best_score < threshold:
            logger.info(f"[MoveDetector] Highest score {best_score:.3f} below threshold {threshold:.3f}. No move detected.")
            return None, confidence, scores

        logger.info(f"[MoveDetector] Detected move {best_move.uci()} with score={best_score:.3f} (margin over 2nd={best_score - second_best_score:.3f})")
        return best_move, confidence, scores

    def commit_board_state(self, new_warped: Optional[np.ndarray] = None):
        """Update the baseline to the current settled board state after move is confirmed."""
        if new_warped is None:
            new_warped = self.detector.get_warped_board()
        self.baseline_warped = new_warped.copy()
