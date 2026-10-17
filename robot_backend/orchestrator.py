"""
Master Robotic Chess Orchestrator.
Coordinates the complete pipeline:
Webcam -> Board Detection -> Move Detection -> python-chess
  -> Stockfish -> Robotic Arm Controller (IK -> PCA9685 -> MG946R Servos)
"""

import time
import chess
import logging
import threading
from typing import Dict, List, Optional, Callable
from .config import AppConfig, active_config
from .hardware import ArmController, GPIOButtonTrigger
from .vision import BoardDetector, MoveDetector
from .engine import ChessEngineWrapper

logger = logging.getLogger("ChessOrchestrator")

class ChessOrchestrator:
    def __init__(self, config: Optional[AppConfig] = None):
        self.config = config or active_config

        # Subsystems
        self.board = chess.Board()
        self.detector = BoardDetector(self.config.vision)
        self.move_detector = MoveDetector(self.detector, self.config.vision)
        self.engine = ChessEngineWrapper(self.config.engine)
        self.arm = ArmController(self.config)
        self.gpio_trigger = GPIOButtonTrigger(
            pin=self.config.hardware.gpio_button_pin,
            callback=self.on_button_pressed
        )

        # State management
        self.state = "IDLE"  # IDLE, AWAITING_PLAYER, ANALYZING_VISION, STOCKFISH_THINKING, ARM_MOVING, GAME_OVER
        self.robot_color = chess.BLACK if self.config.engine.robot_plays_color.lower() == "black" else chess.WHITE
        self.last_player_move: Optional[str] = None
        self.last_robot_move: Optional[str] = None
        self.status_message = "Ready. Press Start Game."
        self.log_history: List[Dict] = []
        self._lock = threading.Lock()

        # Listeners for real-time web UI sync
        self.event_subscribers: List[Callable[[Dict], None]] = []

    def subscribe(self, callback: Callable[[Dict], None]):
        self.event_subscribers.append(callback)

    def _broadcast(self, event_type: str, data: Dict):
        payload = {
            "type": event_type,
            "state": self.state,
            "fen": self.board.fen(),
            "status_message": self.status_message,
            "timestamp": time.time(),
            **data
        }
        for sub in self.event_subscribers:
            try:
                sub(payload)
            except Exception:
                pass

    def log(self, text: str, level: str = "info"):
        entry = {"time": time.strftime("%H:%M:%S"), "text": text, "level": level}
        self.log_history.append(entry)
        if len(self.log_history) > 100:
            self.log_history.pop(0)
        logger.info(f"[{level.upper()}] {text}")
        self._broadcast("log", {"log": entry})

    def start_new_game(self, robot_color: str = "black"):
        with self._lock:
            self.board.reset()
            self.robot_color = chess.BLACK if robot_color.lower() == "black" else chess.WHITE
            self.config.engine.robot_plays_color = robot_color.lower()
            self.last_player_move = None
            self.last_robot_move = None

            self.log(f"New Game started! Robot plays {robot_color.upper()}.")
            
            # Park arm safely away from camera sight
            self.arm.home()
            time.sleep(0.5)

            # Settle and take initial clean baseline
            self.move_detector.capture_baseline()

            if self.board.turn == self.robot_color:
                self.state = "STOCKFISH_THINKING"
                threading.Thread(target=self._process_robot_turn, daemon=True).start()
            else:
                self.state = "AWAITING_PLAYER"
                self.status_message = "Your turn! Make a move on the board and press the button."
                self._broadcast("game_state", {})

    def on_button_pressed(self):
        """Called when physical push-button or web button is triggered."""
        with self._lock:
            if self.state not in ("AWAITING_PLAYER", "IDLE"):
                self.log(f"Button pressed but system is currently in state: {self.state}. Ignoring.", "warning")
                return

            self.state = "ANALYZING_VISION"
            self.status_message = "Scanning physical board..."
            self.log("Button triggered. Capturing overhead webcam frame...")
            self._broadcast("game_state", {})

        threading.Thread(target=self._process_player_turn, daemon=True).start()

    def _process_player_turn(self):
        try:
            # Let piece settle and settle camera
            time.sleep(0.3)
            current_warped = self.detector.get_warped_board()

            # Detect player move
            move, confidence, square_scores = self.move_detector.detect_move(self.board, current_warped)

            if move is None:
                self.log("Vision could not detect a valid legal chess move. Check board lighting or retry.", "error")
                with self._lock:
                    self.state = "AWAITING_PLAYER"
                    self.status_message = "Move not recognized! Please ensure move was completed and press button again."
                    self._broadcast("move_error", {"square_scores": square_scores})
                return

            move_san = self.board.san(move)
            uci = move.uci()
            self.last_player_move = uci
            self.log(f"Player move confirmed: {move_san} ({uci}) with confidence {confidence:.2f}")

            with self._lock:
                self.board.push(move)
                # Update baseline
                self.move_detector.commit_board_state(current_warped)

            self._broadcast("player_move_applied", {
                "move_uci": uci,
                "move_san": move_san,
                "square_scores": square_scores
            })

            # Check game termination
            if self._check_game_over():
                return

            # Trigger Robot's turn
            self._process_robot_turn()

        except Exception as e:
            logger.exception("Error during player turn analysis")
            self.log(f"Error analyzing move: {e}", "error")
            with self._lock:
                self.state = "AWAITING_PLAYER"
                self.status_message = "An error occurred during move detection."
                self._broadcast("game_state", {})

    def _process_robot_turn(self):
        try:
            with self._lock:
                self.state = "STOCKFISH_THINKING"
                self.status_message = "Stockfish is calculating best move..."
                self._broadcast("game_state", {})

            self.log("Stockfish evaluating position...")
            bot_move, eval_score = self.engine.get_best_move(self.board)

            if bot_move is None:
                self._check_game_over()
                return

            from_sq = chess.square_name(bot_move.from_square)
            to_sq = chess.square_name(bot_move.to_square)
            is_capture = self.board.is_capture(bot_move)
            moving_piece = self.board.piece_at(bot_move.from_square)
            is_tall = moving_piece is not None and moving_piece.piece_type in (chess.KING, chess.QUEEN)

            bot_san = self.board.san(bot_move)
            self.last_robot_move = bot_move.uci()

            self.log(f"Stockfish selected: {bot_san} ({bot_move.uci()}) [Eval: {eval_score:+.2f}] (Capture={is_capture})")

            with self._lock:
                self.state = "ARM_MOVING"
                self.status_message = f"Robot Arm moving {bot_san}..."
                self._broadcast("robot_thinking_done", {
                    "move_uci": bot_move.uci(),
                    "move_san": bot_san,
                    "eval": eval_score
                })

            # Execute arm movement
            def arm_status_cb(msg):
                self.log(f"[Arm] {msg}")

            success = self.arm.execute_move(
                from_sq=from_sq,
                to_sq=to_sq,
                is_capture=is_capture,
                is_tall_piece=is_tall,
                status_callback=arm_status_cb
            )

            # Special case for Castling: move the rook as well!
            if success and self.board.is_castling(bot_move):
                self.log("[Arm] Executing castling rook relocation...")
                if bot_move == chess.Move.from_uci("e1g1"):
                    self.arm.execute_move("h1", "f1", is_capture=False, status_callback=arm_status_cb)
                elif bot_move == chess.Move.from_uci("e1c1"):
                    self.arm.execute_move("a1", "d1", is_capture=False, status_callback=arm_status_cb)
                elif bot_move == chess.Move.from_uci("e8g8"):
                    self.arm.execute_move("h8", "f8", is_capture=False, status_callback=arm_status_cb)
                elif bot_move == chess.Move.from_uci("e8c8"):
                    self.arm.execute_move("a8", "d8", is_capture=False, status_callback=arm_status_cb)

            # Push move to python-chess board
            with self._lock:
                self.board.push(bot_move)

            # Arm is now parked back at home. Capture fresh settled baseline
            time.sleep(0.4)
            self.move_detector.commit_board_state()

            if self._check_game_over():
                return

            with self._lock:
                self.state = "AWAITING_PLAYER"
                self.status_message = "Robot move finished. Your turn!"
                self._broadcast("game_state", {})

            self.log("Robot move completed. Awaiting player's move.")

        except Exception as e:
            logger.exception("Error executing robot turn")
            self.log(f"Error executing robot turn: {e}", "error")
            with self._lock:
                self.state = "AWAITING_PLAYER"
                self.status_message = "Error occurred during robot movement."
                self._broadcast("game_state", {})

    def _check_game_over(self) -> bool:
        if self.board.is_game_over():
            with self._lock:
                self.state = "GAME_OVER"
                if self.board.is_checkmate():
                    winner = "Black" if self.board.turn == chess.WHITE else "White"
                    self.status_message = f"Checkmate! {winner} wins!"
                elif self.board.is_stalemate():
                    self.status_message = "Game drawn by Stalemate."
                elif self.board.is_insufficient_material():
                    self.status_message = "Game drawn by Insufficient Material."
                else:
                    self.status_message = "Game Over."
                self.log(f"Game Finished: {self.status_message}")
                self._broadcast("game_over", {"result": self.status_message})
            return True
        return False

    def get_full_state(self) -> Dict:
        return {
            "state": self.state,
            "fen": self.board.fen(),
            "turn": "white" if self.board.turn == chess.WHITE else "black",
            "robot_color": "black" if self.robot_color == chess.BLACK else "white",
            "last_player_move": self.last_player_move,
            "last_robot_move": self.last_robot_move,
            "status_message": self.status_message,
            "arm_telemetry": self.arm.get_state(),
            "corners": self.detector.corners.tolist(),
            "logs": self.log_history[-20:]
        }
