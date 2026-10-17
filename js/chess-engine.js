/**
 * CheckMate - Pure Chess Engine
 * Comprehensive rule implementation:
 * - Legal moves generation
 * - Check, Checkmate, Stalemate detection
 * - Castling (kingside/queenside) with pass-through check validation
 * - En passant capture
 * - Pawn promotion (Q, R, B, N)
 * - Fifty-move rule & Insufficient material & Threefold repetition detection
 * - Standard Algebraic Notation (SAN) generation
 * - FEN Import & Export
 * - Undo & Redo
 */

class ChessEngine {
  constructor() {
    this.reset();
  }

  reset() {
    this.board = this._createInitialBoard();
    this.turn = 'w'; // 'w' | 'b'
    this.castling = {
      w: { k: true, q: true },
      b: { k: true, q: true }
    };
    this.enPassant = null; // { row, col } or null
    this.halfmoveClock = 0;
    this.fullmoveNumber = 1;
    this.history = []; // Array of executed moves with state snapshots
    this.redoStack = [];
    this.positionCounts = {}; // For threefold repetition
    this._recordPosition();
  }

  _createInitialBoard() {
    const board = Array(8).fill(null).map(() => Array(8).fill(null));
    const backRank = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

    // Black pieces (row 0 & 1)
    for (let c = 0; c < 8; c++) {
      board[0][c] = { type: backRank[c], color: 'b' };
      board[1][c] = { type: 'p', color: 'b' };
    }

    // White pieces (row 6 & 7)
    for (let c = 0; c < 8; c++) {
      board[6][c] = { type: 'p', color: 'w' };
      board[7][c] = { type: backRank[c], color: 'w' };
    }

    return board;
  }

  cloneBoard(boardToClone = this.board) {
    return boardToClone.map(row => row.map(cell => cell ? { ...cell } : null));
  }

  getPiece(row, col) {
    if (this._outOfBounds(row, col)) return null;
    return this.board[row][col];
  }

  _outOfBounds(r, c) {
    return r < 0 || r > 7 || c < 0 || c > 7;
  }

  _recordPosition() {
    const key = this.getPositionKey();
    this.positionCounts[key] = (this.positionCounts[key] || 0) + 1;
  }

  _unrecordPosition() {
    const key = this.getPositionKey();
    if (this.positionCounts[key]) {
      this.positionCounts[key]--;
      if (this.positionCounts[key] <= 0) {
        delete this.positionCounts[key];
      }
    }
  }

  getPositionKey() {
    // Unique key for threefold repetition: piece layout + turn + castling rights + enPassant file
    let s = '';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        s += p ? (p.color === 'w' ? p.type.toUpperCase() : p.type) : '.';
      }
    }
    s += `_${this.turn}_`;
    s += (this.castling.w.k ? 'K' : '') + (this.castling.w.q ? 'Q' : '') +
         (this.castling.b.k ? 'k' : '') + (this.castling.b.q ? 'q' : '');
    s += `_${this.enPassant ? `${this.enPassant.row}${this.enPassant.col}` : '-'}`;
    return s;
  }

  getCapturedPieces() {
    const counts = {
      w: { p: 8, n: 2, b: 2, r: 2, q: 1 },
      b: { p: 8, n: 2, b: 2, r: 2, q: 1 }
    };

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (p && p.type !== 'k') {
          counts[p.color][p.type]--;
        }
      }
    }

    const captured = { w: [], b: [] }; // Pieces captured FROM white / black
    for (const color of ['w', 'b']) {
      for (const [type, count] of Object.entries(counts[color])) {
        for (let i = 0; i < count; i++) {
          captured[color].push(type);
        }
      }
    }
    return captured;
  }

  getMaterialScore() {
    const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    let whiteScore = 0;
    let blackScore = 0;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (p) {
          if (p.color === 'w') whiteScore += values[p.type];
          else blackScore += values[p.type];
        }
      }
    }
    return {
      white: whiteScore,
      black: blackScore,
      diff: whiteScore - blackScore // positive means White is up
    };
  }

  isSquareAttacked(targetRow, targetCol, attackerColor, customBoard = this.board) {
    // 1. Pawn attacks
    const pawnRowOffset = attackerColor === 'w' ? 1 : -1;
    const pawnRow = targetRow + pawnRowOffset;
    if (pawnRow >= 0 && pawnRow <= 7) {
      for (const dc of [-1, 1]) {
        const pawnCol = targetCol + dc;
        if (pawnCol >= 0 && pawnCol <= 7) {
          const piece = customBoard[pawnRow][pawnCol];
          if (piece && piece.color === attackerColor && piece.type === 'p') {
            return true;
          }
        }
      }
    }

    // 2. Knight attacks
    const knightOffsets = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1]
    ];
    for (const [dr, dc] of knightOffsets) {
      const nr = targetRow + dr;
      const nc = targetCol + dc;
      if (!this._outOfBounds(nr, nc)) {
        const piece = customBoard[nr][nc];
        if (piece && piece.color === attackerColor && piece.type === 'n') {
          return true;
        }
      }
    }

    // 3. King attacks (1 square radius)
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = targetRow + dr;
        const nc = targetCol + dc;
        if (!this._outOfBounds(nr, nc)) {
          const piece = customBoard[nr][nc];
          if (piece && piece.color === attackerColor && piece.type === 'k') {
            return true;
          }
        }
      }
    }

    // 4. Straight line attacks (Rook, Queen)
    const straightDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dr, dc] of straightDirs) {
      let r = targetRow + dr;
      let c = targetCol + dc;
      while (!this._outOfBounds(r, c)) {
        const piece = customBoard[r][c];
        if (piece) {
          if (piece.color === attackerColor && (piece.type === 'r' || piece.type === 'q')) {
            return true;
          }
          break; // Line blocked
        }
        r += dr;
        c += dc;
      }
    }

    // 5. Diagonal attacks (Bishop, Queen)
    const diagDirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (const [dr, dc] of diagDirs) {
      let r = targetRow + dr;
      let c = targetCol + dc;
      while (!this._outOfBounds(r, c)) {
        const piece = customBoard[r][c];
        if (piece) {
          if (piece.color === attackerColor && (piece.type === 'b' || piece.type === 'q')) {
            return true;
          }
          break; // Line blocked
        }
        r += dr;
        c += dc;
      }
    }

    return false;
  }

  isCheck(color = this.turn, customBoard = this.board) {
    let kingRow = -1;
    let kingCol = -1;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = customBoard[r][c];
        if (p && p.color === color && p.type === 'k') {
          kingRow = r;
          kingCol = c;
          break;
        }
      }
      if (kingRow !== -1) break;
    }

    if (kingRow === -1) return false;
    const opponentColor = color === 'w' ? 'b' : 'w';
    return this.isSquareAttacked(kingRow, kingCol, opponentColor, customBoard);
  }

  _getPseudoLegalMoves(color = this.turn) {
    const moves = [];

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = this.board[r][c];
        if (!piece || piece.color !== color) continue;

        switch (piece.type) {
          case 'p':
            this._getPawnMoves(r, c, color, moves);
            break;
          case 'n':
            this._getKnightMoves(r, c, color, moves);
            break;
          case 'b':
            this._getSlidingMoves(r, c, color, [[-1,-1], [-1,1], [1,-1], [1,1]], moves);
            break;
          case 'r':
            this._getSlidingMoves(r, c, color, [[-1,0], [1,0], [0,-1], [0,1]], moves);
            break;
          case 'q':
            this._getSlidingMoves(r, c, color, [[-1,-1], [-1,1], [1,-1], [1,1], [-1,0], [1,0], [0,-1], [0,1]], moves);
            break;
          case 'k':
            this._getKingMoves(r, c, color, moves);
            break;
        }
      }
    }

    return moves;
  }

  _getPawnMoves(r, c, color, moves) {
    const forward = color === 'w' ? -1 : 1;
    const startRow = color === 'w' ? 6 : 1;
    const promoRow = color === 'w' ? 0 : 7;
    const oppColor = color === 'w' ? 'b' : 'w';

    // 1 square forward
    const nextR = r + forward;
    if (!this._outOfBounds(nextR, c) && !this.board[nextR][c]) {
      if (nextR === promoRow) {
        ['q', 'r', 'b', 'n'].forEach(promo => {
          moves.push({ from: { row: r, col: c }, to: { row: nextR, col: c }, promotion: promo });
        });
      } else {
        moves.push({ from: { row: r, col: c }, to: { row: nextR, col: c } });

        // 2 squares forward from starting rank
        const doubleR = r + 2 * forward;
        if (r === startRow && !this.board[doubleR][c]) {
          moves.push({ from: { row: r, col: c }, to: { row: doubleR, col: c }, isDoublePush: true });
        }
      }
    }

    // Diagonal captures
    for (const dc of [-1, 1]) {
      const capCol = c + dc;
      if (!this._outOfBounds(nextR, capCol)) {
        const destPiece = this.board[nextR][capCol];
        if (destPiece && destPiece.color === oppColor) {
          if (nextR === promoRow) {
            ['q', 'r', 'b', 'n'].forEach(promo => {
              moves.push({ from: { row: r, col: c }, to: { row: nextR, col: capCol }, promotion: promo });
            });
          } else {
            moves.push({ from: { row: r, col: c }, to: { row: nextR, col: capCol } });
          }
        } else if (this.enPassant && this.enPassant.row === nextR && this.enPassant.col === capCol) {
          // En Passant capture
          moves.push({ from: { row: r, col: c }, to: { row: nextR, col: capCol }, isEnPassant: true });
        }
      }
    }
  }

  _getKnightMoves(r, c, color, moves) {
    const offsets = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1]
    ];
    for (const [dr, dc] of offsets) {
      const nr = r + dr;
      const nc = c + dc;
      if (!this._outOfBounds(nr, nc)) {
        const target = this.board[nr][nc];
        if (!target || target.color !== color) {
          moves.push({ from: { row: r, col: c }, to: { row: nr, col: nc } });
        }
      }
    }
  }

  _getSlidingMoves(r, c, color, directions, moves) {
    for (const [dr, dc] of directions) {
      let nr = r + dr;
      let nc = c + dc;
      while (!this._outOfBounds(nr, nc)) {
        const target = this.board[nr][nc];
        if (!target) {
          moves.push({ from: { row: r, col: c }, to: { row: nr, col: nc } });
        } else {
          if (target.color !== color) {
            moves.push({ from: { row: r, col: c }, to: { row: nr, col: nc } });
          }
          break; // Ray blocked
        }
        nr += dr;
        nc += dc;
      }
    }
  }

  _getKingMoves(r, c, color, moves) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (!this._outOfBounds(nr, nc)) {
          const target = this.board[nr][nc];
          if (!target || target.color !== color) {
            moves.push({ from: { row: r, col: c }, to: { row: nr, col: nc } });
          }
        }
      }
    }

    // Castling moves
    const oppColor = color === 'w' ? 'b' : 'w';
    const row = color === 'w' ? 7 : 0;

    if (r === row && c === 4 && !this.isCheck(color)) {
      // Kingside castling
      if (this.castling[color].k &&
          !this.board[row][5] && !this.board[row][6] &&
          !this.isSquareAttacked(row, 5, oppColor) &&
          !this.isSquareAttacked(row, 6, oppColor)) {
        const rook = this.board[row][7];
        if (rook && rook.type === 'r' && rook.color === color) {
          moves.push({ from: { row, col: 4 }, to: { row, col: 6 }, isCastle: 'k' });
        }
      }

      // Queenside castling
      if (this.castling[color].q &&
          !this.board[row][1] && !this.board[row][2] && !this.board[row][3] &&
          !this.isSquareAttacked(row, 3, oppColor) &&
          !this.isSquareAttacked(row, 2, oppColor)) {
        const rook = this.board[row][0];
        if (rook && rook.type === 'r' && rook.color === color) {
          moves.push({ from: { row, col: 4 }, to: { row, col: 2 }, isCastle: 'q' });
        }
      }
    }
  }

  getLegalMoves(color = this.turn) {
    const pseudo = this._getPseudoLegalMoves(color);
    const legal = [];

    for (const move of pseudo) {
      if (this._isMoveLegalAfterSim(move, color)) {
        legal.push(move);
      }
    }

    return legal;
  }

  getMovesForSquare(row, col) {
    return this.getLegalMoves(this.turn).filter(
      m => m.from.row === row && m.from.col === col
    );
  }

  _isMoveLegalAfterSim(move, color) {
    // Clone board and apply move
    const simBoard = this.cloneBoard();
    const piece = simBoard[move.from.row][move.from.col];
    simBoard[move.from.row][move.from.col] = null;

    if (move.isEnPassant) {
      // Clear captured pawn
      const capRow = move.from.row;
      const capCol = move.to.col;
      simBoard[capRow][capCol] = null;
    }

    if (move.promotion) {
      simBoard[move.to.row][move.to.col] = { type: move.promotion, color };
    } else {
      simBoard[move.to.row][move.to.col] = piece;
    }

    if (move.isCastle) {
      const row = move.from.row;
      if (move.isCastle === 'k') {
        simBoard[row][5] = simBoard[row][7];
        simBoard[row][7] = null;
      } else {
        simBoard[row][3] = simBoard[row][0];
        simBoard[row][0] = null;
      }
    }

    // Verify own king not in check
    return !this.isCheck(color, simBoard);
  }

  makeMove(move) {
    const fromPiece = this.board[move.from.row][move.from.col];
    if (!fromPiece) return null;

    const toPiece = this.board[move.to.row][move.to.col];
    const isCapture = !!toPiece || move.isEnPassant;
    const isPawnMove = fromPiece.type === 'p';

    // Store state snapshot for Undo
    const snapshot = {
      board: this.cloneBoard(),
      turn: this.turn,
      castling: JSON.parse(JSON.stringify(this.castling)),
      enPassant: this.enPassant ? { ...this.enPassant } : null,
      halfmoveClock: this.halfmoveClock,
      fullmoveNumber: this.fullmoveNumber,
      move: { ...move, piece: { ...fromPiece } },
      captured: toPiece ? { ...toPiece } : (move.isEnPassant ? { type: 'p', color: this.turn === 'w' ? 'b' : 'w' } : null)
    };

    // Construct Standard Algebraic Notation (SAN) before state modification
    const san = this._computeSAN(move, fromPiece, isCapture);
    snapshot.san = san;

    // Apply move to board
    this.board[move.from.row][move.from.col] = null;

    if (move.isEnPassant) {
      this.board[move.from.row][move.to.col] = null;
    }

    if (move.promotion) {
      this.board[move.to.row][move.to.col] = { type: move.promotion, color: this.turn };
    } else {
      this.board[move.to.row][move.to.col] = fromPiece;
    }

    if (move.isCastle) {
      const r = move.from.row;
      if (move.isCastle === 'k') {
        this.board[r][5] = this.board[r][7];
        this.board[r][7] = null;
      } else {
        this.board[r][3] = this.board[r][0];
        this.board[r][0] = null;
      }
    }

    // Update castling rights
    if (fromPiece.type === 'k') {
      this.castling[this.turn].k = false;
      this.castling[this.turn].q = false;
    } else if (fromPiece.type === 'r') {
      if (move.from.row === 7 && move.from.col === 7) this.castling.w.k = false;
      if (move.from.row === 7 && move.from.col === 0) this.castling.w.q = false;
      if (move.from.row === 0 && move.from.col === 7) this.castling.b.k = false;
      if (move.from.row === 0 && move.from.col === 0) this.castling.b.q = false;
    }

    // If opponent rook is captured in its corner, remove their castling rights
    if (toPiece && toPiece.type === 'r') {
      if (move.to.row === 7 && move.to.col === 7) this.castling.w.k = false;
      if (move.to.row === 7 && move.to.col === 0) this.castling.w.q = false;
      if (move.to.row === 0 && move.to.col === 7) this.castling.b.k = false;
      if (move.to.row === 0 && move.to.col === 0) this.castling.b.q = false;
    }

    // Update En Passant
    if (move.isDoublePush) {
      const epRow = (move.from.row + move.to.row) / 2;
      this.enPassant = { row: epRow, col: move.from.col };
    } else {
      this.enPassant = null;
    }

    // Update clocks
    if (isCapture || isPawnMove) {
      this.halfmoveClock = 0;
    } else {
      this.halfmoveClock++;
    }

    if (this.turn === 'b') {
      this.fullmoveNumber++;
    }

    // Switch turn
    this.turn = this.turn === 'w' ? 'b' : 'w';

    // Append check or checkmate symbol to SAN
    const nextLegal = this.getLegalMoves(this.turn);
    const inCheck = this.isCheck(this.turn);
    if (nextLegal.length === 0 && inCheck) {
      snapshot.san += '#';
    } else if (inCheck) {
      snapshot.san += '+';
    }

    this.history.push(snapshot);
    this.redoStack = []; // Clear redo history on new move
    this._recordPosition();

    return snapshot;
  }

  undo() {
    if (this.history.length === 0) return null;
    this._unrecordPosition();
    const last = this.history.pop();
    this.redoStack.push(last);

    this.board = last.board;
    this.turn = last.turn;
    this.castling = last.castling;
    this.enPassant = last.enPassant;
    this.halfmoveClock = last.halfmoveClock;
    this.fullmoveNumber = last.fullmoveNumber;

    return last;
  }

  redo() {
    if (this.redoStack.length === 0) return null;
    const next = this.redoStack.pop();
    return this.makeMove(next.move);
  }

  _computeSAN(move, piece, isCapture) {
    if (move.isCastle === 'k') return 'O-O';
    if (move.isCastle === 'q') return 'O-O-O';

    const files = 'abcdefgh';
    const ranks = '87654321';
    const toSquare = files[move.to.col] + ranks[move.to.row];

    if (piece.type === 'p') {
      let san = '';
      if (isCapture) {
        san += files[move.from.col] + 'x';
      }
      san += toSquare;
      if (move.promotion) {
        san += '=' + move.promotion.toUpperCase();
      }
      return san;
    }

    const pieceLetter = piece.type.toUpperCase();
    let disambiguation = '';

    // Check if other pieces of the same type and color can also move to toSquare
    const candidates = this.getLegalMoves(this.turn).filter(
      m => m.to.row === move.to.row &&
           m.to.col === move.to.col &&
           (m.from.row !== move.from.row || m.from.col !== move.from.col) &&
           this.board[m.from.row][m.from.col]?.type === piece.type
    );

    if (candidates.length > 0) {
      const sameFile = candidates.some(m => m.from.col === move.from.col);
      const sameRank = candidates.some(m => m.from.row === move.from.row);

      if (!sameFile) {
        disambiguation = files[move.from.col];
      } else if (!sameRank) {
        disambiguation = ranks[move.from.row];
      } else {
        disambiguation = files[move.from.col] + ranks[move.from.row];
      }
    }

    return pieceLetter + disambiguation + (isCapture ? 'x' : '') + toSquare;
  }

  getGameStatus() {
    const legalMoves = this.getLegalMoves(this.turn);
    const inCheck = this.isCheck(this.turn);

    if (legalMoves.length === 0) {
      if (inCheck) {
        const winner = this.turn === 'w' ? 'Black' : 'White';
        return {
          isOver: true,
          type: 'checkmate',
          winner,
          reason: `Checkmate! ${winner} wins.`
        };
      } else {
        return {
          isOver: true,
          type: 'stalemate',
          winner: null,
          reason: 'Draw by stalemate (no legal moves).'
        };
      }
    }

    if (this.halfmoveClock >= 100) {
      return {
        isOver: true,
        type: 'fifty_moves',
        winner: null,
        reason: 'Draw by 50-move rule.'
      };
    }

    if (this.positionCounts[this.getPositionKey()] >= 3) {
      return {
        isOver: true,
        type: 'threefold',
        winner: null,
        reason: 'Draw by threefold repetition.'
      };
    }

    if (this._isInsufficientMaterial()) {
      return {
        isOver: true,
        type: 'insufficient_material',
        winner: null,
        reason: 'Draw by insufficient material.'
      };
    }

    return {
      isOver: false,
      inCheck,
      turn: this.turn
    };
  }

  _isInsufficientMaterial() {
    const pieces = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (p) pieces.push({ ...p, r, c });
      }
    }

    // K vs K
    if (pieces.length === 2) return true;

    // K+B vs K or K+N vs K
    if (pieces.length === 3) {
      return pieces.some(p => p.type === 'b' || p.type === 'n');
    }

    // K+B vs K+B with bishops on the same color
    if (pieces.length === 4) {
      const whiteB = pieces.find(p => p.color === 'w' && p.type === 'b');
      const blackB = pieces.find(p => p.color === 'b' && p.type === 'b');
      if (whiteB && blackB) {
        const whiteSquareColor = (whiteB.r + whiteB.c) % 2;
        const blackSquareColor = (blackB.r + blackB.c) % 2;
        if (whiteSquareColor === blackSquareColor) return true;
      }
    }

    return false;
  }

  exportFEN() {
    let fen = '';
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (!p) {
          empty++;
        } else {
          if (empty > 0) {
            fen += empty;
            empty = 0;
          }
          fen += p.color === 'w' ? p.type.toUpperCase() : p.type;
        }
      }
      if (empty > 0) fen += empty;
      if (r < 7) fen += '/';
    }

    fen += ` ${this.turn} `;

    let castling = '';
    if (this.castling.w.k) castling += 'K';
    if (this.castling.w.q) castling += 'Q';
    if (this.castling.b.k) castling += 'k';
    if (this.castling.b.q) castling += 'q';
    fen += (castling || '-') + ' ';

    if (this.enPassant) {
      const files = 'abcdefgh';
      const ranks = '87654321';
      fen += `${files[this.enPassant.col]}${ranks[this.enPassant.row]} `;
    } else {
      fen += '- ';
    }

    fen += `${this.halfmoveClock} ${this.fullmoveNumber}`;
    return fen;
  }

  loadFEN(fen) {
    try {
      const parts = fen.trim().split(/\s+/);
      if (parts.length < 4) return false;

      const [ranks, turn, castling, ep, halfmove, fullmove] = parts;
      const rankRows = ranks.split('/');
      if (rankRows.length !== 8) return false;

      const newBoard = Array(8).fill(null).map(() => Array(8).fill(null));

      for (let r = 0; r < 8; r++) {
        let c = 0;
        for (const ch of rankRows[r]) {
          if (ch >= '1' && ch <= '8') {
            c += parseInt(ch, 10);
          } else {
            const color = ch === ch.toUpperCase() ? 'w' : 'b';
            newBoard[r][c] = { type: ch.toLowerCase(), color };
            c++;
          }
        }
        if (c !== 8) return false;
      }

      this.board = newBoard;
      this.turn = turn === 'b' ? 'b' : 'w';
      this.castling = {
        w: { k: castling.includes('K'), q: castling.includes('Q') },
        b: { k: castling.includes('k'), q: castling.includes('q') }
      };

      if (ep && ep !== '-') {
        const files = 'abcdefgh';
        const ranks = '87654321';
        this.enPassant = {
          row: ranks.indexOf(ep[1]),
          col: files.indexOf(ep[0])
        };
      } else {
        this.enPassant = null;
      }

      this.halfmoveClock = halfmove ? parseInt(halfmove, 10) : 0;
      this.fullmoveNumber = fullmove ? parseInt(fullmove, 10) : 1;
      this.history = [];
      this.redoStack = [];
      this.positionCounts = {};
      this._recordPosition();
      return true;
    } catch (e) {
      console.error('FEN load error:', e);
      return false;
    }
  }

  exportPGN(whiteName = 'Player 1', blackName = 'Player 2') {
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '.');
    let pgn = `[Event "CheckMate Offline Game"]\n`;
    pgn += `[Site "Local Offline"]\n`;
    pgn += `[Date "${today}"]\n`;
    pgn += `[White "${whiteName}"]\n`;
    pgn += `[Black "${blackName}"]\n`;

    const status = this.getGameStatus();
    let result = '*';
    if (status.isOver) {
      if (status.winner === 'White') result = '1-0';
      else if (status.winner === 'Black') result = '0-1';
      else result = '1/2-1/2';
    }
    pgn += `[Result "${result}"]\n\n`;

    let movesStr = '';
    for (let i = 0; i < this.history.length; i++) {
      if (i % 2 === 0) {
        movesStr += `${Math.floor(i / 2) + 1}. `;
      }
      movesStr += `${this.history[i].san} `;
    }

    if (result !== '*') {
      movesStr += result;
    }

    pgn += movesStr.trim();
    return pgn;
  }
}
