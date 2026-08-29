// ======== 客户端游戏核心 ========

const P1 = 1;
const P2 = 2;

class LocalGame {
  constructor() {
    this.reset();
  }
  reset() {
    this.board = Array.from({ length: 3 }, () => Array(3).fill(0));
    this.current = P1;
    this.pieces = { 1: [], 2: [] };
    this.status = 'playing';
    this.winner = 0;
    this.winLine = null;
    this.pendingRemove = null;
  }
  place(row, col, player) {
    if (this.status !== 'playing') return { ok: false };
    if (player !== this.current) return { ok: false };
    if (this.board[row][col] !== 0) return { ok: false };

    let removed = null;
    // ✅ 先移除该方最早的棋子（如果已有 3 颗）
    if (this.pieces[player].length >= 3) {
      const old = this.pieces[player].shift();
      this.board[old.row][old.col] = 0;
      removed = old;
    }
    // 再放下新的
    this.board[row][col] = player;
    this.pieces[player].push({ row, col });

    const win = this._checkWin(this.board);
    if (win.winner !== 0) {
      this.status = 'ended';
      this.winner = win.winner;
      this.winLine = win.line;
      this.pendingRemove = null;
      return { ok: true, removed, winner: win.winner, winLine: win.line, pendingRemove: null, current: 0 };
    }

    const next = this.current === P1 ? P2 : P1;
    // 预告刚下完子的玩家（player）最早的棋子，在对方的回合显示闪烁
    if (this.pieces[player].length >= 3) {
      const oldest = this.pieces[player][0];
      this.pendingRemove = { player, row: oldest.row, col: oldest.col };
    } else {
      this.pendingRemove = null;
    }
    this.current = next;
    return { ok: true, removed, winner: 0, winLine: null, pendingRemove: this.pendingRemove, current: this.current };
  }
  _checkWin(board) {
    const lines = [
      [[0,0],[0,1],[0,2]],[[1,0],[1,1],[1,2]],[[2,0],[2,1],[2,2]],
      [[0,0],[1,0],[2,0]],[[0,1],[1,1],[2,1]],[[0,2],[1,2],[2,2]],
      [[0,0],[1,1],[2,2]],[[0,2],[1,1],[2,0]],
    ];
    for (const line of lines) {
      const [a,b,c] = line;
      const v = board[a[0]][a[1]];
      if (v !== 0 && v === board[b[0]][b[1]] && v === board[c[0]][c[1]]) return { winner: v, line };
    }
    return { winner: 0, line: null };
  }
  snapshot() {
    return {
      board: this.board.map((r) => r.slice()),
      current: this.current,
      status: this.status,
      winner: this.winner,
      winLine: this.winLine,
      pendingRemove: this.pendingRemove,
      pieces: { 1: this.pieces[1].map(p => ({...p})), 2: this.pieces[2].map(p => ({...p})) }
    };
  }
}

// ======== 应用控制器 ========

const App = {
  // 模式: menu | local | online
  mode: 'menu',
  local: null,
  aiPlayer: P2,
  difficulty: 'normal',

  // 联机
  socket: null,
  roomCode: null,
  mySeat: 1,
  roomPlayers: [],
  rematchVotes: { count: 0, needed: 0, mine: false },

  // 渲染所需快照
  state: null, // {board,current,status,winner,winLine,pendingRemove,pieces}

  init() {
    // 检查 URL 是否为房间链接
    const path = location.pathname;
    const m = path.match(/^\/r\/([A-Z0-9]{6})$/i);
    if (m) {
      this.roomCode = m[1].toUpperCase();
      this.goOnline();
    } else {
      this.showMenu();
    }

    // 菜单按钮
    document.getElementById('btn-local').addEventListener('click', () => this.showDifficultySelect());
    document.getElementById('btn-online-create').addEventListener('click', () => this.createRoom());
    document.getElementById('btn-online-join').addEventListener('click', () => this.showJoinDialog());

    document.getElementById('diff-easy').addEventListener('click', () => this.startLocal('easy'));
    document.getElementById('diff-normal').addEventListener('click', () => this.startLocal('normal'));
    document.getElementById('diff-hard').addEventListener('click', () => this.startLocal('hard'));

    // 对局界面按钮
    document.getElementById('btn-restart').addEventListener('click', () => this.handleRestart());
    document.getElementById('btn-exit').addEventListener('click', () => this.exitToMenu());

    // 重开投票
    document.getElementById('btn-rematch-yes').addEventListener('click', () => this.voteRematch(true));
    document.getElementById('btn-rematch-no').addEventListener('click', () => this.voteRematch(false));
    document.getElementById('btn-force-restart').addEventListener('click', () => this.handleRestart());

    // 棋盘点击
    document.querySelectorAll('.cell').forEach((el) => {
      el.addEventListener('click', () => {
        const row = parseInt(el.dataset.row);
        const col = parseInt(el.dataset.col);
        this.handleCellClick(row, col);
      });
    });

    // 加入房间对话框
    document.getElementById('btn-join-cancel').addEventListener('click', () => this.hideJoinDialog());
    document.getElementById('btn-join-confirm').addEventListener('click', () => {
      const val = document.getElementById('join-input').value;
      if (!val.trim()) return;
      if (this.socket) {
        this.socket.emit('room:join', { roomCode: val });
        this.hideJoinDialog();
      }
    });

    // 游戏结果对话框 退出按钮
    document.getElementById('btn-result-exit').addEventListener('click', () => {
      document.getElementById('result-overlay').classList.remove('show');
      this.exitToMenu();
    });

    window.addEventListener('resize', () => this.render());
  },

  showMenu() {
    this.mode = 'menu';
    document.getElementById('menu').classList.add('show');
    document.getElementById('game').classList.remove('show');
    document.getElementById('room-info').classList.remove('show');
    document.getElementById('difficulty-select').classList.remove('show');
    document.getElementById('result-overlay').classList.remove('show');
    document.getElementById('rematch-bar').classList.remove('show');
  },

  showDifficultySelect() {
    document.getElementById('difficulty-select').classList.add('show');
  },

  hideJoinDialog() {
    document.getElementById('join-dialog').classList.remove('show');
  },

  showJoinDialog() {
    document.getElementById('join-dialog').classList.add('show');
    document.getElementById('join-input').value = '';
    setTimeout(() => document.getElementById('join-input').focus(), 50);
  },

  startLocal(difficulty) {
    this.difficulty = difficulty;
    this.mode = 'local';
    this.local = new LocalGame();
    this.state = this.local.snapshot();
    document.getElementById('menu').classList.remove('show');
    document.getElementById('difficulty-select').classList.remove('show');
    document.getElementById('game').classList.add('show');
    document.getElementById('room-info').classList.remove('show');
    this.hideDialogs();
    this.render();
  },

  hideDialogs() {
    document.getElementById('difficulty-select').classList.remove('show');
    document.getElementById('join-dialog').classList.remove('show');
  },

  // ======== 联机 ========
  goOnline() {
    this.mode = 'online';
    if (!this.socket) {
      this.socket = io();
      this.setupSocket();
    }
    document.getElementById('menu').classList.remove('show');
    document.getElementById('game').classList.add('show');
    document.getElementById('room-info').classList.add('show');
    document.getElementById('room-info').classList.add('show');

    if (this.roomCode) {
      // URL 带房间号
      this.socket.emit('room:join', { roomCode: this.roomCode });
    }
  },

  createRoom() {
    this.goOnline();
    this.socket.emit('room:create');
  },

  setupSocket() {
    const s = this.socket;

    s.on('room:created', (data) => {
      this.roomCode = data.roomCode;
      this.mySeat = data.seat;
      this.roomPlayers = data.players;
      history.replaceState(null, '', `/r/${this.roomCode}`);
      this.updateRoomUI(data);
      this.state = data.game;
      this.render();
    });

    s.on('room:joined', (data) => {
      this.roomCode = data.roomCode;
      this.mySeat = data.seat;
      this.roomPlayers = data.players;
      history.replaceState(null, '', `/r/${this.roomCode}`);
      this.updateRoomUI(data);
      this.state = data.game;
      this.render();
    });

    s.on('room:update', (data) => {
      this.roomPlayers = data.players;
      if (data.game) this.state = data.game;
      this.updateRoomUI(data);
      this.render();
    });

    s.on('room:error', ({ message }) => {
      alert(message);
      this.exitToMenu();
    });

    s.on('room:playerLeft', () => {
      this.updateRoomUI({});
    });

    s.on('game:update', (data) => {
      this.state = { ...this.state, ...data };
      // 也更新 pieces 便于闪烁预告判断
      if (data.current !== undefined) this.state.current = data.current;
      if (data.pendingRemove !== undefined) this.state.pendingRemove = data.pendingRemove;
      if (data.status !== undefined) this.state.status = data.status;
      if (data.winner !== undefined) this.state.winner = data.winner;
      if (data.winLine !== undefined) this.state.winLine = data.winLine;

      // 更新 pieces 映射：前端重建
      this.rebuildPiecesFromBoard();
      this.render();

      // AI 回合（联机不需要）
    });

    s.on('game:rematchUpdate', (data) => {
      this.rematchVotes.count = data.votes;
      this.rematchVotes.needed = data.needed;
      this.renderResult();
    });

    s.on('game:restarted', ({ game }) => {
      this.state = game;
      this.rebuildPiecesFromBoard();
      document.getElementById('result-overlay').classList.remove('show');
      this.render();
    });

    s.on('game:error', ({ reason }) => {
      console.warn('game error:', reason);
    });
  },

  // 从 board + pendingRemove 重建 pieces 队列（联机同步时可用）
  rebuildPiecesFromBoard() {
    if (!this.state) return;
    // 联机时 pieces 信息会跟落子事件一起过去，但为了稳妥，这里从 board 重新生成（不含顺序，仅用于渲染）
    // 真实队列由服务端维护，客户端仅需 board 和 pendingRemove 即可渲染
    if (!this.state.pieces) {
      this.state.pieces = { 1: [], 2: [] };
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const v = this.state.board[r][c];
          if (v !== 0) this.state.pieces[v].push({ row: r, col: c });
        }
      }
    }
  },

  updateRoomUI(data) {
    const info = document.getElementById('room-info');
    if (this.mode !== 'online') { info.classList.remove('show'); return; }
    info.classList.add('show');
    document.getElementById('room-code').textContent = this.roomCode || '--';
    const url = location.origin + '/r/' + (this.roomCode || '');
    document.getElementById('room-link').textContent = url;
    document.getElementById('room-link').href = url;

    const hostSeat = (this.mySeat === 1);
    const forceRestart = document.getElementById('btn-force-restart');
    forceRestart.classList.toggle('show', !!(hostSeat && this.state && this.state.status === 'ended'));

    // 复制链接
    const copyBtn = document.getElementById('btn-copy');
    copyBtn.onclick = () => {
      navigator.clipboard?.writeText(url).then(() => {
        copyBtn.textContent = '已复制 ✓';
        setTimeout(() => copyBtn.textContent = '复制', 1500);
      });
    };
  },

  // ======== 点击处理 ========
  handleCellClick(row, col) {
    if (!this.state || this.state.status !== 'playing') return;

    if (this.mode === 'local') {
      // 本地模式：玩家固定 P1，AI 为 P2
      if (this.state.current !== P1) return;
      const res = this.local.place(row, col, P1);
      if (!res.ok) return;
      this.state = this.local.snapshot();
      this.render();
      // AI 自动下
      if (this.state.status === 'playing' && this.state.current === P2) {
        setTimeout(() => {
          const move = AI.aiMove(this.local.board, this.local.pieces, P2, this.difficulty);
          if (move) {
            this.local.place(move.row, move.col, P2);
            this.state = this.local.snapshot();
            this.render();
          }
        }, 450);
      }
    } else if (this.mode === 'online') {
      if (this.state.current !== this.mySeat) return;
      const seat = this.mySeat;
      // 本地预判一下（优化体验）
      this.socket.emit('game:place', { roomCode: this.roomCode, row, col, seat });
    }
  },

  handleRestart() {
    if (this.mode === 'local') {
      this.local.reset();
      this.state = this.local.snapshot();
      this.render();
    } else if (this.mode === 'online') {
      // 联机：主机才能直接重开，其他人发起投票
      if (this.mySeat === 1) {
        this.socket.emit('game:restart', { roomCode: this.roomCode });
      } else {
        // 发起投票也用 rematch
        this.voteRematch(true);
      }
    }
  },

  exitToMenu() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.roomCode = null;
    history.replaceState(null, '', '/');
    this.showMenu();
  },

  voteRematch(vote) {
    if (this.mode !== 'online' || !this.socket) return;
    this.socket.emit('game:rematch', { roomCode: this.roomCode, vote });
    this.rematchVotes.mine = vote;
  },

  // ======== 渲染 ========
  render() {
    if (!this.state) return;
    // 棋盘
    document.querySelectorAll('.cell').forEach((el) => {
      const row = parseInt(el.dataset.row);
      const col = parseInt(el.dataset.col);
      const v = this.state.board[row][col];
      el.className = 'cell';
      el.innerHTML = '';

      if (v !== 0) {
        const piece = document.createElement('div');
        piece.className = 'piece p' + v;

        // 如果是下一个要消失的棋子（预告闪烁）
        const pr = this.state.pendingRemove;
        // 规则：当前轮次轮到谁，预告的是对方的棋子
        // 当前回合玩家是 current
        // pendingRemove 是 current 下一个回合之前要消失的（即 current 自己最老的）
        // 在本回合，pendingRemove.player 可能等于 current
        if (pr && pr.row === row && pr.col === col) {
          piece.classList.add('fading');
        }

        // 刚被放置的动效：给一个 key 触发
        // 简化：加 drop 类，由 JS 重新添加触发动画
        piece.classList.add('drop');
        requestAnimationFrame(() => piece.classList.remove('drop'));

        // 宝石 SVG
        piece.innerHTML = this._gemSVG(v);
        el.appendChild(piece);
      }
    });

    // 高亮赢线
    const winLine = this.state.winLine;
    document.querySelectorAll('.cell').forEach((el) => el.classList.remove('win'));
    if (winLine && this.state.status === 'ended') {
      for (const [r, c] of winLine) {
        const cell = document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
        if (cell) cell.classList.add('win');
      }
    }

    // 顶部信息：当前轮到谁
    this.renderTurnIndicator();

    // 结束对话框
    if (this.state.status === 'ended') {
      this.renderResult();
    } else {
      document.getElementById('result-overlay').classList.remove('show');
      document.getElementById('rematch-bar').classList.remove('show');
    }

    // 联机信息
    if (this.mode === 'online') {
      this.updateRoomUI({});
    }
  },

  renderTurnIndicator() {
    const el = document.getElementById('turn-indicator');
    if (!this.state) return;
    if (this.state.status === 'ended') {
      el.textContent = '对局结束';
      return;
    }
    let cur = this.state.current;
    let label;
    if (this.mode === 'local') {
      label = cur === P1 ? '你的回合' : 'AI 思考中…';
    } else if (this.mode === 'online') {
      label = cur === this.mySeat ? '你的回合' : '对方回合';
    } else {
      label = cur === P1 ? '玩家 1 回合' : '玩家 2 回合';
    }
    el.textContent = label;
    el.className = cur === P1 ? 'p1' : 'p2';
  },

  renderResult() {
    const overlay = document.getElementById('result-overlay');
    overlay.classList.add('show');
    let winner = this.state.winner;
    let title;
    if (this.mode === 'local') {
      if (winner === 0) title = '平局！';
      else if (winner === P1) title = '你赢了！ 🎉';
      else title = 'AI 获胜';
    } else if (this.mode === 'online') {
      if (winner === 0) title = '平局！';
      else if (winner === this.mySeat) title = '你赢了！ 🎉';
      else title = '对手获胜';
    } else {
      title = winner === 0 ? '平局' : `玩家 ${winner} 获胜`;
    }
    document.getElementById('result-title').textContent = title;

    // 联机时显示重开投票栏
    if (this.mode === 'online') {
      document.getElementById('rematch-bar').classList.add('show');
      document.getElementById('rematch-count').textContent =
        `${this.rematchVotes.count}/${this.rematchVotes.needed} 已同意`;
      document.getElementById('btn-rematch-yes').disabled = this.rematchVotes.mine;
    } else {
      document.getElementById('rematch-bar').classList.remove('show');
    }
  },

  _gemSVG(player) {
    // P1 粉紫渐变，P2 蓝紫渐变（参考原神月亮棋色调）
    if (player === 1) {
      return `<svg viewBox="0 0 100 100" class="gem"><defs>
        <radialGradient id="g1" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9"/>
          <stop offset="35%" stop-color="#ffd8f0" stop-opacity="0.95"/>
          <stop offset="70%" stop-color="#c77dff"/>
          <stop offset="100%" stop-color="#5a189a"/>
        </radialGradient>
        <filter id="glow1"><feGaussianBlur stdDeviation="2.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <polygon points="50,8 88,30 88,70 50,92 12,70 12,30" fill="url(#g1)" filter="url(#glow1)" stroke="#fff" stroke-opacity="0.3"/>
      <polygon points="50,8 70,30 50,50 30,30" fill="#ffffff" fill-opacity="0.25"/>
    </svg>`;
    } else {
      return `<svg viewBox="0 0 100 100" class="gem"><defs>
        <radialGradient id="g2" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.85"/>
          <stop offset="35%" stop-color="#c8b6ff" stop-opacity="0.95"/>
          <stop offset="70%" stop-color="#7b2cbf"/>
          <stop offset="100%" stop-color="#240046"/>
        </radialGradient>
        <filter id="glow2"><feGaussianBlur stdDeviation="2.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <polygon points="50,8 88,30 88,70 50,92 12,70 12,30" fill="url(#g2)" filter="url(#glow2)" stroke="#a0c4ff" stroke-opacity="0.4"/>
      <polygon points="50,8 70,30 50,50 30,30" fill="#e0fbff" fill-opacity="0.25"/>
    </svg>`;
    }
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
