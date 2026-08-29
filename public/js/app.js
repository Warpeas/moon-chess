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
  // rematch: { status: 'none'|'pending'|'accepted'|'rejected', byHost: bool, guestResponse: null|true|false }
  //  - pending: 房主已发起，等待客人同意/拒绝
  //  - accepted: 客人同意 / 房主直接一键重开
  //  - rejected: 客人拒绝 / 客人离开
  rematch: { status: 'none', byHost: false, guestResponse: null },

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

    // 重开按钮（联机：房主发起/撤回；客人看到同意/拒绝，在 btn-rematch-* 里）
    document.getElementById('btn-rematch-yes').addEventListener('click', () => this.rematchAction('accept'));
    document.getElementById('btn-rematch-no').addEventListener('click', () => this.rematchAction('cancel'));

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
    // 游戏结果对话框 再来一局按钮
    document.getElementById('btn-result-again').addEventListener('click', () => this.handleRestart());

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
    this.rematch = { status: 'none', byHost: false, guestResponse: null };
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
    this.rematch = { status: 'none', byHost: false, guestResponse: null };
    this.hideDialogs();
    this.updateRestartButton();
    this.render();
  },

  hideDialogs() {
    document.getElementById('difficulty-select').classList.remove('show');
    document.getElementById('join-dialog').classList.remove('show');
  },

  // ======== 联机 ========
  goOnline() {
    this.mode = 'online';
    this.rematch = { status: 'none', byHost: false, guestResponse: null };
    if (!this.socket) {
      this.socket = io();
      this.setupSocket();
    }
    document.getElementById('menu').classList.remove('show');
    document.getElementById('game').classList.add('show');
    document.getElementById('room-info').classList.add('show');
    this.updateRestartButton();

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
      this.rematch = { status: 'none', byHost: false, guestResponse: null };
      this.updateRestartButton();
      this.render();
    });

    s.on('room:joined', (data) => {
      this.roomCode = data.roomCode;
      this.mySeat = data.seat;
      this.roomPlayers = data.players;
      history.replaceState(null, '', `/r/${this.roomCode}`);
      this.updateRoomUI(data);
      this.state = data.game;
      this.rematch = { status: 'none', byHost: false, guestResponse: null };
      this.updateRestartButton();
      this.render();
    });

    s.on('room:update', (data) => {
      this.roomPlayers = data.players;
      if (data.game) this.state = data.game;
      this.updateRoomUI(data);
      this.updateRestartButton();
      this.render();
    });

    s.on('room:error', ({ message }) => {
      alert(message);
      this.exitToMenu();
    });

    s.on('room:playerLeft', () => {
      // 客人离开 → 按规则：客人离开/关页面 = 拒绝重开
      if (this.rematch.status === 'pending') {
        this.rematch.status = 'rejected';
        this.rematch.guestResponse = false;
      }
      this.updateRoomUI({});
      this.updateRestartButton();
      this.renderResult();
    });

    s.on('game:update', (data) => {
      this.state = { ...this.state, ...data };
      // 也更新 pieces 便于闪烁预告判断
      if (data.current !== undefined) this.state.current = data.current;
      if (data.pendingRemove !== undefined) this.state.pendingRemove = data.pendingRemove;
      if (data.status !== undefined) this.state.status = data.status;
      if (data.winner !== undefined) this.state.winner = data.winner;
      if (data.winLine !== undefined) this.state.winLine = data.winLine;
      // 一局状态变化，清空本地重开请求状态（服务端也会清空）
      if (data.status === 'playing') {
        this.rematch = { status: 'none', byHost: false, guestResponse: null };
      }
      // 更新 pieces 映射：前端重建
      this.rebuildPiecesFromBoard();
      this.updateRestartButton();
      this.render();
    });

    // 重开协议 V2：仅房主可发起/撤回；客人可同意/拒绝；客人离线=拒绝
    s.on('game:rematchUpdate', (data) => {
      // data: { status: 'none'|'pending'|'accepted'|'rejected', guestResponse: null|true|false }
      this.rematch.status = data.status || 'none';
      this.rematch.guestResponse = (data.guestResponse === undefined) ? null : data.guestResponse;
      this.rematch.byHost = (data.status === 'pending');
      this.updateRestartButton();
      this.renderResult();
    });

    s.on('game:restarted', ({ game }) => {
      this.state = game;
      this.rebuildPiecesFromBoard();
      this.rematch = { status: 'none', byHost: false, guestResponse: null };
      document.getElementById('result-overlay').classList.remove('show');
      this.updateRestartButton();
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

    // 复制链接
    const copyBtn = document.getElementById('btn-copy');
    copyBtn.onclick = () => {
      navigator.clipboard?.writeText(url).then(() => {
        copyBtn.textContent = '已复制 ✓';
        setTimeout(() => copyBtn.textContent = '复制', 1500);
      });
    };
  },

  // 根据模式 + 身份 + 阶段 更新顶栏「重开」按钮 文案/禁用/显示
  updateRestartButton() {
    const btn = document.getElementById('btn-restart');
    const bar = document.getElementById('rematch-bar');
    const again = document.getElementById('btn-result-again');

    if (this.mode === 'local') {
      // 单机：任何时候都可以直接重开，永远不显示投票条
      btn.textContent = '↻ 重开';
      btn.disabled = false;
      bar.classList.remove('show');
      bar.hidden = true;
      if (again) { again.style.display = ''; again.disabled = false; }
      return;
    }

    if (this.mode !== 'online') return;

    const isHost = (this.mySeat === 1);
    const ended = this.state && this.state.status === 'ended';
    const hasGuest = this.roomPlayers && this.roomPlayers.length >= 2 &&
                     this.roomPlayers.every((p) => p.seat !== 2 || p.online !== false);
    // 简单判断：第 2 位玩家存在就认为有客人
    const guestPresent = !!(this.roomPlayers && this.roomPlayers.length >= 2);

    // 顶部按钮
    bar.hidden = false;
    if (isHost) {
      // 房主：无论是否结束，都可随时发起「重开请求」；已发起时显示「撤回」
      if (this.rematch.status === 'pending') {
        btn.textContent = '↻ 撤回重开';
        btn.disabled = !ended; // 对局中途不允许撤回？按需求：房主可随时撤回
      } else {
        btn.textContent = '↻ 请求重开';
        btn.disabled = false;
      }
    } else {
      // 客人：不允许主动发起
      btn.textContent = '↻ 等待房主';
      btn.disabled = true;
    }

    // 结果弹窗中的「再来一局」按钮
    if (again) {
      if (!ended) { again.style.display = 'none'; }
      else if (isHost) {
        again.style.display = '';
        again.textContent = (this.rematch.status === 'pending') ? '撤回重开请求' : '请求再来一局';
        again.disabled = false;
      } else {
        // 客人：结果弹窗中不显示这个按钮（客人用底部投票条同意/拒绝）
        again.style.display = 'none';
      }
    }
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
      this.updateRestartButton();
      this.render();
      // AI 自动下
      if (this.state.status === 'playing' && this.state.current === P2) {
        setTimeout(() => {
          const move = AI.aiMove(this.local.board, this.local.pieces, P2, this.difficulty);
          if (move) {
            this.local.place(move.row, move.col, P2);
            this.state = this.local.snapshot();
            this.updateRestartButton();
            this.render();
          }
        }, 450);
      }
    } else if (this.mode === 'online') {
      if (this.state.current !== this.mySeat) return;
      // 本地预判一下（优化体验）
      this.socket.emit('game:place', { roomCode: this.roomCode, row, col, seat: this.mySeat });
    }
  },

  // 重开 / 再来一局（顶部按钮 和 结果弹窗「再来一局」共用）
  handleRestart() {
    if (this.mode === 'local') {
      // 单机：立即重开，无投票，结束遮罩跟着关闭
      this.local.reset();
      this.state = this.local.snapshot();
      document.getElementById('result-overlay').classList.remove('show');
      this.updateRestartButton();
      this.render();
      return;
    }
    if (this.mode !== 'online' || !this.socket) return;
    if (this.mySeat !== 1) return; // 客人无权主动发起
    const ended = this.state && this.state.status === 'ended';
    if (!ended) {
      // 进行中：房主也可以请求重开（征求客人同意）；但这里给用户友好提示：直接重开需对方同意
    }
    // 服务端按当前状态自动判定：未发起→发起，已发起→撤回
    this.socket.emit('game:rematch', { roomCode: this.roomCode });
  },

  // 重开投票条里的客人端操作（accept/reject） 以及 房主端的撤回
  rematchAction(action /* 'accept' | 'cancel' */) {
    if (this.mode !== 'online' || !this.socket) return;
    const isHost = (this.mySeat === 1);
    if (isHost) {
      // 房主在投票条里「取消」= 撤回请求
      if (action === 'cancel') this.socket.emit('game:rematch', { roomCode: this.roomCode, cancel: true });
    } else {
      // 客人：同意/拒绝
      const accept = (action === 'accept');
      this.socket.emit('game:rematchResponse', { roomCode: this.roomCode, accept });
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
    // 兼容旧版调用（V1 协议已废弃）
    this.rematchAction(vote ? 'accept' : 'cancel');
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
        if (pr && pr.row === row && pr.col === col) {
          piece.classList.add('fading');
        }

        piece.classList.add('drop');
        requestAnimationFrame(() => piece.classList.remove('drop'));

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

    // 单机：playing 时隐藏结果遮罩；ended 时显示结果 + 「再来一局」
    // 联机：playing 时隐藏结果遮罩和投票条；ended 时显示结果 + （有请求时显示投票条）
    if (this.state.status === 'ended') {
      this.renderResult();
    } else {
      document.getElementById('result-overlay').classList.remove('show');
      if (this.mode !== 'online' || this.rematch.status === 'none') {
        document.getElementById('rematch-bar').classList.remove('show');
      }
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
    const bar = document.getElementById('rematch-bar');
    const info = document.getElementById('rematch-info');
    const yesBtn = document.getElementById('btn-rematch-yes');
    const noBtn = document.getElementById('btn-rematch-no');

    overlay.classList.add('show');
    let winner = this.state ? this.state.winner : 0;
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
    const titleEl = document.getElementById('result-title');
    if (titleEl) titleEl.textContent = title;

    // 单机：永远不显示投票条（已在 updateRestartButton 设置 hidden，但兜底）
    if (this.mode !== 'online') {
      bar.classList.remove('show');
      return;
    }

    // 联机：更新投票条 UI
    const isHost = (this.mySeat === 1);
    const status = this.rematch.status; // none | pending | accepted | rejected

    if (status === 'none') {
      // 未发起：仅房主可发起，客人等待。把投票条显示出来但内容区分。
      bar.classList.add('show');
      if (isHost) {
        info.textContent = '你可以发起“再来一局”请求（对方同意后立即重开）';
        yesBtn.style.display = 'none';
        noBtn.style.display = 'none';
      } else {
        info.textContent = '等待房主发起“再来一局”请求…';
        yesBtn.style.display = 'none';
        noBtn.style.display = 'none';
      }
      return;
    }

    bar.classList.add('show');
    if (status === 'pending') {
      // 已发起 pending
      if (isHost) {
        // 房主端：等待客人回应，提供「撤回」
        info.textContent = '已请求“再来一局”，等待对方同意…';
        yesBtn.style.display = 'none';
        noBtn.style.display = '';
        noBtn.textContent = '撤回';
        noBtn.disabled = false;
      } else {
        // 客人端：同意 / 拒绝
        info.textContent = '房主请求“再来一局”，请选择：';
        yesBtn.style.display = '';
        noBtn.style.display = '';
        yesBtn.textContent = '同意';
        noBtn.textContent = '拒绝';
        const responded = (this.rematch.guestResponse === true || this.rematch.guestResponse === false);
        yesBtn.disabled = responded;
        noBtn.disabled = responded;
      }
    } else if (status === 'accepted') {
      info.textContent = '双方已同意，正在重开…';
      yesBtn.style.display = 'none';
      noBtn.style.display = 'none';
    } else if (status === 'rejected') {
      const reason = (this.rematch.guestResponse === false) ? '对方已拒绝重开请求' : '重开请求已取消';
      info.textContent = reason;
      yesBtn.style.display = 'none';
      if (isHost) {
        noBtn.style.display = '';
        noBtn.textContent = '重新发起';
        noBtn.disabled = false;
        // 房主点重新发起 = 调 handleRestart()
        noBtn.onclick = () => this.handleRestart();
      } else {
        noBtn.style.display = 'none';
      }
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
