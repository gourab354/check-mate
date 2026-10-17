# 🤖 Robotic Chess Opponent — Hardware Wiring & Assembly Guide

## Overview

```
                      +-------------------+
                      | Zebronics Webcam  | (Overhead USB)
                      +---------+---------+
                                |
                                v
               +---------------------------------+
               |         Raspberry Pi 4          |
               |                                 |
               |  - Computer Vision (OpenCV)     |
               |  - Move Detection (Homography)  |
               |  - Chess Logic (python-chess)   |
               |  - Stockfish Chess Engine       |
               |  - Inverse Kinematics (IK)      |
               |  - FastAPI + WebSocket Server   |
               +--------+--------------+---------+
                        |              |
         I2C Bus 1      |              | GPIO 17 (Pin 11)
      (SDA=Pin 3,       |              | & GND (Pin 9)
       SCL=Pin 5)       v              v
           +------------+----+   +-----+------------+
           | PCA9685 Driver  |   | Physical Button  |
           | 16-Ch 12-bit PWM|   | "Move Finished"  |
           +--------+--------+   +------------------+
                    |
      Channels 0..5 | + External 5V/6V 5A-10A Power
                    v
    +-----------------------------------------------+
    | 5-6x MG946R Metal Gear High-Torque Servos     |
    |  - Ch 0: Base Yaw (Side File A mount)         |
    |  - Ch 1: Shoulder Pitch                       |
    |  - Ch 2: Elbow Pitch                          |
    |  - Ch 3: Wrist Pitch (Vertical Down Clamp)    |
    |  - Ch 4: Wrist Roll (Optional)                |
    |  - Ch 5: Gripper Clamp                        |
    +-----------------------------------------------+
```

---

## 1. Pinout & Wiring Connections

### A. Raspberry Pi 4 to PCA9685 (Logic Pins)

| Raspberry Pi 4 Header Pin | RPi Function | PCA9685 Pin | Description |
|---|---|---|---|
| **Pin 1** | 3.3V Power | **VCC** | PCA9685 Chip Logic Power (3.3V) |
| **Pin 3** | GPIO 2 (SDA) | **SDA** | I2C Data Line |
| **Pin 5** | GPIO 3 (SCL) | **SCL** | I2C Clock Line |
| **Pin 9** | Ground | **GND** | Common Ground |

> **CRITICAL CAUTION**: Connect **VCC** to Raspberry Pi **3.3V** (Pin 1), NOT 5V! The PCA9685 I2C logic runs at 3.3V to match Raspberry Pi GPIO logic level.

---

### B. Servo Power Supply (External 5V–6V)

**NEVER power MG946R servos from the Raspberry Pi 5V header pin.**
Each MG946R servo draws up to 1.5A–2.5A peak stall current. Under full load with 5-6 servos, the arm can draw 4A–8A peak. Attempting to power them from the Pi will trigger brownout resets, freeze the CPU, or damage the Pi.

| External DC Power Supply (5V–6V 5A–10A) | PCA9685 Screw Terminal | Notes |
|---|---|---|
| **Positive (+5V / +6V)** | **V+ (Screw Terminal)** | Powers all servo motors directly |
| **Negative (GND)** | **GND (Screw Terminal)** | Shared Ground |

*Tip: Solder a 1000µF 16V electrolytic capacitor across the V+ and GND capacitor pads on the PCA9685 board to smooth out servo inductive voltage dips.*

---

### C. PCA9685 Channel Assignments for Arm Servos

| PCA9685 Channel | Arm Joint | Servo Model | Typical Angle Range | Function |
|---|---|---|---|---|
| **Channel 0** | **Base Yaw** | MG946R | 0° – 180° (90° Center) | Rotates arm across board |
| **Channel 1** | **Shoulder Pitch** | MG946R | 20° – 160° | Lifts main upper arm |
| **Channel 2** | **Elbow Pitch** | MG946R | 15° – 165° | Reaches forearm forward/back |
| **Channel 3** | **Wrist Pitch** | MG946R | 10° – 170° | Orients clamp vertically down |
| **Channel 4** | **Wrist Roll** | MG946R | 0° – 180° (90° Center) | Optional piece alignment roll |
| **Channel 5** | **Gripper Clamp** | MG946R | 40° (Open) – 110° (Closed)| Pinches and holds chess piece |

---

### D. Physical Push Button (Player Turn Confirmation)

Connect a momentary push-button:
- **Terminal 1**: Raspberry Pi **Pin 11 (GPIO 17)**
- **Terminal 2**: Raspberry Pi **Pin 9 or 14 (Ground)**

The software enables an internal software pull-up resistor (`GPIO.PUD_UP`). Pressing the button pulls GPIO 17 to Ground (Active-Low), triggering board scanning and move analysis.

---

### E. Zebronics Overhead Webcam

- Plug into any **USB 3.0 port** (blue port) on the Raspberry Pi 4.
- Mount the camera directly overhead looking straight down at the 8x8 chessboard at a height of 45cm – 65cm.
- Ensure even lighting without harsh directional shadows across the board.

---

## 2. Arm Mechanical Mounting Placement

In `config.py` and the Web Dashboard, the default mounting configuration is:
- **`side_a` (Side File A Mounting)**:
  - Arm is clamped or bolted to the table **to the left of File A**, centered around Rank 4.5 (the middle of the board).
  - Distance: Base center is placed ~75mm away from the edge of File A squares.
  - Reach: The 145mm upper arm + 145mm forearm + 95mm gripper allows the arm to comfortably reach across all 8 files (a1 to h8) with minimal base rotation!

*(Alternative mounting options: `side_h` for File H side, or `rear_black` behind Rank 8, can be switched in 1-click in the Web Dashboard Settings).*
