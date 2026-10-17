/**
 * CheckMate - AI Chess Engine
 * Minimax with Alpha-Beta Pruning, Move Ordering, Quiescence Search, and Piece-Square Tables (PST).
 * Includes difficulty levels (Easy, Medium, Hard, Master) and position evaluation for the real-time advantage bar.
 */

class ChessAI {
  constructor() {
    this.pieceValues = {
      p: 100,
      n: 320,
      b: 330,
      r: 500,
      q: 900,
      k: 20000
    };

    // Piece-Square Tables (oriented for White; mirrored for Black)
    this.pst = {
      p: [
        [  0,  0,  0,  0,  0,  0,  0,  0],
        [ 50, 50, 50, 50, 50, 50, 50, 50],
        [ 10, 10, 20, 30, 30, 20, 10, 10],
        [  5,  5, 10, 25, 25, 10,  5,  5],
        [  0,  0,  0, 20, 20,  0,  0,  0],
        [  5, -5,-10,  0,  0,-10, -5,  5],
        [  5, 10, 10,-20,-20, 10, 10,  5],
        [  0,  0,  0,  0,  0,  0,  0,  0]
      ],
      n: [
        [-50,-40,-30,-30,-30,-30,-40,-50],
        [-40,-20,  0,  0,  0,  0,-20,-40],
        [-30,  0, 10, 15, 15, 10,  0,-30],
        [-30,  5, 15, 20, 20, 15,  5,-30],
        [-30,  0, 15, 20, 20, 15,  0,-30],
        [-30,  5, 10, 15, 15, 10,  5,-30],
        [-40,-20,  0,  5,  5,  0,-20,-40],
        [-50,-40,-30,-30,-30,-30,-40,-50]
      ],
      b: [
        [-20,-10,-10,-10,-10,-10,-10,-20],
        [-10,  0,  0,  0,  0,  0,  0,-10],
        [-10,  0,  5, 10, 10,  5,  0,-10],
        [-10,  5,  5, 10, 10,  5,  5,-10],
        [-10,  0, 10, 10, 10, 10,  0,-10],
        [-10, 10, 10, 10, 10, 10, 10,-10],
        [-10,  5,  0,  0,  0,  0,  5,-10],
        [-20,-10,-10,-10,-10,-10,-10,-20]
      ],
      r: [
        [  0,  0,  0,  0,  0,  0,  0,  0],
        [  5, 10, 10, 10, 10, 10, 10,  5],
        [ -5,  0,  0,  0,  0,  0,  0, -5],
        [ -5,  0,  0,  0,  0,  0,  0, -5],
        [ -5,  0,  0,  0,  0,  0,  0, -5],
        [ -5,  0,  0,  0,  0,  0,  0, -5],
        [ -5,  0,  0,  0,  0,  0,  0, -5],
        [  0,  0,  0,  5,  5,  0,  0,  0]
      ],
      q: [
        [-20,-10,-10, -5, -5,-10,-10,-20],
        [-10,  0,  0,  0,  0,  0,  0,-10],
        [-10,  0,  5,  5,  5,  5,  0,-10],
        [ -5,  0,  5,  5,  5,  5,  0, -5],
        [  0,  0,  5,  5,  5,  5,  0, -5],
        [-10,  5,  5,  5,  5,  5,  0,-10],
        [-10,  0,  5,  0,  0,  0,  0,-10],
        [-20,-10,-10, -5, -5,-10,-10,-20]
      ],
      k_mg: [ // King middlegame: castled safety
        [-30,-40,-40,-50,-50,-40,-40,-30],
        [-30,-40,-40,-50,-50,-40,-40,-30],
        [-30,-40,-40,-50,-50,-40,-40,-30],
        [-30,-40,-40,-50,-50,-40,-40,-30],
        [-20,-30,-30,-40,-40,-30,-30,-20],
        [-10,-20,-20,-20,-20,-20,-20,-10],
        [ 20, 20,  0,  0,  0,  0, 20, 20],
        [ 20, 30, 10,  0,  0, 10, 30, 20]
      ],
      k_eg: [ // King endgame: active king centralized
        [-50,-40,-30,-20,-20,-30,-40,-50],
        [-30,-20,-10,  0,  0,-10,-20,-30],
        [-30,-10, 20, 30, 30, 20,-10,-30],
        [-30,-10, 30, 40, 40, 30,-10,-30],
        [-30,-10, 30, 40, 40, 30,-10,-30],
        [-30,-10, 20, 30, 30, 20,-10,-30],
        [-30,-30,  0,  0,  0,  0,-30,-30],
        [-50,-30,-30,-30,-30,-30,-30,-50]
      ]
    };
  }

  isEndgame(engine) {
    // Total non-pawn material (excluding kings)
    let nonPawnCount = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = engine.board[r][c];
        if (p && p.type !== 'k' && p.type !== 'p') {
          nonPawnCount++;
        }
      }
    }
    return nonPawnCount <= 4;
  }

  evaluate(engine) {
    const status = engine.getGameStatus();
    if (status.isOver) {
      if (status.type === 'checkmate') {
        return status.winner === 'White' ? 50000 : -50000;
      }
      return 0; // Draw
    }

    const endgame = this.isEndgame(engine);
    let score = 0;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = engine.board[r][c];
        if (!piece) continue;

        const val = this.pieceValues[piece.type];
        let pstVal = 0;

        if (piece.type === 'k') {
          const table = endgame ? this.pst.k_eg : this.pst.k_mg;
          pstVal = piece.color === 'w' ? table[r][c] : table[7 - r][c];
        } else {
          const table = this.pst[piece.type];
          pstVal = piece.color === 'w' ? table[r][c] : table[7 - r][c];
        }

        const totalPieceScore = val + pstVal;
        if (piece.color === 'w') {
          score += totalPieceScore;
        } else {
          score -= totalPieceScore;
        }
      }
    }

    return score;
  }

  orderMoves(moves, engine) {
    return moves.slice().sort((a, b) => {
      let scoreA = 0;
      let scoreB = 0;

      const pA = engine.board[a.from.row][a.from.col];
      const pB = engine.board[b.from.row][b.from.col];
      const targetA = engine.board[a.to.row][a.to.col];
      const targetB = engine.board[b.to.row][b.to.col];

      // MVV - LVA (Most Valuable Victim - Least Valuable Attacker)
      if (targetA) {
        scoreA += 10 * this.pieceValues[targetA.type] - this.pieceValues[pA.type];
      }
      if (targetB) {
        scoreB += 10 * this.pieceValues[targetB.type] - this.pieceValues[pB.type];
      }

      if (a.isEnPassant) scoreA += 100;
      if (b.isEnPassant) scoreB += 100;

      if (a.promotion) scoreA += 800;
      if (b.promotion) scoreB += 800;

      if (a.isCastle) scoreA += 60;
      if (b.isCastle) scoreB += 60;

      return scoreB - scoreA;
    });
  }

  quiescence(engine, alpha, beta, isMaximizing, depth = 0, maxDepth = 2) {
    const standPat = this.evaluate(engine);

    if (depth >= maxDepth) return standPat;

    if (isMaximizing) {
      if (standPat >= beta) return beta;
      if (alpha < standPat) alpha = standPat;

      // Only search captures in quiescence
      const captures = engine.getLegalMoves('w').filter(
        m => engine.board[m.to.row][m.to.col] || m.isEnPassant
      );
      const ordered = this.orderMoves(captures, engine);

      for (const move of ordered) {
        engine.makeMove(move);
        const score = this.quiescence(engine, alpha, beta, false, depth + 1, maxDepth);
        engine.undo();

        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
      }
      return alpha;
    } else {
      if (standPat <= alpha) return alpha;
      if (beta > standPat) beta = standPat;

      const captures = engine.getLegalMoves('b').filter(
        m => engine.board[m.to.row][m.to.col] || m.isEnPassant
      );
      const ordered = this.orderMoves(captures, engine);

      for (const move of ordered) {
        engine.makeMove(move);
        const score = this.quiescence(engine, alpha, beta, true, depth + 1, maxDepth);
        engine.undo();

        if (score <= alpha) return alpha;
        if (score < beta) beta = score;
      }
      return beta;
    }
  }

  minimax(engine, depth, alpha, beta, isMaximizing, useQuiescence = false) {
    if (depth === 0) {
      if (useQuiescence) {
        return { score: this.quiescence(engine, alpha, beta, isMaximizing) };
      }
      return { score: this.evaluate(engine) };
    }

    const color = isMaximizing ? 'w' : 'b';
    const moves = engine.getLegalMoves(color);

    if (moves.length === 0) {
      if (engine.isCheck(color)) {
        // Checkmate: prioritize faster mates by subtracting/adding depth
        return { score: isMaximizing ? -50000 - depth : 50000 + depth };
      }
      return { score: 0 }; // Stalemate
    }

    const orderedMoves = this.orderMoves(moves, engine);
    let bestMove = orderedMoves[0];

    if (isMaximizing) {
      let maxEval = -Infinity;
      for (const move of orderedMoves) {
        engine.makeMove(move);
        const evaluation = this.minimax(engine, depth - 1, alpha, beta, false, useQuiescence).score;
        engine.undo();

        if (evaluation > maxEval) {
          maxEval = evaluation;
          bestMove = move;
        }
        alpha = Math.max(alpha, evaluation);
        if (beta <= alpha) break; // Beta cutoff
      }
      return { score: maxEval, move: bestMove };
    } else {
      let minEval = Infinity;
      for (const move of orderedMoves) {
        engine.makeMove(move);
        const evaluation = this.minimax(engine, depth - 1, alpha, beta, true, useQuiescence).score;
        engine.undo();

        if (evaluation < minEval) {
          minEval = evaluation;
          bestMove = move;
        }
        beta = Math.min(beta, evaluation);
        if (beta <= alpha) break; // Alpha cutoff
      }
      return { score: minEval, move: bestMove };
    }
  }

  getBestMoveAsync(engine, difficulty = 'medium') {
    return new Promise(resolve => {
      // Use setTimeout so the UI render thread does not freeze
      setTimeout(() => {
        const color = engine.turn;
        const isMaximizing = color === 'w';
        const legalMoves = engine.getLegalMoves(color);

        if (legalMoves.length === 0) {
          resolve(null);
          return;
        }

        // Easy: 40% blunder / random, Depth 1
        if (difficulty === 'easy') {
          if (Math.random() < 0.4) {
            const randomMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];
            resolve(randomMove);
            return;
          }
          const res = this.minimax(engine, 1, -Infinity, Infinity, isMaximizing, false);
          resolve(res.move || legalMoves[0]);
          return;
        }

        // Medium: Depth 2
        if (difficulty === 'medium') {
          const res = this.minimax(engine, 2, -Infinity, Infinity, isMaximizing, false);
          resolve(res.move || legalMoves[0]);
          return;
        }

        // Hard: Depth 3
        if (difficulty === 'hard') {
          const res = this.minimax(engine, 3, -Infinity, Infinity, isMaximizing, true);
          resolve(res.move || legalMoves[0]);
          return;
        }

        // Master: Depth 4 with quiescence
        if (difficulty === 'master') {
          const res = this.minimax(engine, 4, -Infinity, Infinity, isMaximizing, true);
          resolve(res.move || legalMoves[0]);
          return;
        }

        // Default fallback
        const res = this.minimax(engine, 2, -Infinity, Infinity, isMaximizing, false);
        resolve(res.move || legalMoves[0]);
      }, 50);
    });
  }
}

const chessAI = new ChessAI();
