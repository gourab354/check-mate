/**
 * Robotic Chess Opponent — Web Companion Dashboard Controller
 * Manages WebSocket telemetry, camera feed, 4-corner calibration,
 * manual servo jogging, and physical move trigger.
 */

class RobotCompanion {
  constructor() {
    this.serverUrl = localStorage.getItem("robot_server_url") || "http://localhost:5000";
    this.ws = null;
    this.isConnected = false;
    this.reconnectTimer = null;

    this.corners = [
      [160.0, 60.0],
      [1120.0, 60.0],
      [1120.0, 660.0],
      [160.0, 660.0]
    ];
    this.draggedCornerIdx = -1;

    this.initElements();
    this.bindEvents();
    this.connect();
  }

  initElements() {
    this.ipInput = document.getElementById("robotServerIp");
    this.btnConnect = document.getElementById("btnRobotConnect");
    this.statusDot = document.getElementById("robotStatusDot");
    this.statusText = document.getElementById("robotStatusText");
    this.stateBadge = document.getElementById("robotStateBadge");
    this.statusMessage = document.getElementById("robotStatusMessage");

    this.btnTriggerMove = document.getElementById("btnTriggerMove");
    this.btnNewGameRobot = document.getElementById("btnNewGameRobot");
    this.selectRobotColor = document.getElementById("selectRobotColor");

    this.feedImage = document.getElementById("robotFeedImg");
    this.feedCanvas = document.getElementById("robotFeedCanvas");
    this.btnToggleViewRaw = document.getElementById("btnViewRaw");
    this.btnToggleViewWarped = document.getElementById("btnViewWarped");
    this.btnSaveCalibration = document.getElementById("btnSaveCalibration");

    this.btnHomeArm = document.getElementById("btnHomeArm");
    this.btnOpenGripper = document.getElementById("btnOpenGripper");
    this.btnCloseGripper = document.getElementById("btnCloseGripper");
    this.btnRelaxServos = document.getElementById("btnRelaxServos");

    this.sliderBase = document.getElementById("sliderBase");
    this.sliderShoulder = document.getElementById("sliderShoulder");
    this.sliderElbow = document.getElementById("sliderElbow");
    this.sliderWrist = document.getElementById("sliderWrist");
    this.sliderGripper = document.getElementById("sliderGripper");

    this.valBase = document.getElementById("valBase");
    this.valShoulder = document.getElementById("valShoulder");
    this.valElbow = document.getElementById("valElbow");
    this.valWrist = document.getElementById("valWrist");
    this.valGripper = document.getElementById("valGripper");

    this.selectTestSquare = document.getElementById("selectTestSquare");
    this.btnTestSquare = document.getElementById("btnTestSquare");

    this.logsTerminal = document.getElementById("robotLogsTerminal");

    if (this.ipInput) {
      this.ipInput.value = this.serverUrl;
    }
  }

  bindEvents() {
    if (this.btnConnect) {
      this.btnConnect.addEventListener("click", () => {
        const val = this.ipInput.value.trim();
        if (val) {
          this.serverUrl = val;
          localStorage.setItem("robot_server_url", this.serverUrl);
          this.connect();
        }
      });
    }

    if (this.btnTriggerMove) {
      this.btnTriggerMove.addEventListener("click", () => this.triggerMove());
    }

    if (this.btnNewGameRobot) {
      this.btnNewGameRobot.addEventListener("click", () => {
        const color = this.selectRobotColor ? this.selectRobotColor.value : "black";
        this.startNewGame(color);
      });
    }

    // Feed view switching
    if (this.btnToggleViewRaw && this.btnToggleViewWarped) {
      this.btnToggleViewRaw.addEventListener("click", () => {
        this.btnToggleViewRaw.classList.add("active");
        this.btnToggleViewWarped.classList.remove("active");
        this.updateFeedSource(false);
      });
      this.btnToggleViewWarped.addEventListener("click", () => {
        this.btnToggleViewWarped.classList.add("active");
        this.btnToggleViewRaw.classList.remove("active");
        this.updateFeedSource(true);
      });
    }

    // Arm manual controls
    if (this.btnHomeArm) {
      this.btnHomeArm.addEventListener("click", () => this.postApi("/api/arm/home"));
    }
    if (this.btnOpenGripper) {
      this.btnOpenGripper.addEventListener("click", () => this.postApi("/api/arm/gripper?action=open"));
    }
    if (this.btnCloseGripper) {
      this.btnCloseGripper.addEventListener("click", () => this.postApi("/api/arm/gripper?action=close"));
    }
    if (this.btnRelaxServos) {
      this.btnRelaxServos.addEventListener("click", () => this.postApi("/api/arm/relax"));
    }

    // Jog sliders
    const setupSlider = (slider, valEl, field) => {
      if (!slider) return;
      slider.addEventListener("input", (e) => {
        const val = parseFloat(e.target.value);
        if (valEl) valEl.textContent = `${val}°`;
        this.debouncedJog(field, val);
      });
    };

    setupSlider(this.sliderBase, this.valBase, "base");
    setupSlider(this.sliderShoulder, this.valShoulder, "shoulder");
    setupSlider(this.sliderElbow, this.valElbow, "elbow");
    setupSlider(this.sliderWrist, this.valWrist, "wrist_pitch");
    setupSlider(this.sliderGripper, this.valGripper, "gripper");

    // Test square
    if (this.btnTestSquare && this.selectTestSquare) {
      this.btnTestSquare.addEventListener("click", () => {
        const sq = this.selectTestSquare.value;
        this.postApi("/api/arm/test_square", { square: sq });
      });
    }

    // Corner Calibration Canvas
    this.initCanvasCalibration();
  }

  debouncedJog(joint, value) {
    clearTimeout(this._jogTimer);
    this._jogTimer = setTimeout(() => {
      this.postApi("/api/arm/jog", { [joint]: value });
    }, 40);
  }

  connect() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
    }

    const wsUrl = this.serverUrl.replace(/^http/, "ws") + "/ws";
    this.log(`Connecting to Robotic Brain at ${wsUrl}...`, "info");

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.updateConnectionUI(true);
        this.log("Connected to Robotic Chess Brain! Camera & Servos active.", "info");
        this.updateFeedSource(false);
        // Fetch current status
        this.fetchStatus();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleServerEvent(msg);
        } catch (e) {
          console.error("Error parsing WS message:", e);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.updateConnectionUI(false);
        this.log("Disconnected from Robotic Brain. Auto-reconnecting in 3s...", "warning");
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      };

      this.ws.onerror = (err) => {
        console.warn("WebSocket error:", err);
      };
    } catch (e) {
      this.updateConnectionUI(false);
    }
  }

  updateConnectionUI(online) {
    if (this.statusDot) {
      this.statusDot.className = "status-dot " + (online ? "online" : "offline");
    }
    if (this.statusText) {
      this.statusText.textContent = online ? "Online (Pi 4)" : "Disconnected";
    }
    if (this.btnTriggerMove) {
      this.btnTriggerMove.disabled = !online;
    }
  }

  updateFeedSource(isWarped) {
    if (!this.feedImage) return;
    const endpoint = isWarped ? "/warped_feed" : "/video_feed";
    this.feedImage.src = `${this.serverUrl}${endpoint}?t=${Date.now()}`;
  }

  async fetchStatus() {
    try {
      const res = await fetch(`${this.serverUrl}/api/status`);
      if (res.ok) {
        const data = await res.json();
        this.applyStateUpdate(data);
      }
    } catch (e) {
      // offline
    }
  }

  async postApi(endpoint, body = null) {
    try {
      const options = {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      };
      if (body) {
        options.body = JSON.stringify(body);
      }
      const res = await fetch(`${this.serverUrl}${endpoint}`, options);
      return await res.json();
    } catch (e) {
      this.log(`API Error on ${endpoint}: ${e.message}`, "error");
      return null;
    }
  }

  triggerMove() {
    this.log("Triggering physical move scan...", "info");
    this.postApi("/api/trigger");
  }

  startNewGame(robotColor) {
    this.log(`Requesting new game. Robot = ${robotColor.toUpperCase()}...`, "info");
    this.postApi("/api/game/new", { robot_color: robotColor });
  }

  handleServerEvent(event) {
    if (event.type === "init") {
      this.applyStateUpdate(event.data);
      return;
    }

    if (event.state) {
      this.updateStateBadge(event.state, event.status_message);
    }

    if (event.type === "log" && event.log) {
      this.appendLog(event.log.time, event.log.text, event.log.level);
    }

    if (event.type === "player_move_applied" || event.type === "robot_thinking_done") {
      if (event.fen && window.app && window.app.board) {
        // Sync with primary CheckMate board UI
        try {
          window.app.engine.loadFEN(event.fen);
          window.app.renderBoard();
          window.app.updateMoveHistoryUI();
        } catch (e) {}
      }
    }
  }

  applyStateUpdate(data) {
    if (data.state) {
      this.updateStateBadge(data.state, data.status_message);
    }
    if (data.corners) {
      this.corners = data.corners;
      this.drawCanvasCorners();
    }
    if (data.arm_telemetry && data.arm_telemetry.current_angles) {
      this.updateServoSliders(data.arm_telemetry.current_angles);
    }
    if (data.logs && Array.isArray(data.logs)) {
      data.logs.forEach(l => this.appendLog(l.time, l.text, l.level));
    }
  }

  updateStateBadge(state, message) {
    if (this.stateBadge) {
      this.stateBadge.textContent = state.replace("_", " ");
      let badgeClass = "idle";
      if (state.includes("AWAITING")) badgeClass = "awaiting";
      else if (state.includes("THINKING") || state.includes("ANALYZING")) badgeClass = "thinking";
      else if (state.includes("ARM") || state.includes("MOVING")) badgeClass = "moving";
      this.stateBadge.className = `state-badge ${badgeClass}`;
    }

    if (this.statusMessage && message) {
      this.statusMessage.textContent = message;
    }

    if (this.btnTriggerMove) {
      this.btnTriggerMove.disabled = (state !== "AWAITING_PLAYER" && state !== "IDLE");
    }

    if (this.statusDot) {
      if (state.includes("ARM") || state.includes("MOVING")) {
        this.statusDot.className = "status-dot moving";
      } else if (state.includes("THINKING") || state.includes("ANALYZING")) {
        this.statusDot.className = "status-dot busy";
      } else {
        this.statusDot.className = "status-dot online";
      }
    }
  }

  updateServoSliders(angles) {
    const setVal = (slider, valEl, angle) => {
      if (slider && angle !== undefined) slider.value = Math.round(angle);
      if (valEl && angle !== undefined) valEl.textContent = `${Math.round(angle)}°`;
    };
    setVal(this.sliderBase, this.valBase, angles.base);
    setVal(this.sliderShoulder, this.valShoulder, angles.shoulder);
    setVal(this.sliderElbow, this.valElbow, angles.elbow);
    setVal(this.sliderWrist, this.valWrist, angles.wrist_pitch);
    setVal(this.sliderGripper, this.valGripper, angles.gripper);
  }

  appendLog(timeStr, text, level = "info") {
    if (!this.logsTerminal) return;
    const entry = document.createElement("div");
    entry.className = `log-entry ${level}`;
    entry.innerHTML = `<span class="log-time">[${timeStr}]</span> ${this.escapeHtml(text)}`;
    this.logsTerminal.appendChild(entry);
    this.logsTerminal.scrollTop = this.logsTerminal.scrollHeight;
  }

  log(text, level = "info") {
    const timeStr = new Date().toTimeString().split(" ")[0];
    this.appendLog(timeStr, text, level);
  }

  escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ----------------- 4-Corner Calibration Canvas -----------------

  initCanvasCalibration() {
    if (!this.feedCanvas) return;
    const canvas = this.feedCanvas;
    const ctx = canvas.getContext("2d");

    const resizeCanvas = () => {
      canvas.width = canvas.parentElement.clientWidth;
      canvas.height = canvas.parentElement.clientHeight;
      this.drawCanvasCorners();
    };

    window.addEventListener("resize", resizeCanvas);
    setTimeout(resizeCanvas, 300);

    const getMousePos = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = 1280 / canvas.width;
      const scaleY = 720 / canvas.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    };

    canvas.addEventListener("mousedown", (e) => {
      const pos = getMousePos(e);
      this.draggedCornerIdx = -1;
      // Check if mouse is near any corner point
      for (let i = 0; i < 4; i++) {
        const dx = pos.x - this.corners[i][0];
        const dy = pos.y - this.corners[i][1];
        if (Math.hypot(dx, dy) < 40) {
          this.draggedCornerIdx = i;
          break;
        }
      }
    });

    canvas.addEventListener("mousemove", (e) => {
      if (this.draggedCornerIdx >= 0) {
        const pos = getMousePos(e);
        this.corners[this.draggedCornerIdx] = [
          Math.max(0, Math.min(1280, pos.x)),
          Math.max(0, Math.min(720, pos.y))
        ];
        this.drawCanvasCorners();
      }
    });

    window.addEventListener("mouseup", () => {
      this.draggedCornerIdx = -1;
    });

    if (this.btnSaveCalibration) {
      this.btnSaveCalibration.addEventListener("click", () => {
        this.log("Saving 4-corner calibration...", "info");
        this.postApi("/api/calibrate", { corners: this.corners });
      });
    }
  }

  drawCanvasCorners() {
    if (!this.feedCanvas) return;
    const canvas = this.feedCanvas;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const scaleX = canvas.width / 1280;
    const scaleY = canvas.height / 720;

    const pts = this.corners.map(c => ({ x: c[0] * scaleX, y: c[1] * scaleY }));

    // Draw polygon
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < 4; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.closePath();
    ctx.strokeStyle = "rgba(16, 185, 129, 0.8)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw handles
    const labels = ["TL (a8)", "TR (h8)", "BR (h1)", "BL (a1)"];
    const colors = ["#f97316", "#06b6d4", "#10b981", "#ec4899"];

    pts.forEach((p, idx) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = colors[idx];
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText(labels[idx], p.x + 12, p.y + 4);
    });
  }
}

// Auto-initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  window.robotCompanion = new RobotCompanion();
});
