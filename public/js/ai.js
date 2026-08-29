// AI 算法 —— 井字棋 + 消失规则
// 棋盘值: 0 空, 1 先手(玩家), 2 后手(AI 默认)
// pieces: { 1: [{row,col},...], 2: [{row,col},...] }  FIFO 队列

function cloneBoard(board) {
  return board.map((r) => r.slice());
}

function clonePieces(pieces) {
  return {
    1: pieces[1].map((p) => ({ ...p })),
    2: pieces[2].map((p) => ({ ...p })),
  };
}

function checkWin(board) {
  const lines = [
    [[0,0],[0,1],[0,2]],[[1,0],[1,1],[1,2]],[[2,0],[2,1],[2,2]],
    [[0,0],[1,0],[2,0]],[[0,1],[1,1],[2,1]],[[0,2],[1,2],[2,2]],
    [[0,0],[1,1],[2,2]],[[0,2],[1,1],[2,0]],
  ];
  for (const line of lines) {
    const [a,b,c] = line;
    const v = board[a[0]][a[1]];
    if (v !== 0 && v === board[b[0]][b[1]] && v === board[c[0]][c[1]]) return v;
  }
  return 0;
}

// 模拟一次落子，返回新的 { board, pieces, winner }
function simulate(board, pieces, row, col, player) {
  const nb = cloneBoard(board);
  const np = clonePieces(pieces);
  // ✅ 先移除该方最早的棋子（如果已有 3 颗）
  if (np[player].length >= 3) {
    const old = np[player].shift();
    nb[old.row][old.col] = 0;
  }
  nb[row][col] = player;
  np[player].push({ row, col });
  return { board: nb, pieces: np, winner: checkWin(nb) };
}

function availableMoves(board) {
  const moves = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      if (board[r][c] === 0) moves.push({ row: r, col: c });
  return moves;
}

// ========== 难度 1: 简单 ==========
// 随机落子，但优先看是否能直接赢或必须堵对方
function aiEasy(board, pieces, aiPlayer) {
  const human = aiPlayer === 1 ? 2 : 1;
  const moves = availableMoves(board);

  // 先找能赢的
  for (const m of moves) {
    const res = simulate(board, pieces, m.row, m.col, aiPlayer);
    if (res.winner === aiPlayer) return m;
  }
  // 再找必须堵的
  for (const m of moves) {
    const res = simulate(board, pieces, m.row, m.col, human);
    if (res.winner === human) return m;
  }
  // 随机
  return moves[Math.floor(Math.random() * moves.length)];
}

// ========== 难度 2: 正常 ==========
// 带 2 步前瞻的 minimax，考虑消失机制
function aiNormal(board, pieces, aiPlayer) {
  const human = aiPlayer === 1 ? 2 : 1;
  const moves = availableMoves(board);
  if (moves.length === 0) return null;

  // 立即赢
  for (const m of moves) {
    const res = simulate(board, pieces, m.row, m.col, aiPlayer);
    if (res.winner === aiPlayer) return m;
  }
  // 堵对手立即赢
  for (const m of moves) {
    const res = simulate(board, pieces, m.row, m.col, human);
    if (res.winner === human) return m;
  }

  // 2 层前瞻打分
  let best = moves[0];
  let bestScore = -Infinity;

  for (const m of moves) {
    const after = simulate(board, pieces, m.row, m.col, aiPlayer);
    if (after.winner === aiPlayer) return m;

    // 对手最好回应
    let worst = -Infinity;
    const enemyMoves = availableMoves(after.board);
    for (const em of enemyMoves) {
      const eAfter = simulate(after.board, after.pieces, em.row, em.col, human);
      if (eAfter.winner === human) { worst = 100; break; }
      if (eAfter.winner === aiPlayer) { worst = -100; continue; }
      worst = Math.max(worst, 0); // 未知局面简化为 0
    }
    const score = -worst;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}

// ========== 难度 3: 困难 ==========
// 完整 minimax + alpha-beta 剪枝，深度 5
function aiHard(board, pieces, aiPlayer, depth = 5) {
  const human = aiPlayer === 1 ? 2 : 1;
  const MAX_DEPTH = depth;

  function evaluate(b) {
    // 给局面打分: 看双方未来能形成的威胁
    const win = checkWin(b);
    if (win === aiPlayer) return 10000;
    if (win === human) return -10000;
    // 简单启发：中心 +2，角落 +1
    let score = 0;
    const center = b[1][1];
    if (center === aiPlayer) score += 3;
    if (center === human) score -= 3;
    const corners = [[0,0],[0,2],[2,0],[2,2]];
    for (const [r,c] of corners) {
      if (b[r][c] === aiPlayer) score += 1;
      if (b[r][c] === human) score -= 1;
    }
    return score;
  }

  function minimax(b, pcs, player, d, alpha, beta) {
    const win = checkWin(b);
    if (win !== 0) return win === aiPlayer ? 10000 - (MAX_DEPTH - d) : -10000 + (MAX_DEPTH - d);
    if (d === 0) return evaluate(b);

    const moves = availableMoves(b);
    if (moves.length === 0) return evaluate(b);

    if (player === aiPlayer) {
      let best = -Infinity;
      for (const m of moves) {
        const after = simulate(b, pcs, m.row, m.col, player);
        const v = minimax(after.board, after.pieces, human, d - 1, alpha, beta);
        best = Math.max(best, v);
        alpha = Math.max(alpha, v);
        if (beta <= alpha) break;
      }
      return best;
    } else {
      let best = Infinity;
      for (const m of moves) {
        const after = simulate(b, pcs, m.row, m.col, player);
        const v = minimax(after.board, after.pieces, aiPlayer, d - 1, alpha, beta);
        best = Math.min(best, v);
        beta = Math.min(beta, v);
        if (beta <= alpha) break;
      }
      return best;
    }
  }

  // 先看立即赢
  const currentMoves = availableMoves(board);
  for (const m of currentMoves) {
    const after = simulate(board, pieces, m.row, m.col, aiPlayer);
    if (after.winner === aiPlayer) return m;
  }
  // 堵立即输
  for (const m of currentMoves) {
    const after = simulate(board, pieces, m.row, m.col, human);
    if (after.winner === human) return m;
  }

  let bestMove = currentMoves[0];
  let bestScore = -Infinity;
  // 加一点随机性避免完全可预测
  const candidates = currentMoves.sort(() => Math.random() - 0.5).slice(0, Math.min(5, currentMoves.length));

  for (const m of candidates) {
    const after = simulate(board, pieces, m.row, m.col, aiPlayer);
    const score = minimax(after.board, after.pieces, human, MAX_DEPTH - 1, -Infinity, Infinity);
    if (score > bestScore) { bestScore = score; bestMove = m; }
  }
  return bestMove;
}

function aiMove(board, pieces, aiPlayer, difficulty) {
  if (difficulty === 'easy') return aiEasy(board, pieces, aiPlayer);
  if (difficulty === 'normal') return aiNormal(board, pieces, aiPlayer);
  return aiHard(board, pieces, aiPlayer);
}

window.AI = { aiMove };
