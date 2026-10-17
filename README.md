#  CheckMate — Fully Functional Offline Chess

**CheckMate** is a modern, feature-packed, and fully offline-capable chess game with an integrated AI engine (Minimax + Alpha-Beta Pruning + Quiescence search), realistic human-like bot reaction times, procedural Web Audio sound synthesis, digital chess clocks, real-time advantage evaluation bar, and PGN/FEN tools.

---

## 🚀 How to Run Offline

There are **two easy ways** to run CheckMate completely offline:

### Option 1: Direct Browser Launch (No Server Required)
Simply double-click `index.html` or open it directly in any modern web browser (Chrome, Edge, Firefox, Brave, Safari):
```
file:///c:/Users/goura/OneDrive/Desktop/projects/check-mate/index.html
```
- **100% Self-Contained**: All piece graphics are inline SVG vectors.
- **Zero External Dependencies**: No CDNs, no external fonts, no external audio files.

### Option 2: Local Server / PWA Mode
You can also launch it via npm:
```bash
npm start
```
Then visit `http://localhost:3000`. You can also install it as a standalone desktop app using the browser's "Install App" button (powered by `sw.js` and `manifest.json`).

---

##  Key Features

### 1.  Smart AI Engine ("StockBot") with Human-like Reaction Time
- **Realistic Thinking Delay**:
  - Instead of instant, robotic moves, the bot pauses and evaluates its moves naturally like a real human player sitting across the board (800ms - 2800ms with animated *Thinking...* status badge).
  - Customizable reaction speeds: **Realistic** (Human-like 1.0s – 2.5s), **Fast** (0.5s – 1.0s), or **Instant** (0.05s).
- **3 Balanced Difficulty Levels**:
  - **Easy (~800 Elo)**: Casual pacing with friendly blunders and accessible play for beginners.
  - **Medium (~1400 Elo)**: Balanced Minimax search with Piece-Square Tables (PST) positional evaluation.
  - **Hard (~1900 Elo)**: Deep tactical Alpha-Beta pruning with MVV-LVA move ordering and quiescence capture extension.
- **Move Hint Engine**: Suggests optimal tactical moves with animated glowing highlights on the board.

### 2.  Complete Chess Rules Engine
- **Legal Move Generation**: Strict adherence to official FIDE chess rules.
- **Special Moves**:
  - **Castling** (Kingside & Queenside) with pass-through check validation.
  - **En Passant** capture tracking.
  - **Pawn Promotion** modal dialog with Queen, Rook, Bishop, and Knight options.
- **Game Termination Detection**:
  - Checkmate & Stalemate.
  - 50-move rule counter (`halfmoveClock >= 100`).
  - Threefold repetition position detection.
  - Insufficient material draws (K vs K, K+B vs K, K+N vs K, K+B vs K+B same color).
- **Standard Algebraic Notation (SAN)**: Real-time notation with captures, disambiguation, checks (`+`), and mate (`#`).

### 3.  Digital Chess Clocks
- Choose from popular time controls:
  - **1 min** (Bullet)
  - **3 min** (Blitz)
  - **5 min** (Blitz)
  - **10 min** (Rapid - default)
  - **15 min** (Classical)
  - **Casual** (Unlimited time)
- Low-time alarm pulse when under 30 seconds.
- Automatic flag fall detection on timeout.

### 4.  Real-Time Evaluation Bar
- Displays White vs Black advantage in real time.
- Sigmoid-compressed dynamic height with numeric centipawn readout (e.g., `+1.4`, `-2.0`, `M+`).

### 5.  Procedural Web Audio Sound Effects
- Synthesizes organic sounds using the Web Audio API without needing external MP3 files:
  - Piece move clack
  - Piece capture knock
  - Check melodic chime
  - Castle slide
  - Game over victory / defeat chords
  - Illegal move buzz
- Mute / Unmute toggle button with saved preference in `localStorage`.

### 6.  Board Customization & Themes
- 4 curated board themes:
  - **Emerald & Ivory** (Modern tournament standard)
  - **Walnut & Maple** (Classic wooden elegance)
  - **Obsidian & Silver** (Dark luxury)
  - **Cyberpunk** (Neon cyan synthwave)
- Board flip toggle & optional auto-flip for 2-player pass-and-play.

### 7.  Move History & PGN / FEN Tools
- Interactive move history table: click on any past move to review board positions without disrupting the ongoing game.
- Full Undo & Redo functionality.
- Export & Copy PGN game records or download a `.pgn` file.
- Export & Import FEN strings to analyze or setup any position.

---

## 📁 Project Structure

```
check-mate/
├── index.html          # Main HTML structure with semantic layout & SVG icons
├── manifest.json       # PWA manifest for desktop/mobile installation
├── sw.js               # Service Worker for 100% offline caching
├── package.json        # NPM scripts for local development server
├── requirements.txt    # Python dependencies for Raspberry Pi & PC
├── setup_raspberry_pi.sh # 1-step Raspberry Pi 4 automated setup script
├── css/
│   ├── style.css       # Vanilla CSS glassmorphic design system & themes
│   └── robot.css       # Robotic companion dashboard styles & camera stream
├── js/
│   ├── pieces-svg.js   # Crisp Staunton vector pieces (inline SVGs)
│   ├── audio.js        # Web Audio API procedural sound synthesizer
│   ├── chess-engine.js # Complete chess rules, SAN notation, FEN, PGN
│   ├── chess-ai.js     # Minimax AI, Alpha-Beta, PST evaluation
│   ├── app.js          # UI controller, drag & drop, timers, game loop
│   └── robot-companion.js # Robot WebSocket controller, calibration, & servo jog
├── docs/
│   └── HARDWARE_WIRING.md # Wiring diagrams, pinouts, power supply recommendations
├── robot_backend/      # Python Raspberry Pi Brain
│   ├── config.py       # Board dimensions, link lengths, servo PWM settings
│   ├── main.py         # Entrypoint (CLI or Web Server)
│   ├── server.py       # FastAPI + MJPEG video stream + WebSocket telemetry
│   ├── orchestrator.py # Master pipeline state machine
│   ├── kinematics/     # 5-6 DOF analytical Inverse Kinematics & Waypoint Planner
│   ├── hardware/       # PCA9685 I2C driver (with Mock fallback) & GPIO button
│   ├── vision/         # 4-corner homography warp & legal-move delta detection
│   └── engine/         # Stockfish UCI integration with fallback Minimax AI
└── assets/
    └── icon.svg        # App vector icon
```

---

##  Robotic Chess Opponent (Raspberry Pi 4 + PCA9685 + MG946R)

CheckMate now includes an end-to-end **Robotic Chess Opponent System** designed to play on a real, physical chessboard using computer vision and a multi-DOF robotic arm!

```
Webcam (Overhead) ──> Board Detection (Homography) ──> Move Detection ──> python-chess (Validate)
                                                                                  │
                                     Stockfish Engine <── Best Move Calculation <─┘
                                           │
                                           ▼
                               Arm Controller (Waypoints)
                                           │
                                           ▼
                                 Inverse Kinematics (IK)
                                           │
                                           ▼
                               PCA9685 16-Channel 12-Bit PWM
                                           │
                                           ▼
                         MG946R Servos (Pick, Place, Capture)
```

###  Hardware Requirements
1. **Raspberry Pi 4 (Brain)**: Runs Computer Vision, Stockfish, IK, and servo control — no microcontroller/ESP32 required!
2. **5-6x MG946R Metal-Gear High-Torque Servos**: Powers Base Yaw, Shoulder Pitch, Elbow Pitch, Wrist Pitch, and Gripper Clamp.
3. **PCA9685 16-Channel 12-Bit PWM Driver**: Connects to Raspberry Pi via I2C (`0x40`).
4. **Zebronics USB Overhead Webcam**: Mounted 45cm–65cm above the board.
5. **Physical Momentary Push Button**: Connected between GPIO 17 (Pin 11) and Ground (Pin 9).
6. **External 5V–6V 5A–10A DC Power Supply**: Powers the PCA9685 servo rail directly (never power MG946R servos from Pi header).

*See complete pin diagrams and electrical notes in [`docs/HARDWARE_WIRING.md`](file:///c:/Users/goura/OneDrive/Desktop/projects/check-mate/docs/HARDWARE_WIRING.md).*

---

###  Running the Robotic System

#### On Raspberry Pi 4 (Physical Hardware):
```bash
# 1. Run automated setup (installs Stockfish, I2C tools, python libs)
chmod +x setup_raspberry_pi.sh
./setup_raspberry_pi.sh

# 2. Start the Robotic Chess Brain
source ~/robochess-venv/bin/activate
python robot_backend/main.py --host 0.0.0.0 --port 5000
```

#### On PC / Laptop (Simulation & Development Mode):
The system includes built-in mock drivers so you can develop, test, and calibrate without physical servos or I2C connected:
```bash
# Start backend server
python robot_backend/main.py --host 127.0.0.1 --port 5000

# In another terminal, start web interface
npm start
```
Open `http://localhost:3000`, click the **"Robotic Arm"** tab, and interact with the live camera feed, servo sliders, and board scanning!

