#!/usr/bin/env bash
# ==============================================================================
# Robotic Chess Opponent — One-Step Automated Setup Script for Raspberry Pi 4
# ==============================================================================
set -e

echo "=========================================================="
echo "  Setting up Robotic Chess Opponent on Raspberry Pi 4"
echo "=========================================================="

# 1. Update APT and install system dependencies
echo "[1/6] Updating APT repositories and installing dependencies..."
sudo apt update
sudo apt install -y python3-pip python3-dev python3-venv i2c-tools stockfish libatlas-base-dev libopenjp2-7 libtiff5

# 2. Enable I2C interface on Raspberry Pi
echo "[2/6] Enabling I2C hardware interface..."
sudo raspi-config nonint do_i2c 0

# Add user to i2c and gpio groups if not already present
sudo usermod -aG i2c,gpio $USER

# 3. Create Python virtual environment
echo "[3/6] Setting up Python virtual environment..."
VENV_DIR="$HOME/robochess-venv"
if [ ! -d "$VENV_DIR" ]; then
    python3 -m venv --system-site-packages "$VENV_DIR"
fi
source "$VENV_DIR/bin/activate"

# 4. Install Python dependencies
echo "[4/6] Installing Python libraries (fastapi, python-chess, opencv, adafruit PCA9685)..."
pip install --upgrade pip
pip install -r requirements.txt

# 5. Check PCA9685 I2C Hardware Bus
echo "[5/6] Probing I2C bus 1 for PCA9685 (Address 0x40)..."
if command -v i2cdetect &> /dev/null; then
    sudo i2cdetect -y 1 || echo "Notice: Ensure PCA9685 is wired to Pi SDA (Pin 3) and SCL (Pin 5)."
fi

# 6. Verify Stockfish
echo "[6/6] Verifying Stockfish UCI chess engine..."
if command -v stockfish &> /dev/null; then
    echo "✓ Stockfish found at: $(which stockfish)"
else
    echo "Warning: Stockfish not found in PATH. Will use fallback minimax engine."
fi

echo ""
echo "=========================================================="
echo "  Setup Complete! 🎉"
echo "=========================================================="
echo "To start the Robotic Chess Brain, run:"
echo "  source ~/robochess-venv/bin/activate"
echo "  python robot_backend/main.py"
echo ""
echo "Then open your browser to the CheckMate Web Dashboard!"
echo "=========================================================="
