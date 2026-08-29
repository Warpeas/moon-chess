const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// ============ 游戏核心逻辑 ============

// 玩家标记
const P1 = 1; // 先手
const P2 = 2; // 后手

/**
 * 创建空棋盘 3x3，0 表示空
 */
function createBoard() {
  return Array.from({ length: 3 }, () => Array(3).fill(0));
}

/**
 * 检查胜负，返回 { winner: 0|1|2, line: [[r,c],...] }  winner=0 表示未结束或平局
 */
function checkWin(board) {
  const lines = [
    // 行
    [[0, 0], [0, 1], [0, 2]],
    [[1, 0], [1, 1], [1, 2]],
    [[2, 0], [2, 1], [2, 2]],
    // 列
    [[0, 0], [1, 0], [2, 0]],
    [[0, 1], [1, 1], [2, 1]],
    [[0, 2], [1, 2], [2, 2]],
    // 对角线
    [[0, 0], [1, 1], [2, 2]],
    [[0, 2], [1, 1], [2, 0]],
  ];
  for (const line of lines) {
    const [a, b, c] = line;
    const v = board[a[0]][a[1]];
    if (v !== 0 && v === board[b[0]][b[1]] && v === board[c[0]][c[1]]) {
      return { winner: v, line };
    }
  }
  return { winner: 0, line: null };
}

/**
 * 游戏状态类
 */
class Game {
  constructor() {
    this.board = createBoard();
    this.current = P1;
    // 每个玩家的棋子队列（FIFO，最先下的在队首）
    this.pieces = { 1: [], 2: [] };
    this.status = 'playing'; // playing | ended
    this.winner = 0;
    this.winLine = null;
    // 被预告消失的棋子（在对方回合中会闪烁提示）：{player, row, col}
    this.pendingRemove = null;
  }

  /**
   * 尝试落子。返回 {ok, board, current, removed, winner, winLine, pendingRemove}
   * @param {number} row
   * @param {number} col
   * @param {number} player
   */
  place(row, col, player) {
    if (this.status !== 'playing') return { ok: false, reason: '游戏已结束' };
    if (player !== this.current) return { ok: false, reason: '不是你的回合' };
    if (this.board[row][col] !== 0) return { ok: false, reason: '位置已被占用' };

    let removed = null;

    // ✅ 先移除该方最早的棋子（如果它已在棋盘上有 3 颗）
    // 规则：再次轮到该方时，最开始下的棋子先消失
    if (this.pieces[player].length >= 3) {
      const oldest = this.pieces[player].shift();
      this.board[oldest.row][oldest.col] = 0;
      removed = oldest;
    }

    // 再放置新棋子
    this.board[row][col] = player;
    this.pieces[player].push({ row, col });

    // 检查胜负
    const { winner, line } = checkWin(this.board);
    if (winner !== 0) {
      this.status = 'ended';
      this.winner = winner;
      this.winLine = line;
      this.pendingRemove = null;
      // 落子的一方赢了
      return {
        ok: true,
        board: this.board,
        current: 0,
        removed,
        winner: this.winner,
        winLine: this.winLine,
        pendingRemove: null,
      };
    }

    // 切换玩家
    const next = this.current === P1 ? P2 : P1;

    // 预告逻辑：刚下完子的玩家（即 player）如果此刻已有 >= 3 颗棋子，
    // 那么在下一回合（对方的回合）应显示该玩家最早棋子的闪烁提示，
    // 因为下次轮到该玩家下子时，它的最早棋子会先消失
    if (this.pieces[player].length >= 3) {
      const oldest = this.pieces[player][0];
      this.pendingRemove = { player, row: oldest.row, col: oldest.col };
    } else {
      this.pendingRemove = null;
    }

    this.current = next;

    return {
      ok: true,
      board: this.board,
      current: this.current,
      removed,
      winner: 0,
      winLine: null,
      pendingRemove: this.pendingRemove,
    };
  }

  /**
   * 获取当前状态快照
   */
  snapshot() {
    return {
      board: this.board,
      current: this.current,
      status: this.status,
      winner: this.winner,
      winLine: this.winLine,
      pendingRemove: this.pendingRemove,
    };
  }
}

// ============ 房间管理 ============

const rooms = new Map(); // roomCode -> { roomCode, host, players: [socketId,...], game, rematchVotes: {} }

function generateRoomCode() {
  // 6 位大写字母+数字，去掉容易混淆的字符
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function getPublicPlayers(room) {
  return room.players.map((socketId, idx) => ({
    id: socketId,
    seat: idx + 1, // 1 = 先手(host), 2 = 后手
    online: true,
  }));
}

// ============ Socket.IO ============

io.on('connection', (socket) => {
  // 客户端请求创建房间
  socket.on('room:create', () => {
    const code = generateRoomCode();
    const room = {
      roomCode: code,
      players: [socket.id],
      game: new Game(),
      rematchVotes: {}, // socketId -> true
      host: socket.id,
    };
    rooms.set(code, room);
    socket.join(code);
    socket.emit('room:created', {
      roomCode: code,
      roomUrl: `/r/${code}`,
      seat: 1,
      players: getPublicPlayers(room),
      game: room.game.snapshot(),
    });
    console.log(`[ROOM] created ${code} by ${socket.id}`);
  });

  // 客户端请求加入房间
  socket.on('room:join', ({ roomCode }) => {
    const code = (roomCode || '').trim().toUpperCase();
    // 也支持传完整 URL，提取 code
    const match = code.match(/[A-Z0-9]{6}/);
    const finalCode = match ? match[0] : code;

    const room = rooms.get(finalCode);
    if (!room) {
      socket.emit('room:error', { message: '房间不存在' });
      return;
    }
    if (room.players.length >= 2) {
      socket.emit('room:error', { message: '房间已满' });
      return;
    }
    room.players.push(socket.id);
    socket.join(finalCode);
    socket.emit('room:joined', {
      roomCode: finalCode,
      roomUrl: `/r/${finalCode}`,
      seat: 2,
      players: getPublicPlayers(room),
      game: room.game.snapshot(),
    });
    // 通知对方
    io.to(finalCode).emit('room:update', {
      players: getPublicPlayers(room),
      game: room.game.snapshot(),
    });
    console.log(`[ROOM] ${socket.id} joined ${finalCode}`);
  });

  // 重连（刷新页面）
  socket.on('room:reconnect', ({ roomCode, seat }) => {
    const code = (roomCode || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      socket.emit('room:error', { message: '房间不存在' });
      return;
    }
    if (room.players[seat - 1]) {
      // 旧连接还在，替换
      const oldSocketId = room.players[seat - 1];
      io.sockets.sockets.get(oldSocketId)?.leave(code);
    }
    room.players[seat - 1] = socket.id;
    socket.join(code);
    socket.emit('room:joined', {
      roomCode: code,
      roomUrl: `/r/${code}`,
      seat,
      players: getPublicPlayers(room),
      game: room.game.snapshot(),
    });
    io.to(code).emit('room:update', {
      players: getPublicPlayers(room),
      game: room.game.snapshot(),
    });
  });

  // 落子
  socket.on('game:place', ({ roomCode, row, col }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const seat = room.players.indexOf(socket.id);
    if (seat === -1) return;
    const playerNum = seat + 1;
    const result = room.game.place(row, col, playerNum);
    if (!result.ok) {
      socket.emit('game:error', { reason: result.reason });
      return;
    }
    io.to(roomCode).emit('game:update', result);
    // 重置重开投票
    if (room.game.status === 'ended') {
      room.rematchVotes = {};
    }
  });

  // 重开投票
  socket.on('game:rematch', ({ roomCode, vote }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const seat = room.players.indexOf(socket.id);
    if (seat === -1) return;
    if (room.game.status !== 'ended') return;

    if (vote) room.rematchVotes[socket.id] = true;
    else delete room.rematchVotes[socket.id];

    io.to(roomCode).emit('game:rematchUpdate', {
      votes: Object.keys(room.rematchVotes).length,
      needed: room.players.length,
    });

    // 双方都同意则重开
    if (room.players.every((id) => room.rematchVotes[id])) {
      room.game = new Game();
      room.rematchVotes = {};
      io.to(roomCode).emit('game:restarted', { game: room.game.snapshot() });
    }
  });

  // 强制重开（主机可以直接重开）
  socket.on('game:restart', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    if (room.host !== socket.id) return;
    room.game = new Game();
    room.rematchVotes = {};
    io.to(roomCode).emit('game:restarted', { game: room.game.snapshot() });
  });

  // 玩家断开
  socket.on('disconnect', () => {
    for (const [code, room] of rooms.entries()) {
      if (room.players.includes(socket.id)) {
        io.to(code).emit('room:playerLeft', { players: getPublicPlayers(room) });
        // 延迟清理：给重连留时间（这里为简单，直接踢掉）
        room.players = room.players.filter((id) => id !== socket.id);
        if (room.players.length === 0) {
          rooms.delete(code);
          console.log(`[ROOM] ${code} destroyed (empty)`);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Moon Chess server listening on port ${PORT}`);
});
