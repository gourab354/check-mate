import os
import sys

# Ensure parent directory is in sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import argparse
import logging
import uvicorn
from robot_backend.config import active_config
from robot_backend.server import app, orchestrator

def main():
    parser = argparse.ArgumentParser(description="Robotic Chess Opponent Brain")
    parser.add_argument("--host", default=active_config.web_host, help="Host address to bind (default 0.0.0.0)")
    parser.add_argument("--port", type=int, default=active_config.web_port, help="Port to bind (default 5000)")
    parser.add_argument("--cli", action="store_true", help="Run purely in headless CLI mode without web server")
    args = parser.parse_args()

    print("=" * 65)
    print("  [ROBOT] ROBOTIC CHESS OPPONENT (CheckMate Hardware Brain)")
    print("  Raspberry Pi 4 + PCA9685 + MG946R Servos + Zebronics Camera")
    print("=" * 65)

    if args.cli:
        print("\nStarting in headless CLI mode...")
        orchestrator.start_new_game(robot_color="black")
        print("Waiting for move button triggers. Press Ctrl+C to exit.")
        try:
            import time
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nShutting down arm and resting servos...")
            orchestrator.arm.relax()
    else:
        print(f"\n[+] Starting FastAPI & MJPEG Video Server at http://{args.host}:{args.port}")
        print(f"[+] Video Stream available at: http://{args.host}:{args.port}/video_feed")
        print(f"[+] Rectified Warped Board at: http://{args.host}:{args.port}/warped_feed")
        print(f"[+] WebSocket Telemetry at:    ws://{args.host}:{args.port}/ws")
        print("\nConnect with the CheckMate web companion dashboard in your browser!\n")
        uvicorn.run(app, host=args.host, port=args.port, log_level="info")

if __name__ == "__main__":
    main()
