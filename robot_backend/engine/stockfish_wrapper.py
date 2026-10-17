"""
Stockfish UCI Engine Integration with Built-in Fallback Minimax AI.
Provides optimal chess move selection, position evaluation,
and configurable skill levels.
"""

import os
import shutil
import logging
import chess
import chess.engine
from typing import Tuple, Optional
from ..config import EngineConfig, active_config

logger = logging.getLogger("ChessEngine")

# Simple piece-square evaluation tables for fallback engine
PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 20000
}

class ChessEngineWrapper:
    def __init__(self, config: Optional[EngineConfig] = None):
        self.config = config or active_config.engine
        self.engine = None
        self.engine_path = self._find_stockfish()
        self._init_engine()

    def _find_stockfish(self) -> Optional[str]:
        # Check explicit config path
        if self.config.stockfish_path and os.path.isfile(self.config.stockfish_path):
            return self.config.stockfish_path

        # Check common system paths
        candidates = [
            shutil.which("stockfish"),
            "/usr/games/stockfish",
            "/usr/bin/stockfish",
            "/usr/local/bin/stockfish",
            "stockfish.exe",
            "C:\\Program Files\\Stockfish\\stockfish.exe"
        ]
        for c in candidates:
            if c and os.path.isfile(c):
                return c
        return None

    def _init_engine(self):
        if self.engine_path:
            try:
                self.engine = chess.engine.SimpleEngine.popen_uci(self.engine_path)
                # Configure UCI parameters
                try:
                    self.engine.configure({"Skill Level": self.config.skill_level})
                except Exception:
                    pass
                logger.info(f"[ChessEngine] Stockfish connected from {self.engine_path} (Skill Level={self.config.skill_level})")
            except Exception as e:
                logger.warning(f"[ChessEngine] Failed to spawn Stockfish at {self.engine_path}: {e}. Using fallback internal AI.")
                self.engine = None
        else:
            logger.info("[ChessEngine] Stockfish binary not found on system. Using built-in tactical Minimax AI.")

    def evaluate_material(self, board: chess.Board) -> int:
        """Heuristic evaluation for fallback minimax."""
        if board.is_checkmate():
            return -99999 if board.turn == chess.WHITE else 99999
        if board.is_stalemate() or board.is_insufficient_material():
            return 0

        score = 0
        for sq in chess.SQUARES:
            piece = board.piece_at(sq)
            if piece:
                val = PIECE_VALUES.get(piece.piece_type, 0)
                score += val if piece.color == chess.WHITE else -val
        return score

    def _minimax(self, board: chess.Board, depth: int, alpha: int, beta: int, is_maximizing: bool) -> Tuple[int, Optional[chess.Move]]:
        if depth == 0 or board.is_game_over():
            return self.evaluate_material(board), None

        best_move = None
        if is_maximizing:
            max_eval = -999999
            for move in board.legal_moves:
                board.push(move)
                eval_score, _ = self._minimax(board, depth - 1, alpha, beta, False)
                board.pop()
                if eval_score > max_eval:
                    max_eval = eval_score
                    best_move = move
                alpha = max(alpha, eval_score)
                if beta <= alpha:
                    break
            return max_eval, best_move
        else:
            min_eval = 999999
            for move in board.legal_moves:
                board.push(move)
                eval_score, _ = self._minimax(board, depth - 1, alpha, beta, True)
                board.pop()
                if eval_score < min_eval:
                    min_eval = eval_score
                    best_move = move
                beta = min(beta, eval_score)
                if beta <= alpha:
                    break
            return min_eval, best_move

    def get_best_move(self, board: chess.Board, time_limit: Optional[float] = None) -> Tuple[Optional[chess.Move], float]:
        """
        Calculates the best move and score for the current position.
        Returns: (best_move, eval_cp_or_score)
        """
        if board.is_game_over():
            return None, 0.0

        t_limit = time_limit or self.config.move_time_sec

        if self.engine:
            try:
                limit = chess.engine.Limit(time=t_limit, depth=self.config.depth)
                result = self.engine.play(board, limit)
                # Compute quick evaluation score
                info = self.engine.analyse(board, chess.engine.Limit(time=0.1))
                score_obj = info.get("score")
                score_cp = score_obj.white().score(mate_score=10000) / 100.0 if score_obj else 0.0
                return result.move, score_cp
            except Exception as e:
                logger.error(f"[ChessEngine] Stockfish play error: {e}. Falling back to internal minimax.")

        # Fallback minimax search (depth 3 is fast and solid)
        depth = 3
        is_max = (board.turn == chess.WHITE)
        score, move = self._minimax(board, depth, -999999, 999999, is_max)
        score_eval = score / 100.0
        return move, score_eval

    def close(self):
        if self.engine:
            try:
                self.engine.quit()
            except Exception:
                pass
