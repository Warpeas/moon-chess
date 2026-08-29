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
    if (this.pieces[player].length >= 3) {
      const old = this.pieces[player].shift();
      this.board[old.row][old.col] = 0;
      removed = old;
    }
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
  // rematch: { status: 'none'|'pending'|'accepted'|'rejected', guestResponse: null|true|false }
  rematch: { status: 'none', byHost: false, guestResponse: null },

  // AI 调度：延迟时间 & 预选落子（预览）
  aiTimer: null,
  aiPreview: null, // {row, col, player}

  // 上一手落子（渲染成高亮光圈）
  lastMove: null,

  // 渲染所需快照
  state: null,

  // ==================== 初始化 ====================
  init() {
    const path = location.pathname;
    const m = path.match(/^\/r\/([A-Z0-9]{6})$/i);
    if (m) {
      this.roomCode = m[1].toUpperCase();
      this.goOnline();
    } else {
      this.showMenu();
    }

    // 菜单按钮
    safeGet('btn-local')?.addEventListener('click', () => this.showDifficultySelect());
    safeGet('btn-online-create')?.addEventListener('click', () => this.createRoom());
    safeGet('btn-online-join')?.addEventListener('click', () => this.showJoinDialog());

    safeGet('diff-easy')?.addEventListener('click', () => this.startLocal('easy'));
    safeGet('diff-normal')?.addEventListener('click', () => this.startLocal('normal'));
    safeGet('diff-hard')?.addEventListener('click', () => this.startLocal('hard'));

    // 对局界面按钮
    safeGet('btn-restart')?.addEventListener('click', () => this.handleRestart());
    safeGet('btn-exit')?.addEventListener('click', () => this.exitToMenu());

    // 重开投票条（联机）
    safeGet('btn-rematch-yes')?.addEventListener('click', () => this.rematchAction('accept'));
    safeGet('btn-rematch-no')?.addEventListener('click', () => this.rematchAction('cancel'));

    // 棋盘点击
    document.querySelectorAll('.cell').forEach((el) => {
      el.addEventListener('click', () => {
        const row = parseInt(el.dataset.row, 10);
        const col = parseInt(el.dataset.col, 10);
        this.handleCellClick(row, col);
      });
    });

    // 加入房间对话框
    safeGet('btn-join-cancel')?.addEventListener('click', () => this.hideJoinDialog());
    safeGet('btn-join-confirm')?.addEventListener('click', () => {
      const val = safeGet('join-input').value;
      if (!val.trim()) return;
      if (this.socket) {
        this.socket.emit('room:join', { roomCode: val });
        this.hideJoinDialog();
      }
    });

    // 结束横幅按钮（替代全屏结果弹窗）
    safeGet('btn-end-again')?.addEventListener('click', () => this.handleRestart());
    safeGet('btn-end-menu')?.addEventListener('click', () => this.exitToMenu());

    // 通用确认对话框（单机重开确认等）
    safeGet('btn-confirm-no')?.addEventListener('click', () => this.hideConfirm());
    safeGet('btn-confirm-yes')?.addEventListener('click', () => this.onConfirmYes());

    window.addEventListener('resize', () => this.render());
  },

  // ==================== 通用工具 ====================
  showConfirm({ title, desc, onYes }) {
    const dlg = safeGet('confirm-dialog');
    safeGet('confirm-title').textContent = title || '确认操作';
    safeGet('confirm-desc').textContent  = desc  || '';
    this._confirmCallback = onYes || null;
    dlg.hidden = false;
    dlg.classList.add('show');
  },
  hideConfirm() {
    const dlg = safeGet('confirm-dialog');
    dlg.classList.remove('show');
    setTimeout(() => { dlg.hidden = true; }, 260);
    this._confirmCallback = null;
  },
  onConfirmYes() {
    const cb = this._confirmCallback;
    this.hideConfirm();
    if (typeof cb === 'function') cb();
  },

  hideRematchBar() {
    const bar = safeGet('rematch-bar');
    if (!bar) return;
    bar.classList.remove('show');
    bar.hidden = true;
  },
  showRematchBar() {
    const bar = safeGet('rematch-bar');
    if (!bar) return;
    bar.hidden = false;
    bar.classList.add('show');
  },

  // ==================== 菜单切换 ====================
  showMenu() {
    this.mode = 'menu';
    this.clearAiTimer(true);
    this.aiPreview = null;
    this.lastMove = null;
    safeGet('menu')?.classList.add('show');
    safeGet('game')?.classList.remove('show');
    safeGet('room-info')?.classList.remove('show');
    safeGet('difficulty-select')?.classList.remove('show');
    const dlg = safeGet('result-overlay'); if (dlg) dlg.classList.remove('show');
    this.hideRematchBar();
    this.hideEndBanner();
    this.rematch = { status: 'none', byHost: false, guestResponse: null };
    this.setBoardDisabled(false);
  },

  showDifficultySelect() {
    safeGet('difficulty-select')?.classList.add('show');
  },
  hideJoinDialog() {
    safeGet('join-dialog')?.classList.remove('show');
  },
  showJoinDialog() {
    // 静态分享版本：提示用户需要部署联机服务端
    if (window.MOON_CHESS_STANDALONE && typeof window.__moon_chess_showOnlineTip === 'function') {
      window.__moon_chess_showOnlineTip();
      return;
    }
    safeGet('join-dialog')?.classList.add('show');
    const inp = safeGet('join-input');
    inp.value = '';
    setTimeout(() => inp.focus(), 50);
  },

  startLocal(difficulty) {
    this.difficulty = difficulty;
    this.mode = 'local';
    this.local = new LocalGame();
    this.state = this.local.snapshot();
    this.clearAiTimer(true);
    this.aiPreview = null;
    this.lastMove = null;
    this.rematch = { status: 'none', byHost: false, guestResponse: null };
    safeGet('menu')?.classList.remove('show');
    safeGet('difficulty-select')?.classList.remove('show');
    safeGet('game')?.classList.add('show');
    safeGet('room-info')?.classList.remove('show');
    this.hideDialogs();
    this.hideRematchBar();
    this.hideEndBanner();
    this.setBoardDisabled(false);
    this.updateRestartButton();
    this.render();
  },

  hideDialogs() {
    safeGet('difficulty-select')?.classList.remove('show');
    safeGet('join-dialog')?.classList.remove('show');
  },

  hideEndBanner() {
    const banner = safeGet('end-banner'); if (!banner) return;
    banner.classList.remove('show');
    banner.hidden = true;
  },
  showEndBanner(title, cls) {
    const banner = safeGet('end-banner'); if (!banner) return;
    const t = safeGet('end-title');
    t.textContent = title || '';
    t.classList.remove('win','lose','draw');
    if (cls) t.classList.add(cls);
    banner.hidden = false;
    banner.classList.add('show');
  },

  setBoardDisabled(disabled) {
    const board = safeGet('board'); if (!board) return;
    board.classList.toggle('disabled', !!disabled);
  },

  clearAiTimer(alsoCancelPreview) {
    if (this.aiTimer) { clearTimeout(this.aiTimer); this.aiTimer = null; }
    if (alsoCancelPreview) this.aiPreview = null;
  },

  // ==================== 联机 ====================
  goOnline() {
    // 单机静态分享版本（moon-chess-standalone.html）：没有真实 WebSocket 服务
    if (window.MOON_CHESS_STANDALONE && typeof window.__moon_chess_showOnlineTip === 'function') {
      window.__moon_chess_showOnlineTip();
      return;
    }
    this.mode = 'online';
    this.clearAiTimer(true);
    this.lastMove = null;
    this.rematch = { status: 'none', byHost: false, guestResponse: null };
    this.hideEndBanner();
    if (!this.socket) {
      this.socket = io();
      this.setupSocket();
    }
    safeGet('menu')?.classList.remove('show');
    safeGet('game')?.classList.add('show');
    safeGet('room-info')?.classList.add('show');
    // 联机重开栏默认隐藏，仅当房主发起请求（status= pending/rejected）才显示
    this.hideRematchBar();
    this.updateRestartButton();

    if (this.roomCode) {
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
      this.hideRematchBar();
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
      this.hideRematchBar();
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
      if (this.rematch.status === 'pending') {
        this.rematch.status = 'rejected';
        this.rematch.guestResponse = false;
      }
      this.updateRoomUI({});
      this.updateRestartButton();
      this.renderRematchBar();
    });

    s.on('game:update', (data) => {
      this.state = { ...this.state, ...data };
      if (data.current !== undefined) this.state.current = data.current;
      if (data.pendingRemove !== undefined) this.state.pendingRemove = data.pendingRemove;
      if (data.status !== undefined) this.state.status = data.status;
      if (data.winner !== undefined) this.state.winner = data.winner;
      if (data.winLine !== undefined) this.state.winLine = data.winLine;
      // 记录 lastMove（落子者通过 seat + data.row/col 推不出 seat，这里仅服务端可提供；保守起见在联机模式下我们拿 data.row/col 当作上一手）
      if (typeof data.row === 'number' && typeof data.col === 'number') {
        this.lastMove = { row: data.row, col: data.col };
      }
      if (data.status === 'playing') {
        this.rematch = { status: 'none', byHost: false, guestResponse: null };
        this.hideRematchBar();
      }
      this.rebuildPiecesFromBoard();
      this.updateRestartButton();
      this.render();
    });

    s.on('game:rematchUpdate', (data) => {
      this.rematch.status = data.status || 'none';
      this.rematch.guestResponse = (data.guestResponse === undefined) ? null : data.guestResponse;
      this.rematch.byHost = (data.status === 'pending');
      this.updateRestartButton();
      this.renderRematchBar();
    });

    s.on('game:restarted', ({ game }) => {
      this.state = game;
      this.rebuildPiecesFromBoard();
      this.rematch = { status: 'none', byHost: false, guestResponse: null };
      this.hideEndBanner();
      this.hideRematchBar();
      this.setBoardDisabled(false);
      this.lastMove = null;
      this.updateRestartButton();
      this.render();
    });

    s.on('game:error', ({ reason }) => {
      console.warn('game error:', reason);
    });
  },

  rebuildPiecesFromBoard() {
    if (!this.state) return;
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
    const info = safeGet('room-info');
    if (!info) return;
    if (this.mode !== 'online') { info.classList.remove('show'); return; }
    info.classList.add('show');
    safeGet('room-code').textContent = this.roomCode || '--';
    const url = location.origin + '/r/' + (this.roomCode || '');
    const link = safeGet('room-link');
    link.textContent = url;
    link.href = url;

    const copyBtn = safeGet('btn-copy');
    copyBtn.onclick = () => {
      navigator.clipboard?.writeText(url).then(() => {
        copyBtn.textContent = '已复制 ✓';
        setTimeout(() => copyBtn.textContent = '复制', 1500);
      });
    };
  },

  // ==================== UI 状态：重开按钮/横幅 ====================
  updateRestartButton() {
    const btn = safeGet('btn-restart');
    const again = safeGet('btn-end-again');
    if (!btn) return;

    if (this.mode === 'local') {
      btn.textContent = '↻ 重开';
      btn.disabled = false;
      // 单机永远隐藏重开投票条
      this.hideRematchBar();
      // end-banner 的「再来一局」在单机始终是"再来一局"，不区分 pending 与否
      if (again) {
        again.textContent = '再来一局';
        again.disabled = false;
      }
      return;
    }

    if (this.mode !== 'online') return;

    const isHost = (this.mySeat === 1);
    if (isHost) {
      if (this.rematch.status === 'pending') {
        btn.textContent = '↻ 撤回重开';
        if (again) again.textContent = '撤回重开请求';
      } else {
        btn.textContent = '↻ 请求重开';
        if (again) again.textContent = '请求再来一局';
      }
      btn.disabled = false;
      if (again) again.disabled = false;
    } else {
      // 客人：不能主动发起
      btn.textContent = '↻ 等待房主';
      btn.disabled = true;
      // 客人的 end-banner 提供「再来一局」按钮没有意义，隐藏掉（客人用投票条同意/拒绝）
      if (again) again.style.display = 'none';
    }
  },

  // 联机重开栏渲染：仅 status !== none 才显示（none 时什么都不展示）
  renderRematchBar() {
    const bar  = safeGet('rematch-bar');
    const info = safeGet('rematch-info');
    const yes  = safeGet('btn-rematch-yes');
    const no   = safeGet('btn-rematch-no');
    if (!bar || !info || !yes || !no) return;

    if (this.mode !== 'online') {
      this.hideRematchBar();
      return;
    }

    const status = this.rematch.status;
    const isHost = (this.mySeat === 1);

    // 规则：联机也默认不显示，只在房主发起或有结果反馈时显示
    if (status === 'none') {
      this.hideRematchBar();
      return;
    }

    this.showRematchBar();

    if (status === 'pending') {
      if (isHost) {
        info.textContent = '已请求“再来一局”，等待对方同意…';
        yes.style.display = 'none';
        no.style.display  = '';
        no.textContent = '撤回';
        no.disabled = false;
        // 恢复默认 click（之前可能被重新发起覆盖）
        no.onclick = null;
        no.addEventListenerOnce ? null : null;
        // 重绑到默认（事件绑定在 init 中是全局的，这里不需要再重复）
      } else {
        info.textContent = '房主请求“再来一局”，请选择：';
        yes.style.display = '';
        no.style.display  = '';
        yes.textContent = '同意';
        no.textContent  = '拒绝';
        const responded = (this.rematch.guestResponse === true || this.rematch.guestResponse === false);
        yes.disabled = responded;
        no.disabled  = responded;
      }
    } else if (status === 'accepted') {
      info.textContent = '双方已同意，正在重开…';
      yes.style.display = 'none';
      no.style.display  = 'none';
    } else if (status === 'rejected') {
      const reason = (this.rematch.guestResponse === false) ? '对方已拒绝重开请求' : '重开请求已取消';
      info.textContent = reason;
      yes.style.display = 'none';
      if (isHost) {
        no.style.display = '';
        no.textContent = '重新发起';
        no.disabled = false;
        // 点"重新发起"等价于顶栏点"请求重开"
        no.onclick = (e) => { e.stopPropagation(); this.handleRestart(); };
      } else {
        no.style.display = 'none';
      }
    }
  },

  // ==================== 点击处理 ====================
  handleCellClick(row, col) {
    if (!this.state || this.state.status !== 'playing') return;

    if (this.mode === 'local') {
      if (this.state.current !== P1) return;     // 不是玩家回合
      if (this.aiTimer) return;                    // AI 思考中，点不了
      if (this.local.board[row][col] !== 0) return;
      // 落子前记下玩家将导致哪颗棋子消失，用于渲染更显眼的 pendingRemove
      const res = this.local.place(row, col, P1);
      if (!res.ok) return;
      this.lastMove = { row, col, player: P1 };
      this.state = this.local.snapshot();
      this.updateRestartButton();
      this.render();

      // AI 自动下（分阶段：思考延迟 + 预览 + 再落子）
      if (this.state.status === 'playing' && this.state.current === P2) {
        this.scheduleAiMove();
      }
      return;
    }

    if (this.mode === 'online') {
      if (this.state.current !== this.mySeat) return;
      if (this.state.board[row][col] !== 0) return;
      this.lastMove = { row, col, player: this.mySeat };
      this.socket.emit('game:place', { roomCode: this.roomCode, row, col, seat: this.mySeat });
    }
  },

  scheduleAiMove() {
    this.clearAiTimer(false);
    this.aiPreview = null;
    this.setBoardDisabled(true);
    this.render();

    // 难度基础延迟 + 随机，让玩家看清"AI 预选"
    // easy  慢  1200 ~ 2100ms
    // normal     900 ~ 1700ms
    // hard       700 ~ 1300ms（但仍然能看清）
    const base = { easy: 1600, normal: 1250, hard: 950 }[this.difficulty] || 1200;
    const jitter = Math.floor(Math.random() * 700);
    const totalDelay = base + jitter;

    // 先在约 35%~55% 时间点计算预选位置并展示 preview（让用户看到"AI 已经想好"）
    const previewDelay = Math.floor(totalDelay * (0.35 + Math.random() * 0.2));
    const placeDelay = totalDelay - previewDelay;

    this.aiTimer = setTimeout(() => {
      const move = AI.aiMove(this.local.board, this.local.pieces, P2, this.difficulty);
      if (!move) {
        this.clearAiTimer(true);
        this.setBoardDisabled(false);
        this.render();
        return;
      }
      this.aiPreview = { row: move.row, col: move.col, player: P2 };
      this.render();
      this.aiTimer = setTimeout(() => {
        this.local.place(move.row, move.col, P2);
        this.lastMove = { row: move.row, col: move.col, player: P2 };
        this.aiPreview = null;
        this.aiTimer = null;
        this.state = this.local.snapshot();
        this.setBoardDisabled(false);
        this.updateRestartButton();
        this.render();
      }, placeDelay);
    }, previewDelay);
  },

  // 顶部重开 / 结束横幅「再来一局」共用
  handleRestart() {
    if (this.mode === 'local') {
      // 单机：先确认
      const isEnded = this.state && this.state.status === 'ended';
      const title = isEnded ? '再来一局？' : '确认重新开始？';
      const desc  = isEnded ? '当前对局的胜败结果会被清空，开始新的一局吗？' : '当前局的进度会被清空，确定要开始新的一局吗？';
      this.showConfirm({
        title, desc,
        onYes: () => {
          this.clearAiTimer(true);
          this.lastMove = null;
          this.local.reset();
          this.state = this.local.snapshot();
          this.hideEndBanner();
          this.setBoardDisabled(false);
          this.updateRestartButton();
          this.render();
        }
      });
      return;
    }

    if (this.mode !== 'online' || !this.socket) return;
    if (this.mySeat !== 1) return; // 客人无权主动发起
    // 发起或撤回（当前 pending 时点击等价于取消）
    const shouldCancel = (this.rematch.status === 'pending');
    this.socket.emit('game:rematch', { roomCode: this.roomCode, cancel: shouldCancel || undefined });
  },

  // 重开投票条按钮
  rematchAction(action) {
    if (this.mode !== 'online' || !this.socket) return;
    const isHost = (this.mySeat === 1);
    if (isHost) {
      if (action === 'cancel') {
        // 如果目前是 rejected 状态，no 按钮绑定已经改成"重新发起"→ 不经过这里，直接 handleRestart。
        // 正常 pending 时：撤回
        this.socket.emit('game:rematch', { roomCode: this.roomCode, cancel: true });
      }
    } else {
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
    this.clearAiTimer(true);
    history.replaceState(null, '', '/');
    this.showMenu();
  },

  voteRematch(vote) {
    // 兼容调用（废弃）
    this.rematchAction(vote ? 'accept' : 'cancel');
  },

  // ==================== 渲染 ====================
  render() {
    if (!this.state) return;

    const cells = document.querySelectorAll('.cell');
    cells.forEach((el) => {
      const row = parseInt(el.dataset.row, 10);
      const col = parseInt(el.dataset.col, 10);
      const v = this.state.board[row][col];
      el.className = 'cell';
      el.innerHTML = '';

      if (v !== 0) {
        const piece = document.createElement('div');
        piece.className = 'piece p' + v;
        const pr = this.state.pendingRemove;
        if (pr && pr.row === row && pr.col === col) {
          piece.classList.add('fading');
          el.classList.add('marked-to-remove');
        }
        piece.classList.add('drop');
        requestAnimationFrame(() => piece.classList.remove('drop'));
        piece.innerHTML = this._gemSVG(v);
        el.appendChild(piece);
      } else {
        // 空格：AI 思考时显示预选位置
        if (this.mode === 'local' && this.aiPreview && this.aiPreview.row === row && this.aiPreview.col === col) {
          const pv = document.createElement('div');
          pv.className = 'preview-move ' + (this.aiPreview.player === P1 ? 'p1' : 'p2');
          el.appendChild(pv);
        }
      }

      // last-move 光圈
      if (this.lastMove && this.lastMove.row === row && this.lastMove.col === col) {
        el.classList.add('last-move');
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

    // 棋盘禁用态（AI 思考 / 对局结束）
    if (this.state.status === 'ended') {
      this.setBoardDisabled(true);
    } else if (this.mode === 'local') {
      this.setBoardDisabled(!!this.aiTimer || this.state.current !== P1);
    }

    this.renderTurnIndicator();

    // 结束显示：横幅 + 联机时若有投票请求，显示投票条
    if (this.state.status === 'ended') {
      this.renderEndBanner();
      if (this.mode === 'online') this.renderRematchBar();
      else this.hideRematchBar();     // 单机：无论如何不显示投票条
    } else {
      this.hideEndBanner();
      if (this.mode === 'local') {
        this.hideRematchBar();         // 单机 playing 时强制隐藏投票条
      } else if (this.rematch.status === 'none') {
        this.hideRematchBar();         // 联机 无重开请求时隐藏投票条
      }
    }

    if (this.mode === 'online') this.updateRoomUI({});
  },

  renderTurnIndicator() {
    const el = safeGet('turn-indicator');
    if (!el || !this.state) return;
    let cur = this.state.current;
    let label;
    let dotHtml = '';
    if (this.state.status === 'ended') {
      label = '对局结束';
    } else if (this.mode === 'local') {
      if (cur === P1) {
        label = '你的回合';
      } else {
        label = this.aiPreview ? 'AI 预选了落子…' : 'AI 思考中';
        dotHtml = '<span class="thinking-dot" aria-hidden="true"></span>';
      }
    } else if (this.mode === 'online') {
      label = cur === this.mySeat ? '你的回合' : '对方回合';
      if (cur !== this.mySeat) dotHtml = '<span class="thinking-dot" aria-hidden="true"></span>';
    } else {
      label = cur === P1 ? '玩家 1 回合' : '玩家 2 回合';
    }
    el.innerHTML = label + dotHtml;
    // className: 谁的回合就用谁的色；如果显示 AI 思考但其实是 P2 就用 P2 色
    if (this.state.status === 'ended') el.className = 'p1';
    else if (this.mode === 'local') el.className = (cur === P1) ? 'p1' : 'p2';
    else el.className = (cur === this.mySeat) ? 'p1' : 'p2';
  },

  renderEndBanner() {
    if (!this.state) return;
    const winner = this.state.winner;
    let title = '', cls = '';
    if (this.mode === 'local') {
      if (winner === 0)      { title = '平局'; cls = 'draw'; }
      else if (winner === P1){ title = '你赢了！ 🎉'; cls = 'win'; }
      else                  { title = 'AI 获胜';   cls = 'lose'; }
      // 单机 banner 显示 再来一局/返回菜单
      const again = safeGet('btn-end-again');
      if (again) { again.style.display = ''; again.textContent = '再来一局'; again.disabled = false; }
      this.showEndBanner(title, cls);
      return;
    }
    // online
    if (winner === 0)                  { title = '平局'; cls = 'draw'; }
    else if (winner === this.mySeat)   { title = '你赢了！ 🎉'; cls = 'win'; }
    else                               { title = '对手获胜'; cls = 'lose'; }
    const again = safeGet('btn-end-again');
    if (again) {
      if (this.mySeat === 1) {
        again.style.display = '';
        again.textContent = (this.rematch.status === 'pending') ? '撤回重开请求' : '请求再来一局';
        again.disabled = false;
      } else {
        // 客人不显示"再来一局"按钮（客人用投票条）
        again.style.display = 'none';
      }
    }
    this.showEndBanner(title, cls);
  },

  _gemSVG(player) {
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
      <polygon points="50,8 88,30 88,70 50,92 12,70 12,30" fill="url(#g2)" filter="url(#g2)" stroke="#a0c4ff" stroke-opacity="0.4"/>
      <polygon points="50,8 70,30 50,50 30,30" fill="#e0fbff" fill-opacity="0.25"/>
    </svg>`;
    }
  },
};

function safeGet(id) {
  const el = document.getElementById(id);
  return el || null;
}

document.addEventListener('DOMContentLoaded', () => App.init());
