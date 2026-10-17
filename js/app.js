/**
 * CheckMate - Main Application Controller
 * Handles board rendering, drag-and-drop, touch controls, clocks, modals, and AI loop.
 */

class ChessApp {
  constructor() {
    this.engine = new ChessEngine();
    this.ai = new ChessAI();
    this.audio = chessAudio;

    // Game Configuration
    this.mode = 'ai'; // 'ai' | 'pass' | 'ai_vs_ai'
    this.playerColor = 'w'; // 'w' | 'b' | 'random'
    this.actualPlayerColor = 'w'; // What player actually is this game
    this.difficulty = 'medium'; // 'easy' | 'medium' | 'hard'
    this.reactionSpeed = 'realistic'; // 'realistic' | 'fast' | 'instant'
    this.flipped = false;
    this.theme = 'emerald';
    this.showHints = true;
    this.showCoords = true;
    this.autoFlip = false;
    this.timeControl = 600; // seconds (10 min rapid default)

    // Clocks
    this.whiteTime = this.timeControl;
    this.blackTime = this.timeControl;
    this.timerInterval = null;
    this.isTimed = true;

    // Interaction State
    this.selectedSquare = null; // { row, col }
    this.validMoves = [];
    this.previewHistoryIndex = -1; // -1 for live game, or 0..n for past moves
    this.pendingPromotion = null; // { move, resolve }
    this.isAiThinking = false;

    // Drag and Drop state
    this.dragState = {
      isDragging: false,
      from: null,
      element: null,
      ghost: null
    };

    // Cache DOM Elements
    this.dom = {
      chessboard: document.getElementById('chessboard'),
      evalBarWhite: document.getElementById('evalBarWhite'),
      evalScore: document.getElementById('evalScore'),
      movesTableBody: document.getElementById('movesTableBody'),
      whiteClock: document.getElementById('whiteClock'),
      blackClock: document.getElementById('blackClock'),
      topPlayerBar: document.getElementById('topPlayerBar'),
      bottomPlayerBar: document.getElementById('bottomPlayerBar'),
      topPlayerName: document.getElementById('topPlayerName'),
      topPlayerBadge: document.getElementById('topPlayerBadge'),
      topCapturedRack: document.getElementById('topCapturedRack'),
      topMaterialDiff: document.getElementById('topMaterialDiff'),
      bottomPlayerName: document.getElementById('bottomPlayerName'),
      bottomPlayerBadge: document.getElementById('bottomPlayerBadge'),
      bottomCapturedRack: document.getElementById('bottomCapturedRack'),
      bottomMaterialDiff: document.getElementById('bottomMaterialDiff'),
      modalOverlay: document.getElementById('modalOverlay'),
      modalTitle: document.getElementById('modalTitle'),
      modalSubtitle: document.getElementById('modalSubtitle'),
      modalActions: document.getElementById('modalActions'),
      promoOverlay: document.getElementById('promoOverlay'),
      promoGrid: document.getElementById('promoGrid'),
      fenInput: document.getElementById('fenInput'),
      pgnTextarea: document.getElementById('pgnTextarea'),
      bannerToast: document.getElementById('bannerToast'),
      bannerToastText: document.getElementById('bannerToastText')
    };

    this.init();
  }

  init() {
    this.loadSavedPreferences();
    this.bindEvents();
    this.startNewGame();
  }

  loadSavedPreferences() {
    const savedTheme = localStorage.getItem('checkmate_theme');
    if (savedTheme) {
      this.theme = savedTheme;
      document.body.setAttribute('data-theme', savedTheme);
      const themeSelect = document.getElementById('themeSelect');
      if (themeSelect) themeSelect.value = savedTheme;
    }

    const savedDifficulty = localStorage.getItem('checkmate_difficulty');
    if (savedDifficulty) {
      this.difficulty = savedDifficulty;
      const diffSelect = document.getElementById('difficultySelect');
      if (diffSelect) diffSelect.value = savedDifficulty;
    }

    const savedSpeed = localStorage.getItem('checkmate_reaction_speed');
    if (savedSpeed) {
      this.reactionSpeed = savedSpeed;
      const speedSelect = document.getElementById('speedSelect');
      if (speedSelect) speedSelect.value = savedSpeed;
    }

    const savedSound = localStorage.getItem('checkmate_muted');
    if (savedSound === 'true') {
      this.audio.setMuted(true);
      this.updateMuteIcon();
    }
  }

  startNewGame() {
    clearInterval(this.timerInterval);

    // Resolve Player Color
    if (this.playerColor === 'random') {
      this.actualPlayerColor = Math.random() < 0.5 ? 'w' : 'b';
    } else {
      this.actualPlayerColor = this.playerColor;
    }

    // Orient board
    this.flipped = (this.actualPlayerColor === 'b' && this.mode === 'ai');

    this.engine.reset();
    this.selectedSquare = null;
    this.validMoves = [];
    this.previewHistoryIndex = -1;
    this.isAiThinking = false;

    // Reset clocks
    this.isTimed = this.timeControl > 0;
    this.whiteTime = this.timeControl;
    this.blackTime = this.timeControl;
    this.updateClockDisplays();

    this.updatePlayerBadges();
    this.renderBoard();
    this.renderMoveHistory();
    this.updateMaterialAndCaptured();
    this.updateEvaluationBar();
    this.updateFENandPGN();

    if (this.isTimed) {
      this.startClock();
    }

    // If AI is White and mode is AI, trigger AI first move
    if (this.mode === 'ai' && this.actualPlayerColor === 'b') {
      this.triggerAIMove();
    } else if (this.mode === 'ai_vs_ai') {
      this.triggerAIMove();
    }
  }

  updatePlayerBadges() {
    if (this.mode === 'ai') {
      const isUserWhite = this.actualPlayerColor === 'w';
      const userLabel = 'Player (You)';
      const aiLabel = `StockBot (${this.capitalize(this.difficulty)})`;

      if (this.flipped) {
        // Bottom is Black (User), Top is White (AI)
        this.dom.topPlayerName.textContent = aiLabel;
        this.dom.topPlayerBadge.textContent = 'White';
        this.dom.bottomPlayerName.textContent = userLabel;
        this.dom.bottomPlayerBadge.textContent = 'Black';
      } else {
        // Bottom is White (User), Top is Black (AI)
        this.dom.topPlayerName.textContent = aiLabel;
        this.dom.topPlayerBadge.textContent = 'Black';
        this.dom.bottomPlayerName.textContent = userLabel;
        this.dom.bottomPlayerBadge.textContent = 'White';
      }
    } else if (this.mode === 'pass') {
      if (this.flipped) {
        this.dom.topPlayerName.textContent = 'Player 1';
        this.dom.topPlayerBadge.textContent = 'White';
        this.dom.bottomPlayerName.textContent = 'Player 2';
        this.dom.bottomPlayerBadge.textContent = 'Black';
      } else {
        this.dom.topPlayerName.textContent = 'Player 2';
        this.dom.topPlayerBadge.textContent = 'Black';
        this.dom.bottomPlayerName.textContent = 'Player 1';
        this.dom.bottomPlayerBadge.textContent = 'White';
      }
    } else {
      // AI vs AI
      this.dom.topPlayerName.textContent = 'StockBot Black';
      this.dom.topPlayerBadge.textContent = 'Black';
      this.dom.bottomPlayerName.textContent = 'StockBot White';
      this.dom.bottomPlayerBadge.textContent = 'White';
    }
  }

  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  startClock() {
    clearInterval(this.timerInterval);
    if (!this.isTimed) return;

    this.timerInterval = setInterval(() => {
      const status = this.engine.getGameStatus();
      if (status.isOver) {
        clearInterval(this.timerInterval);
        return;
      }

      if (this.engine.turn === 'w') {
        this.whiteTime = Math.max(0, this.whiteTime - 1);
        if (this.whiteTime === 0) {
          this.handleTimeout('White');
        }
      } else {
        this.blackTime = Math.max(0, this.blackTime - 1);
        if (this.blackTime === 0) {
          this.handleTimeout('Black');
        }
      }

      this.updateClockDisplays();
    }, 1000);
  }

  handleTimeout(flaggedColor) {
    clearInterval(this.timerInterval);
    const winner = flaggedColor === 'White' ? 'Black' : 'White';
    this.audio.playGameOver(false);
    this.showGameOverModal('Time Out!', `${flaggedColor} ran out of time. ${winner} wins!`);
  }

  formatTime(totalSecs) {
    if (totalSecs <= 0) return '00:00';
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  updateClockDisplays() {
    if (!this.isTimed) {
      this.dom.whiteClock.textContent = '∞';
      this.dom.blackClock.textContent = '∞';
      return;
    }

    this.dom.whiteClock.textContent = this.formatTime(this.whiteTime);
    this.dom.blackClock.textContent = this.formatTime(this.blackTime);

    // Toggle low-time warnings (< 30s)
    this.dom.whiteClock.classList.toggle('low-time', this.whiteTime <= 30 && this.whiteTime > 0);
    this.dom.blackClock.classList.toggle('low-time', this.blackTime <= 30 && this.blackTime > 0);
  }

  renderBoard() {
    this.dom.chessboard.innerHTML = '';
    const activeBoard = this.previewHistoryIndex >= 0
      ? this.engine.history[this.previewHistoryIndex].board
      : this.engine.board;

    const inCheck = this.engine.isCheck(this.engine.turn);
    const lastMove = this.engine.history.length > 0
      ? (this.previewHistoryIndex >= 0 ? this.engine.history[this.previewHistoryIndex].move : this.engine.history[this.engine.history.length - 1].move)
      : null;

    // Highlight active player bar
    const currentTurn = this.engine.turn;
    const isTopTurn = (this.flipped && currentTurn === 'w') || (!this.flipped && currentTurn === 'b');
    this.dom.topPlayerBar.classList.toggle('active-turn', isTopTurn);
    this.dom.bottomPlayerBar.classList.toggle('active-turn', !isTopTurn);

    // Row & Col iteration according to flipped state
    for (let displayRow = 0; displayRow < 8; displayRow++) {
      for (let displayCol = 0; displayCol < 8; displayCol++) {
        const r = this.flipped ? 7 - displayRow : displayRow;
        const c = this.flipped ? 7 - displayCol : displayCol;

        const square = document.createElement('div');
        square.className = `square ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;
        square.dataset.row = r;
        square.dataset.col = c;

        // Coordinates display
        if (this.showCoords) {
          if (displayCol === 0) {
            const rankLabel = document.createElement('span');
            rankLabel.className = 'coord rank';
            rankLabel.textContent = 8 - r;
            square.appendChild(rankLabel);
          }
          if (displayRow === 7) {
            const fileLabel = document.createElement('span');
            fileLabel.className = 'coord file';
            fileLabel.textContent = 'abcdefgh'[c];
            square.appendChild(fileLabel);
          }
        }

        // Selection highlight
        if (this.selectedSquare && this.selectedSquare.row === r && this.selectedSquare.col === c) {
          square.classList.add('selected');
        }

        // Last move highlight
        if (lastMove) {
          if (lastMove.from.row === r && lastMove.from.col === c) {
            square.classList.add('last-move-from');
          } else if (lastMove.to.row === r && lastMove.to.col === c) {
            square.classList.add('last-move-to');
          }
        }

        const piece = activeBoard[r][c];

        // Check highlight on the checked King
        if (inCheck && piece && piece.type === 'k' && piece.color === this.engine.turn) {
          square.classList.add('in-check');
        }

        // Render Piece
        if (piece) {
          const pieceEl = document.createElement('div');
          pieceEl.className = 'piece';
          pieceEl.innerHTML = getPieceSVG(piece.type, piece.color);
          pieceEl.dataset.type = piece.type;
          pieceEl.dataset.color = piece.color;
          pieceEl.dataset.row = r;
          pieceEl.dataset.col = c;

          // Drag and Drop listeners
          pieceEl.setAttribute('draggable', 'false'); // Custom pointer drag for better mobile/touch support
          pieceEl.addEventListener('pointerdown', (e) => this.handlePointerDown(e, r, c));

          square.appendChild(pieceEl);
        }

        // Render valid move indicators
        if (this.showHints && this.validMoves.length > 0) {
          const matchingMove = this.validMoves.find(m => m.to.row === r && m.to.col === c);
          if (matchingMove) {
            if (piece || matchingMove.isEnPassant) {
              const capRing = document.createElement('div');
              capRing.className = 'capture-indicator';
              square.appendChild(capRing);
            } else {
              const dot = document.createElement('div');
              dot.className = 'move-dest-indicator';
              square.appendChild(dot);
            }
          }
        }

        // Click on square
        square.addEventListener('click', () => this.handleSquareClick(r, c));

        this.dom.chessboard.appendChild(square);
      }
    }
  }

  handleSquareClick(row, col) {
    if (this.previewHistoryIndex >= 0) {
      // If browsing history, return to live game on click
      this.previewHistoryIndex = -1;
      this.renderBoard();
      this.renderMoveHistory();
      return;
    }

    if (this.isAiThinking) return;

    // Check if it's user's turn
    if (this.mode === 'ai' && this.engine.turn !== this.actualPlayerColor) return;
    if (this.mode === 'ai_vs_ai') return;

    // If already selected, check if clicked square is a valid target move
    if (this.selectedSquare) {
      const move = this.validMoves.find(m => m.to.row === row && m.to.col === col);
      if (move) {
        this.executeMoveWithPromotionCheck(move);
        return;
      }
    }

    // Select piece on square if it belongs to current player
    const piece = this.engine.getPiece(row, col);
    if (piece && piece.color === this.engine.turn) {
      this.selectedSquare = { row, col };
      this.validMoves = this.engine.getMovesForSquare(row, col);
      this.renderBoard();
    } else {
      this.selectedSquare = null;
      this.validMoves = [];
      this.renderBoard();
    }
  }

  handlePointerDown(e, r, c) {
    if (this.previewHistoryIndex >= 0) return;
    if (this.isAiThinking) return;
    if (this.mode === 'ai' && this.engine.turn !== this.actualPlayerColor) return;
    if (this.mode === 'ai_vs_ai') return;

    const piece = this.engine.getPiece(r, c);
    if (!piece || piece.color !== this.engine.turn) return;

    // Select piece
    this.selectedSquare = { row, col: c };
    this.validMoves = this.engine.getMovesForSquare(r, c);
    this.renderBoard();

    // Initialize custom drag
    const pieceEl = e.currentTarget;
    this.dragState.isDragging = true;
    this.dragState.from = { row: r, col: c };
    this.dragState.element = pieceEl;

    // Create ghost
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.innerHTML = getPieceSVG(piece.type, piece.color);
    ghost.style.display = 'block';
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
    document.body.appendChild(ghost);
    this.dragState.ghost = ghost;

    pieceEl.classList.add('dragging');

    const onPointerMove = (moveEvent) => {
      if (this.dragState.ghost) {
        this.dragState.ghost.style.left = `${moveEvent.clientX}px`;
        this.dragState.ghost.style.top = `${moveEvent.clientY}px`;
      }
    };

    const onPointerUp = (upEvent) => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);

      if (this.dragState.ghost) {
        this.dragState.ghost.remove();
        this.dragState.ghost = null;
      }

      if (this.dragState.element) {
        this.dragState.element.classList.remove('dragging');
      }

      this.dragState.isDragging = false;

      // Determine drop target square from coordinates
      const dropTarget = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
      const targetSquare = dropTarget ? dropTarget.closest('.square') : null;

      if (targetSquare) {
        const toRow = parseInt(targetSquare.dataset.row, 10);
        const toCol = parseInt(targetSquare.dataset.col, 10);

        if (!isNaN(toRow) && !isNaN(toCol)) {
          const move = this.validMoves.find(m => m.to.row === toRow && m.to.col === toCol);
          if (move) {
            this.executeMoveWithPromotionCheck(move);
            return;
          }
        }
      }

      this.renderBoard();
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }

  executeMoveWithPromotionCheck(move) {
    const fromPiece = this.engine.getPiece(move.from.row, move.from.col);

    // Check if move is a promotion move
    if (fromPiece && fromPiece.type === 'p' && (move.to.row === 0 || move.to.row === 7)) {
      this.promptPromotion(fromPiece.color).then(chosenPiece => {
        move.promotion = chosenPiece;
        this.performMove(move);
      });
      return;
    }

    this.performMove(move);
  }

  promptPromotion(color) {
    return new Promise(resolve => {
      this.dom.promoGrid.innerHTML = '';
      const pieces = ['q', 'r', 'b', 'n'];
      const labels = ['Queen', 'Rook', 'Bishop', 'Knight'];

      pieces.forEach((type, idx) => {
        const option = document.createElement('div');
        option.className = 'promo-option';
        option.innerHTML = `
          <div class="piece-preview">${getPieceSVG(type, color)}</div>
          <span>${labels[idx]}</span>
        `;
        option.addEventListener('click', () => {
          this.dom.promoOverlay.classList.remove('open');
          resolve(type);
        });
        this.dom.promoGrid.appendChild(option);
      });

      this.dom.promoOverlay.classList.add('open');
    });
  }

  performMove(move) {
    const isCapture = !!this.engine.getPiece(move.to.row, move.to.col) || move.isEnPassant;
    const isCastle = !!move.isCastle;

    const result = this.engine.makeMove(move);
    if (!result) return;

    // Reset selection
    this.selectedSquare = null;
    this.validMoves = [];

    // Play procedural sound effect
    const status = this.engine.getGameStatus();
    if (status.isOver) {
      this.audio.playGameOver(status.winner === (this.actualPlayerColor === 'w' ? 'White' : 'Black'));
    } else if (status.inCheck) {
      this.audio.playCheck();
    } else if (isCastle) {
      this.audio.playCastle();
    } else if (isCapture) {
      this.audio.playCapture();
    } else {
      this.audio.playMove();
    }

    // Auto-flip if enabled in 2-player pass mode
    if (this.autoFlip && this.mode === 'pass') {
      this.flipped = (this.engine.turn === 'b');
    }

    this.renderBoard();
    this.renderMoveHistory();
    this.updateMaterialAndCaptured();
    this.updateEvaluationBar();
    this.updateFENandPGN();

    // Check game over
    if (status.isOver) {
      this.handleGameOver(status);
      return;
    }

    // Check if next turn is AI
    if ((this.mode === 'ai' && this.engine.turn !== this.actualPlayerColor) || this.mode === 'ai_vs_ai') {
      this.triggerAIMove();
    }
  }

  async triggerAIMove() {
    this.isAiThinking = true;
    this.showThinkingPulse(true);

    try {
      const bestMove = await this.ai.getBestMoveAsync(this.engine, this.difficulty, this.reactionSpeed);
      this.isAiThinking = false;
      this.showThinkingPulse(false);

      if (bestMove) {
        this.performMove(bestMove);
      }
    } catch (e) {
      console.error('AI error:', e);
      this.isAiThinking = false;
      this.showThinkingPulse(false);
    }
  }

  showThinkingPulse(show) {
    const aiPulse = document.getElementById('topAiPulse') || document.querySelector('.ai-status-pulse');
    const aiThinkingText = document.getElementById('topAiThinkingText');
    if (aiPulse) {
      aiPulse.style.display = show ? 'inline-block' : 'none';
    }
    if (aiThinkingText) {
      aiThinkingText.style.display = show ? 'inline-block' : 'none';
    }
  }

  handleGameOver(status) {
    clearInterval(this.timerInterval);
    let title = 'Game Over';
    let subtitle = status.reason;

    if (status.type === 'checkmate') {
      const isWin = (this.mode === 'ai') ? (status.winner === (this.actualPlayerColor === 'w' ? 'White' : 'Black')) : true;
      title = isWin ? 'Victory!' : 'Defeat!';
    } else {
      title = 'Draw!';
    }

    this.showGameOverModal(title, subtitle);
  }

  showGameOverModal(title, subtitle) {
    this.dom.modalTitle.textContent = title;
    this.dom.modalSubtitle.textContent = subtitle;

    this.dom.modalActions.innerHTML = `
      <button class="btn-action btn-primary" id="modalRematchBtn">
        <svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
        New Game
      </button>
      <button class="btn-action btn-secondary" id="modalReviewBtn">Review Board</button>
    `;

    document.getElementById('modalRematchBtn').addEventListener('click', () => {
      this.dom.modalOverlay.classList.remove('open');
      this.startNewGame();
    });

    document.getElementById('modalReviewBtn').addEventListener('click', () => {
      this.dom.modalOverlay.classList.remove('open');
    });

    this.dom.modalOverlay.classList.add('open');
  }

  renderMoveHistory() {
    this.dom.movesTableBody.innerHTML = '';
    const history = this.engine.history;

    for (let i = 0; i < history.length; i += 2) {
      const moveNum = Math.floor(i / 2) + 1;
      const whiteMove = history[i];
      const blackMove = history[i + 1];

      const row = document.createElement('tr');

      const numCell = document.createElement('td');
      numCell.className = 'move-num';
      numCell.textContent = `${moveNum}.`;
      row.appendChild(numCell);

      const whiteCell = document.createElement('td');
      whiteCell.className = 'move-cell';
      whiteCell.textContent = whiteMove.san;
      if (this.previewHistoryIndex === i) whiteCell.classList.add('active-history');
      whiteCell.addEventListener('click', () => this.previewMove(i));
      row.appendChild(whiteCell);

      const blackCell = document.createElement('td');
      blackCell.className = 'move-cell';
      blackCell.textContent = blackMove ? blackMove.san : '';
      if (blackMove && this.previewHistoryIndex === i + 1) blackCell.classList.add('active-history');
      if (blackMove) {
        blackCell.addEventListener('click', () => this.previewMove(i + 1));
      }
      row.appendChild(blackCell);

      this.dom.movesTableBody.appendChild(row);
    }

    // Auto-scroll moves container to bottom if live
    if (this.previewHistoryIndex === -1) {
      const container = document.querySelector('.moves-table-container');
      if (container) container.scrollTop = container.scrollHeight;
    }

    // Update navigation buttons
    this.updateNavButtons();
  }

  previewMove(index) {
    this.previewHistoryIndex = index;
    this.renderBoard();
    this.renderMoveHistory();
  }

  updateNavButtons() {
    const totalMoves = this.engine.history.length;
    const currentIndex = this.previewHistoryIndex >= 0 ? this.previewHistoryIndex : totalMoves - 1;

    document.getElementById('btnFirstMove').disabled = totalMoves === 0 || currentIndex === -1;
    document.getElementById('btnPrevMove').disabled = totalMoves === 0 || currentIndex <= 0;
    document.getElementById('btnNextMove').disabled = this.previewHistoryIndex === -1 || currentIndex >= totalMoves - 1;
    document.getElementById('btnLastMove').disabled = this.previewHistoryIndex === -1;
  }

  updateMaterialAndCaptured() {
    const captured = this.engine.getCapturedPieces();
    const material = this.engine.getMaterialScore();

    // Renders captured icons into container
    const renderRack = (container, diffContainer, pieceList, diffValue) => {
      container.innerHTML = '';
      pieceList.forEach(p => {
        const icon = document.createElement('span');
        icon.className = 'captured-icon';
        icon.innerHTML = getPieceSVG(p, container === this.dom.topCapturedRack ? 'b' : 'w');
        container.appendChild(icon);
      });
      diffContainer.textContent = diffValue > 0 ? `+${diffValue}` : '';
    };

    if (this.flipped) {
      renderRack(this.dom.topCapturedRack, this.dom.topMaterialDiff, captured.w, -material.diff);
      renderRack(this.dom.bottomCapturedRack, this.dom.bottomMaterialDiff, captured.b, material.diff);
    } else {
      renderRack(this.dom.topCapturedRack, this.dom.topMaterialDiff, captured.b, -material.diff);
      renderRack(this.dom.bottomCapturedRack, this.dom.bottomMaterialDiff, captured.w, material.diff);
    }
  }

  updateEvaluationBar() {
    const rawScore = this.ai.evaluate(this.engine);
    // Sigmoid compression: convert raw centipawns to percentage (0% to 100% white height)
    // 0 -> 50%, +1000 -> 90%, -1000 -> 10%
    const winProb = 1 / (1 + Math.exp(-rawScore / 400));
    const whitePercent = Math.min(98, Math.max(2, Math.round(winProb * 100)));

    this.dom.evalBarWhite.style.height = `${whitePercent}%`;

    // Numeric label
    const pawns = (Math.abs(rawScore) / 100).toFixed(1);
    if (rawScore > 30000) {
      this.dom.evalScore.textContent = 'M+';
    } else if (rawScore < -30000) {
      this.dom.evalScore.textContent = 'M-';
    } else if (rawScore >= 0) {
      this.dom.evalScore.textContent = `+${pawns}`;
    } else {
      this.dom.evalScore.textContent = `-${pawns}`;
    }
  }

  updateFENandPGN() {
    if (this.dom.fenInput) {
      this.dom.fenInput.value = this.engine.exportFEN();
    }
    if (this.dom.pgnTextarea) {
      this.dom.pgnTextarea.value = this.engine.exportPGN(
        this.dom.bottomPlayerName.textContent,
        this.dom.topPlayerName.textContent
      );
    }
  }

  showToast(message) {
    this.dom.bannerToastText.textContent = message;
    this.dom.bannerToast.classList.add('show');
    setTimeout(() => {
      this.dom.bannerToast.classList.remove('show');
    }, 2500);
  }

  showHint() {
    if (this.isAiThinking) return;
    this.showToast('StockBot is analyzing best move...');

    this.ai.getBestMoveAsync(this.engine, 'hard').then(move => {
      if (move) {
        // Highlight hint squares
        document.querySelectorAll('.square').forEach(sq => {
          sq.classList.remove('hint-from', 'hint-to');
        });

        const fromSq = document.querySelector(`.square[data-row="${move.from.row}"][data-col="${move.from.col}"]`);
        const toSq = document.querySelector(`.square[data-row="${move.to.row}"][data-col="${move.to.col}"]`);

        if (fromSq) fromSq.classList.add('hint-from');
        if (toSq) toSq.classList.add('hint-to');

        this.showToast(`Suggested move: ${this.engine._computeSAN(move, this.engine.getPiece(move.from.row, move.from.col), !!this.engine.getPiece(move.to.row, move.to.col))}`);

        setTimeout(() => {
          if (fromSq) fromSq.classList.remove('hint-from');
          if (toSq) toSq.classList.remove('hint-to');
        }, 4000);
      }
    });
  }

  undoMove() {
    if (this.isAiThinking || this.engine.history.length === 0) return;

    if (this.mode === 'ai') {
      // In AI mode, undo both AI move and user move
      this.engine.undo();
      if (this.engine.turn !== this.actualPlayerColor && this.engine.history.length > 0) {
        this.engine.undo();
      }
    } else {
      this.engine.undo();
    }

    this.selectedSquare = null;
    this.validMoves = [];
    this.previewHistoryIndex = -1;
    this.renderBoard();
    this.renderMoveHistory();
    this.updateMaterialAndCaptured();
    this.updateEvaluationBar();
    this.updateFENandPGN();
    this.showToast('Move undone');
  }

  redoMove() {
    if (this.isAiThinking || this.engine.redoStack.length === 0) return;

    if (this.mode === 'ai') {
      this.engine.redo();
      if (this.engine.turn !== this.actualPlayerColor && this.engine.redoStack.length > 0) {
        this.engine.redo();
      }
    } else {
      this.engine.redo();
    }

    this.selectedSquare = null;
    this.validMoves = [];
    this.previewHistoryIndex = -1;
    this.renderBoard();
    this.renderMoveHistory();
    this.updateMaterialAndCaptured();
    this.updateEvaluationBar();
    this.updateFENandPGN();
  }

  flipBoard() {
    this.flipped = !this.flipped;
    this.updatePlayerBadges();
    this.renderBoard();
    this.updateMaterialAndCaptured();
  }

  updateMuteIcon() {
    const muteBtn = document.getElementById('btnToggleMute');
    if (!muteBtn) return;
    const isMuted = this.audio.isMuted();
    muteBtn.innerHTML = isMuted
      ? `<svg viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`
      : `<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
  }

  bindEvents() {
    // Header Actions
    document.getElementById('btnNewGameModal').addEventListener('click', () => {
      this.openNewGameModal();
    });

    document.getElementById('btnFlipBoard').addEventListener('click', () => {
      this.flipBoard();
    });

    document.getElementById('btnToggleMute').addEventListener('click', () => {
      this.audio.toggleMute();
      this.updateMuteIcon();
      this.showToast(this.audio.isMuted() ? 'Sound muted' : 'Sound unmuted');
    });

    // Control Panel Action Buttons
    document.getElementById('btnQuickNew').addEventListener('click', () => {
      this.openNewGameModal();
    });

    document.getElementById('btnUndo').addEventListener('click', () => {
      this.undoMove();
    });

    document.getElementById('btnRedo').addEventListener('click', () => {
      this.redoMove();
    });

    document.getElementById('btnHint').addEventListener('click', () => {
      this.showHint();
    });

    document.getElementById('btnResign').addEventListener('click', () => {
      if (this.engine.history.length === 0) return;
      const winner = this.engine.turn === 'w' ? 'Black' : 'White';
      this.audio.playGameOver(false);
      this.showGameOverModal('Resigned', `${this.engine.turn === 'w' ? 'White' : 'Black'} resigned. ${winner} wins.`);
    });

    // History Nav Buttons
    document.getElementById('btnFirstMove').addEventListener('click', () => {
      if (this.engine.history.length > 0) this.previewMove(0);
    });

    document.getElementById('btnPrevMove').addEventListener('click', () => {
      const idx = this.previewHistoryIndex >= 0 ? this.previewHistoryIndex - 1 : this.engine.history.length - 2;
      if (idx >= 0) this.previewMove(idx);
    });

    document.getElementById('btnNextMove').addEventListener('click', () => {
      if (this.previewHistoryIndex >= 0) {
        const nextIdx = this.previewHistoryIndex + 1;
        if (nextIdx >= this.engine.history.length - 1) {
          this.previewHistoryIndex = -1;
          this.renderBoard();
          this.renderMoveHistory();
        } else {
          this.previewMove(nextIdx);
        }
      }
    });

    document.getElementById('btnLastMove').addEventListener('click', () => {
      this.previewHistoryIndex = -1;
      this.renderBoard();
      this.renderMoveHistory();
    });

    // Panel Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        const targetTab = e.currentTarget.dataset.tab;
        e.currentTarget.classList.add('active');
        const contentEl = document.getElementById(targetTab);
        if (contentEl) contentEl.classList.add('active');
      });
    });

    // Settings
    document.getElementById('themeSelect').addEventListener('change', (e) => {
      this.theme = e.target.value;
      document.body.setAttribute('data-theme', this.theme);
      localStorage.setItem('checkmate_theme', this.theme);
    });

    document.getElementById('difficultySelect').addEventListener('change', (e) => {
      this.difficulty = e.target.value;
      localStorage.setItem('checkmate_difficulty', this.difficulty);
      this.updatePlayerBadges();
    });

    const speedSelect = document.getElementById('speedSelect');
    if (speedSelect) {
      speedSelect.addEventListener('change', (e) => {
        this.reactionSpeed = e.target.value;
        localStorage.setItem('checkmate_reaction_speed', this.reactionSpeed);
      });
    }

    document.getElementById('toggleHints').addEventListener('change', (e) => {
      this.showHints = e.target.checked;
      this.renderBoard();
    });

    document.getElementById('toggleCoords').addEventListener('change', (e) => {
      this.showCoords = e.target.checked;
      this.renderBoard();
    });

    document.getElementById('toggleAutoFlip').addEventListener('change', (e) => {
      this.autoFlip = e.target.checked;
    });

    // FEN / PGN Actions
    document.getElementById('btnCopyFen').addEventListener('click', () => {
      navigator.clipboard.writeText(this.dom.fenInput.value).then(() => {
        this.showToast('FEN copied to clipboard!');
      });
    });

    document.getElementById('btnLoadFen').addEventListener('click', () => {
      const fen = this.dom.fenInput.value.trim();
      if (this.engine.loadFEN(fen)) {
        this.selectedSquare = null;
        this.validMoves = [];
        this.previewHistoryIndex = -1;
        this.renderBoard();
        this.renderMoveHistory();
        this.updateMaterialAndCaptured();
        this.updateEvaluationBar();
        this.showToast('Position loaded successfully!');
      } else {
        this.showToast('Invalid FEN format!');
      }
    });

    document.getElementById('btnCopyPgn').addEventListener('click', () => {
      navigator.clipboard.writeText(this.dom.pgnTextarea.value).then(() => {
        this.showToast('PGN copied to clipboard!');
      });
    });

    document.getElementById('btnDownloadPgn').addEventListener('click', () => {
      const pgn = this.dom.pgnTextarea.value;
      const blob = new Blob([pgn], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `checkmate_game_${Date.now()}.pgn`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  openNewGameModal() {
    this.dom.modalTitle.textContent = 'Start New Game';
    this.dom.modalSubtitle.textContent = 'Configure game mode, difficulty, and time controls';

    this.dom.modalActions.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px; width:100%; margin-bottom:16px;">
        <div>
          <label class="settings-label" style="text-align:left;">Game Mode</label>
          <select id="modalModeSelect" class="select-custom">
            <option value="ai" ${this.mode === 'ai' ? 'selected' : ''}>Play vs StockBot (AI)</option>
            <option value="pass" ${this.mode === 'pass' ? 'selected' : ''}>Pass & Play (Local 2-Player)</option>
            <option value="ai_vs_ai" ${this.mode === 'ai_vs_ai' ? 'selected' : ''}>StockBot vs StockBot</option>
          </select>
        </div>

        <div id="modalDifficultyWrapper">
          <label class="settings-label" style="text-align:left;">Bot Difficulty</label>
          <select id="modalDifficultySelect" class="select-custom">
            <option value="easy" ${this.difficulty === 'easy' ? 'selected' : ''}>Easy (Beginner • ~800 Elo)</option>
            <option value="medium" ${this.difficulty === 'medium' ? 'selected' : ''}>Medium (Intermediate • ~1400 Elo)</option>
            <option value="hard" ${this.difficulty === 'hard' ? 'selected' : ''}>Hard (Advanced • ~1900 Elo)</option>
          </select>
        </div>

        <div>
          <label class="settings-label" style="text-align:left;">Play As</label>
          <select id="modalColorSelect" class="select-custom">
            <option value="w" ${this.playerColor === 'w' ? 'selected' : ''}>White</option>
            <option value="b" ${this.playerColor === 'b' ? 'selected' : ''}>Black</option>
            <option value="random" ${this.playerColor === 'random' ? 'selected' : ''}>Random Side</option>
          </select>
        </div>

        <div>
          <label class="settings-label" style="text-align:left;">Time Control</label>
          <select id="modalTimeSelect" class="select-custom">
            <option value="0" ${this.timeControl === 0 ? 'selected' : ''}>Casual (Unlimited)</option>
            <option value="60" ${this.timeControl === 60 ? 'selected' : ''}>1 Minute (Bullet)</option>
            <option value="180" ${this.timeControl === 180 ? 'selected' : ''}>3 Minutes (Blitz)</option>
            <option value="300" ${this.timeControl === 300 ? 'selected' : ''}>5 Minutes (Blitz)</option>
            <option value="600" ${this.timeControl === 600 ? 'selected' : ''}>10 Minutes (Rapid)</option>
            <option value="900" ${this.timeControl === 900 ? 'selected' : ''}>15 Minutes (Classical)</option>
          </select>
        </div>
      </div>

      <div style="display:flex; gap:10px; width:100%;">
        <button class="btn-action btn-secondary" id="modalCancelBtn" style="flex:1;">Cancel</button>
        <button class="btn-action btn-primary" id="modalStartBtn" style="flex:1;">Play Now</button>
      </div>
    `;

    const modalModeSelect = document.getElementById('modalModeSelect');
    const diffWrapper = document.getElementById('modalDifficultyWrapper');
    if (modalModeSelect && diffWrapper) {
      modalModeSelect.addEventListener('change', () => {
        diffWrapper.style.display = modalModeSelect.value === 'pass' ? 'none' : 'block';
      });
      diffWrapper.style.display = modalModeSelect.value === 'pass' ? 'none' : 'block';
    }

    document.getElementById('modalCancelBtn').addEventListener('click', () => {
      this.dom.modalOverlay.classList.remove('open');
    });

    document.getElementById('modalStartBtn').addEventListener('click', () => {
      this.mode = document.getElementById('modalModeSelect').value;
      this.playerColor = document.getElementById('modalColorSelect').value;
      this.timeControl = parseInt(document.getElementById('modalTimeSelect').value, 10);

      const modalDiff = document.getElementById('modalDifficultySelect');
      if (modalDiff) {
        this.difficulty = modalDiff.value;
        localStorage.setItem('checkmate_difficulty', this.difficulty);
        const diffSelect = document.getElementById('difficultySelect');
        if (diffSelect) diffSelect.value = this.difficulty;
      }

      this.dom.modalOverlay.classList.remove('open');
      this.startNewGame();
    });

    this.dom.modalOverlay.classList.add('open');
  }
}

// Instantiate application when DOM loads
window.addEventListener('DOMContentLoaded', () => {
  window.chessApp = new ChessApp();
});
