// AI 算法 —— 井字棋 + 消失规则（全局最多 5 颗，超过则消失全局最旧棋子）
// 棋盘值: 0 空, 1 先手(玩家白/粉白), 2 后手(AI 默认紫蓝)
// pieces: { 1: [{row,col},...], 2: [{row,col},...] } 每方棋子队列(FIFO,本方先后)
// order:  [{player,row,col}, ...] 全局落子顺序（FIFO，超过 5 则 shift 最旧）

function cloneBoard(board) {
  return board.map((r) => r.slice());
}

function clonePieces(pieces) {
  return {
    1: pieces[1].map((p) => ({ ...p })),
    2: pieces[2].map((p) => ({ ...p })),
  };
}

function cloneOrder(order) {
  return order.map((o) => ({ ...o }));
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

// 模拟一次落子（全局 5 上限 FIFO），返回新的 { board, pieces, order, winner }
function simulate(board, pieces, order, row, col, player) {
  const nb = cloneBoard(board);
  const np = clonePieces(pieces);
  const no = cloneOrder(order);
  nb[row][col] = player;
  np[player].push({ row, col });
  no.push({ player, row, col });
  if (no.length > 5) {
    const old = no.shift();
    nb[old.row][old.col] = 0;
    np[old.player].shift(); // 同步清理该方本方队列最旧
  }
  return { board: nb, pieces: np, order: no, winner: checkWin(nb) };
}

function availableMoves(board) {
  const moves = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      if (board[r][c] === 0) moves.push({ row: r, col: c });
  return moves;
}

// ========== 难度 1: 简单（陪练级）==========
//   设计目标：让新手/休闲玩家能"正常下完+能赢"，不追求完美防守/连线
//   决策：
//     · 60% 概率直接随机（不做赢/堵判断，新手也能轻松连三）
//     · 40% 才执行浅层启发：
//         - 看到自己能赢：70% 概率去赢（不是 100%）
//         - 看到对手要赢：40% 概率去堵（不是 100%，故意放机会）
//         - 其它仍然随机
function aiEasy(board, pieces, order, aiPlayer) {
  const human = aiPlayer === 1 ? 2 : 1;
  const moves = availableMoves(board);
  if (moves.length === 0) return null;

  if (Math.random() < 0.60) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  // 自己能赢吗？70% 把握
  for (const m of moves) {
    const res = simulate(board, pieces, order, m.row, m.col, aiPlayer);
    if (res.winner === aiPlayer && Math.random() < 0.70) return m;
  }
  // 对手能立刻赢吗？40% 去堵
  for (const m of moves) {
    const res = simulate(board, pieces, order, m.row, m.col, human);
    if (res.winner === human && Math.random() < 0.40) return m;
  }
  return moves[Math.floor(Math.random() * moves.length)];
}

// ========== 难度 2: 正常（稳定陪练）==========
//   设计目标：不会犯"送赢/不堵必输"的明显错误，但没有远瞻
//   决策：
//     · 100% 立即赢
//     · 100% 堵对手立即赢
//     · 否则按位置权重（中心 > 角 > 边）挑个不错的 + 偶尔随机避免呆板
function aiNormal(board, pieces, order, aiPlayer) {
  const human = aiPlayer === 1 ? 2 : 1;
  const moves = availableMoves(board);
  if (moves.length === 0) return null;

  // 立即赢
  for (const m of moves) {
    const res = simulate(board, pieces, order, m.row, m.col, aiPlayer);
    if (res.winner === aiPlayer) return m;
  }
  // 堵对手立即赢
  for (const m of moves) {
    const res = simulate(board, pieces, order, m.row, m.col, human);
    if (res.winner === human) return m;
  }

  // 30% 直接随机，避免死板只用中心/角
  if (Math.random() < 0.30) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  // 位置权重打分：中心(4) > 四角(2) > 四边(1)
  function posScore(r, c) {
    if (r === 1 && c === 1) return 4;
    if ((r === 0 || r === 2) && (c === 0 || c === 2)) return 2;
    return 1;
  }
  let best = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    const s = posScore(m.row, m.col);
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best;
}

// ========== 难度 3: 困难（Minimax + α-β）==========
//   完整 5 层 Minimax + αβ 剪枝 + 启发式位置评估
function aiHard(board, pieces, order, aiPlayer, depth = 5) {
  const human = aiPlayer === 1 ? 2 : 1;
  const MAX_DEPTH = depth;

  function evaluate(b) {
    const win = checkWin(b);
    if (win === aiPlayer) return 10000;
    if (win === human) return -10000;
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

  function minimax(b, pcs, ord, player, d, alpha, beta) {
    const win = checkWin(b);
    if (win !== 0) return win === aiPlayer ? 10000 - (MAX_DEPTH - d) : -10000 + (MAX_DEPTH - d);
    if (d === 0) return evaluate(b);

    const moves = availableMoves(b);
    if (moves.length === 0) return evaluate(b);

    if (player === aiPlayer) {
      let best = -Infinity;
      for (const m of moves) {
        const after = simulate(b, pcs, ord, m.row, m.col, player);
        const v = minimax(after.board, after.pieces, after.order, human, d - 1, alpha, beta);
        best = Math.max(best, v);
        alpha = Math.max(alpha, v);
        if (beta <= alpha) break;
      }
      return best;
    } else {
      let best = Infinity;
      for (const m of moves) {
        const after = simulate(b, pcs, ord, m.row, m.col, player);
        const v = minimax(after.board, after.pieces, after.order, aiPlayer, d - 1, alpha, beta);
        best = Math.min(best, v);
        beta = Math.min(beta, v);
        if (beta <= alpha) break;
      }
      return best;
    }
  }

  const currentMoves = availableMoves(board);
  // 先看立即赢
  for (const m of currentMoves) {
    const after = simulate(board, pieces, order, m.row, m.col, aiPlayer);
    if (after.winner === aiPlayer) return m;
  }
  // 堵立即输
  for (const m of currentMoves) {
    const after = simulate(board, pieces, order, m.row, m.col, human);
    if (after.winner === human) return m;
  }

  let bestMove = currentMoves[0];
  let bestScore = -Infinity;
  // 加一点随机性避免完全可预测
  const candidates = currentMoves.sort(() => Math.random() - 0.5).slice(0, Math.min(5, currentMoves.length));

  for (const m of candidates) {
    const after = simulate(board, pieces, order, m.row, m.col, aiPlayer);
    const score = minimax(after.board, after.pieces, after.order, human, MAX_DEPTH - 1, -Infinity, Infinity);
    if (score > bestScore) { bestScore = score; bestMove = m; }
  }
  return bestMove;
}

function aiMove(board, pieces, order, aiPlayer, difficulty) {
  if (difficulty === 'easy')   return aiEasy(board, pieces, order, aiPlayer);
  if (difficulty === 'normal') return aiNormal(board, pieces, order, aiPlayer);
  return aiHard(board, pieces, order, aiPlayer);
}

window.AI = { aiMove };
