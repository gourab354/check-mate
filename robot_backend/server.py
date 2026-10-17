"""
FastAPI Server for Robotic Chess Opponent.
Provides:
- Live MJPEG video stream (raw + warped chessboard)
- REST API for game control, calibration, and servo jogging
- WebSocket for real-time telemetry and state synchronization
"""

import cv2
import json
import asyncio
import logging
from typing import List, Dict, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel

from .config import AppConfig, active_config
from .orchestrator import ChessOrchestrator
from .kinematics.arm_ik import JointAngles

logger = logging.getLogger("RobotServer")

app = FastAPI(title="Robotic Chess Opponent Server", version="1.0.0")

# Enable CORS for browser access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global orchestrator instance
orchestrator = ChessOrchestrator(active_config)

# Connected WebSocket clients
active_websockets: List[WebSocket] = []

def ws_event_broadcaster(event_data: Dict):
    """Callback from orchestrator to push events to all connected WebSocket clients."""
    payload = json.dumps(event_data)
    for ws in list(active_websockets):
        try:
            asyncio.run(ws.send_text(payload))
        except Exception:
            pass

orchestrator.subscribe(ws_event_broadcaster)

# ----------------- Video Streaming -----------------

def generate_video_stream(warped: bool = False):
    """MJPEG frame generator for browser stream."""
    while True:
        try:
            if warped:
                frame = orchestrator.detector.get_warped_board()
            else:
                frame = orchestrator.detector.get_annotated_feed_frame(
                    last_move=orchestrator.last_robot_move or orchestrator.last_player_move
                )

            ret, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            if not ret:
                continue

            frame_bytes = buffer.tobytes()
            yield (b"--frame\r\n"
                   b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n")
        except Exception as e:
            logger.error(f"Stream error: {e}")
            break


@app.get("/video_feed")
def video_feed():
    """Live raw camera stream with 4-corner calibration overlay."""
    return StreamingResponse(
        generate_video_stream(warped=False),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )


@app.get("/warped_feed")
def warped_feed():
    """Live rectified 800x800 top-down square chessboard view."""
    return StreamingResponse(
        generate_video_stream(warped=True),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )


# ----------------- Request Models -----------------

class NewGameRequest(BaseModel):
    robot_color: str = "black"

class CalibrateRequest(BaseModel):
    corners: List[List[float]]

class JogRequest(BaseModel):
    base: Optional[float] = None
    shoulder: Optional[float] = None
    elbow: Optional[float] = None
    wrist_pitch: Optional[float] = None
    wrist_roll: Optional[float] = None
    gripper: Optional[float] = None

class TestSquareRequest(BaseModel):
    square: str

class ManualMoveRequest(BaseModel):
    from_sq: str
    to_sq: str
    is_capture: bool = False


# ----------------- REST API Endpoints -----------------

@app.get("/api/status")
def get_status():
    """Returns complete state, FEN, turn, logs, and arm telemetry."""
    return orchestrator.get_full_state()


@app.post("/api/trigger")
def trigger_move():
    """Triggers move analysis just like physical GPIO push-button."""
    orchestrator.on_button_pressed()
    return {"status": "triggered", "state": orchestrator.state}


@app.post("/api/game/new")
def new_game(req: NewGameRequest):
    """Starts a new game with the robot playing White or Black."""
    orchestrator.start_new_game(robot_color=req.robot_color)
    return {"status": "started", "robot_color": req.robot_color}


@app.post("/api/calibrate")
def calibrate_corners(req: CalibrateRequest):
    """Saves updated 4-corner board calibration."""
    if len(req.corners) != 4:
        raise HTTPException(status_code=400, detail="Must provide exactly 4 corners [[x,y],...]")
    orchestrator.detector.update_corners(req.corners)
    orchestrator.config.vision.board_corners = req.corners
    orchestrator.config.save()
    # Update baseline with newly warped perspective
    orchestrator.move_detector.capture_baseline()
    return {"status": "calibrated", "corners": req.corners}


@app.post("/api/arm/home")
def arm_home():
    """Moves arm to safe resting home position."""
    success = orchestrator.arm.home()
    return {"success": success}


@app.post("/api/arm/gripper")
def arm_gripper(action: str):
    """action: 'open' or 'close'."""
    if action == "open":
        success = orchestrator.arm.open_gripper()
    elif action == "close":
        success = orchestrator.arm.close_gripper()
    else:
        raise HTTPException(status_code=400, detail="Action must be 'open' or 'close'")
    return {"success": success, "gripper": orchestrator.arm.current_angles.gripper}


@app.post("/api/arm/jog")
def arm_jog(req: JogRequest):
    """Jog individual servo joints from UI sliders."""
    curr = orchestrator.arm.current_angles
    target = JointAngles(
        base=req.base if req.base is not None else curr.base,
        shoulder=req.shoulder if req.shoulder is not None else curr.shoulder,
        elbow=req.elbow if req.elbow is not None else curr.elbow,
        wrist_pitch=req.wrist_pitch if req.wrist_pitch is not None else curr.wrist_pitch,
        wrist_roll=req.wrist_roll if req.wrist_roll is not None else curr.wrist_roll,
        gripper=req.gripper if req.gripper is not None else curr.gripper,
    )
    success = orchestrator.arm.move_smooth_to(target)
    return {"success": success, "current_angles": orchestrator.arm.current_angles.to_dict()}


@app.post("/api/arm/test_square")
def arm_test_square(req: TestSquareRequest):
    """Moves arm to hover above a named square (e.g. 'e4')."""
    success = orchestrator.arm.test_square(req.square)
    return {"success": success, "square": req.square}


@app.post("/api/arm/move")
def arm_manual_move(req: ManualMoveRequest):
    """Executes a pick and place move manually."""
    if orchestrator.arm.is_busy:
        raise HTTPException(status_code=400, detail="Arm is busy")
    
    import threading
    def _run():
        orchestrator.arm.execute_move(req.from_sq, req.to_sq, req.is_capture)
    threading.Thread(target=_run, daemon=True).start()
    return {"status": "started", "from": req.from_sq, "to": req.to_sq}


@app.post("/api/arm/relax")
def arm_relax():
    """Cuts PWM signals to rest servos."""
    orchestrator.arm.relax()
    return {"status": "relaxed"}


# ----------------- WebSocket -----------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_websockets.append(websocket)
    # Send initial state
    await websocket.send_text(json.dumps({
        "type": "init",
        "data": orchestrator.get_full_state()
    }))
    try:
        while True:
            data = await websocket.receive_text()
            # Handle incoming ping / commands if needed
    except WebSocketDisconnect:
        if websocket in active_websockets:
            active_websockets.remove(websocket)
    except Exception:
        if websocket in active_websockets:
            active_websockets.remove(websocket)


def start_server(host: str = "0.0.0.0", port: int = 5000):
    import uvicorn
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    start_server()
