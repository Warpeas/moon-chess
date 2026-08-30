// ======== 客户端游戏核心 ========
// P1 = WHITE 先手（白方），P2 = BLACK 后手（黑方）
const WHITE = 1;
const BLACK = 2;
const P1 = WHITE;
const P2 = BLACK;

function sideOf(player) { return player === WHITE ? 'white' : 'black'; }
function sideLabel(side) { return side === 'white' ? '白方' : '黑方'; }
function mySideLabel(playerSide) {
  return playerSide === 'white' ? '你执白（先手）' : '你执黑（后手）';
}

class LocalGame {
  constructor() {
    this.reset();
  }
  reset() {
    this.board = Array.from({ length: 3 }, () => Array(3).fill(0));
    this.current = P1;
    this.pieces = { 1: [], 2: [] };       // 每方棋子队列（按本方落子先后 FIFO）
    this.order  = [];                     // 全局落子顺序（所有棋子共享 FIFO，上限 5 颗，超出则移除全局最旧）
    this.status = 'playing';
    this.winner = 0;
    this.winLine = null;
    this.pendingRemove = null;            // 下一手放置将会消失的棋子（全局 order[0]）= 对方执棋时本方闪烁
  }
  place(row, col, player) {
    if (this.status !== 'playing') return { ok: false };
    if (player !== this.current) return { ok: false };
    if (this.board[row][col] !== 0) return { ok: false };

    // 先落下新棋，然后判断是否超过全局 5 颗上限（超过则移除全局最旧那颗）
    this.board[row][col] = player;
    this.pieces[player].push({ row, col });
    this.order.push({ player, row, col });

    let removed = null;
    if (this.order.length > 5) {
      const old = this.order.shift();
      this.board[old.row][old.col] = 0;
      this.pieces[old.player].shift();   // 同步清理该方本方队列最旧项
      removed = old;
    }

    const win = this._checkWin(this.board);
    if (win.winner !== 0) {
      this.status = 'ended';
      this.winner = win.winner;
      this.winLine = win.line;
      this.pendingRemove = null;
      return { ok: true, removed, winner: win.winner, winLine: win.line, pendingRemove: null, current: 0 };
    }

    const next = this.current === P1 ? P2 : P1;
    this.current = next;
    // 若当前满 5 颗，下一手放置会触发“全局最旧一颗消失”预警闪烁
    // 用户规则：对方执棋时本方闪烁，对方下子时本方消失；反之亦然（本方执棋时对方闪烁）
    // → 只在待消失棋子（order[0]）不属于当前执棋方时，才标记为 pendingRemove 闪烁
    if (this.order.length === 5) {
      const oldest = this.order[0];
      if (oldest.player !== this.current) {
        this.pendingRemove = { player: oldest.player, row: oldest.row, col: oldest.col };
      } else {
        this.pendingRemove = null;
      }
    } else {
      this.pendingRemove = null;
    }
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
      pieces: { 1: this.pieces[1].map(p => ({...p})), 2: this.pieces[2].map(p => ({...p})) },
      order:  this.order.map(o => ({...o})),
    };
  }
}

// ======== 应用控制器 ========

const App = {
  // 模式: menu | local | online
  mode: 'menu',
  local: null,
  playerSide: 'white',          // 'white' | 'black' — 玩家选哪一方
  difficulty: 'normal',

  // 联机
  socket: null,
  roomCode: null,
  mySeat: 1,
  roomPlayers: [],
  // rematch: { status: 'none'|'pending'|'accepted'|'rejected', guestResponse: null|true|false }
  rematch: { status: 'none', byHost: false, guestResponse: null },

  // AI 调度：延迟时间 & 思考候选红圈（2-3 个位置循环切换）
  aiTimer: null,
  aiCandidatesTimer: null,
  aiCandidates: [],          // [{row,col}, ...]
  aiCandidatesActiveIdx: 0,

  // 渲染所需快照
  state: null,

  // 棋子即将被移除时的"视觉幽灵"（逻辑已移除，但画面再做 600ms 淡出动画）
  // 格式: { player, row, col, timerId }
  visualRemoving: null,

  // 管理移除动画：在逻辑已经移除棋子后，再挂一个视觉幽灵，等动画结束再消失
  stageRemovingVisual(removed) {
    if (!removed) return;
    // 如果已有一个正在移除的（极端情况），直接清掉
    this.clearRemovingVisual(false);
    const info = { ...removed };
    const that = this;
    info.timerId = setTimeout(() => {
      that.clearRemovingVisual(true);
    }, 620);
    this.visualRemoving = info;
  },
  clearRemovingVisual(needRender) {
    if (this.visualRemoving && this.visualRemoving.timerId) {
      clearTimeout(this.visualRemoving.timerId);
    }
    this.visualRemoving = null;
    if (needRender) this.render();
  },
  // 清空所有单元格的渲染签名缓存（开局/重开/切模式时调用，强制整盘重绘）
  _resetCellRenderKeys() {
    const all = document.querySelectorAll('.cell');
    all.forEach((el) => { delete el.dataset._k; });
  },

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

    safeGet('diff-easy')?.addEventListener('click', () => this._onDiffPicked('easy'));
    safeGet('diff-normal')?.addEventListener('click', () => this._onDiffPicked('normal'));
    safeGet('diff-hard')?.addEventListener('click', () => this._onDiffPicked('hard'));

    // 执白/执黑选择
    safeGet('side-white')?.addEventListener('click', () => this._onSidePicked('white'));
    safeGet('side-black')?.addEventListener('click', () => this._onSidePicked('black'));
    safeGet('side-back')?.addEventListener('click', () => this.backToDifficultyFromSide());

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

  _onDiffPicked(difficulty) {
    this.difficulty = difficulty;
    safeGet('difficulty-select')?.classList.remove('show');
    this.showSideSelect();
  },
  backToDifficultyFromSide() {
    safeGet('side-select')?.classList.remove('show');
    safeGet('difficulty-select')?.classList.add('show');
  },
  _onSidePicked(side) {
    safeGet('side-select')?.classList.remove('show');
    this.startLocal(this.difficulty, side);
  },

  // ==================== 通用工具 ====================
  showConfirm({ title, desc, onYes }) {
    const dlg = safeGet('confirm-dialog');
    safeGet('confirm-title').textContent = title || '确认操作';
    const descEl = safeGet('confirm-desc');
    const descText = desc  || '';
    descEl.textContent = descText;
    descEl.style.display = descText === '' ? 'none' : '';
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
    this.aiCandidates = [];
    this.stopAiCandidateCycle();
    safeGet('menu')?.classList.add('show');
    safeGet('game')?.classList.remove('show');
    safeGet('room-info')?.classList.remove('show');
    safeGet('difficulty-select')?.classList.remove('show');
    safeGet('side-select')?.classList.remove('show');
    const dlg = safeGet('result-overlay'); if (dlg) dlg.classList.remove('show');
    this.hideRematchBar();
    this.hideEndBanner();
    this.rematch = { status: 'none', byHost: false, guestResponse: null };
    this.setBoardDisabled(false);
  },

  showDifficultySelect() {
    safeGet('difficulty-select')?.classList.add('show');
  },
  showSideSelect() {
    safeGet('side-select')?.classList.add('show');
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

  startLocal(difficulty, side) {
    this.difficulty = difficulty;
    this.playerSide = side || 'white';
    const humanPlayer = (this.playerSide === 'white') ? WHITE : BLACK;
    const aiPlayer    = (this.playerSide === 'white') ? BLACK : WHITE;
    this.mode = 'local';
    this.local = new LocalGame();
    this.state = this.local.snapshot();
    this.clearAiTimer(true);
    this.aiCandidates = [];
    this.stopAiCandidateCycle();
    this.clearRemovingVisual(false);          // 清理上局残留的消失动画
    this._resetCellRenderKeys();              // 清除单元格渲染缓存，保证开局重绘
    this.rematch = { status: 'none', byHost: false, guestResponse: null };
    safeGet('menu')?.classList.remove('show');
    safeGet('difficulty-select')?.classList.remove('show');
    safeGet('side-select')?.classList.remove('show');
    safeGet('game')?.classList.add('show');
    safeGet('room-info')?.classList.remove('show');
    this.hideDialogs();
    this.hideRematchBar();
    this.hideEndBanner();
    this.setBoardDisabled(false);
    this.updateRestartButton();
    this.render();

    // 如果玩家选执黑（AI 执白先手 = WHITE），则开局 AI 自动走
    if (this.state.status === 'playing' && this.state.current === aiPlayer) {
      this.scheduleAiMove(aiPlayer);
    }
  },

  hideDialogs() {
    safeGet('difficulty-select')?.classList.remove('show');
    safeGet('side-select')?.classList.remove('show');
    safeGet('join-dialog')?.classList.remove('show');
  },

  hideEndBanner() {
    const banner = safeGet('end-banner'); if (!banner) return;
    banner.classList.remove('show');
    banner.hidden = true;
  },
  showEndBanner(title, cls) {
    const banner = safeGet('end-banner'); if (!banner) return;
    // Banner 不再显示胜负文案（已经改由 turn-indicator 承担），
    // 但保留 class 接口兼容，title 可传空。
    const t = safeGet('end-title');
    t.textContent = '';   // 不写"AI获胜"那一行
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
  },
  stopAiCandidateCycle() {
    if (this.aiCandidatesTimer) { clearInterval(this.aiCandidatesTimer); this.aiCandidatesTimer = null; }
    this.aiCandidates = [];
    this.aiCandidatesActiveIdx = 0;
  },
  startAiCandidateCycle(boardArr, mustIncludeKey, opts) {
    // opts: { targetCount?: number (1-3), cyclePeriod?: number (ms) }
    // 若 opts 未传，则按默认参数推导（兼容旧调用）
    opts = opts || {};
    // 从所有空格挑候选位置，循环切换红圈
    const empties = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (boardArr[r][c] === 0) empties.push(`${r}-${c}`);
    if (empties.length === 0) return opts.cyclePeriod || 800;
    // Fisher-Yates 打乱
    for (let i = empties.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [empties[i], empties[j]] = [empties[j], empties[i]];
    }
    // 候选数量：用户要求 1-3 个随机；外部指定时优先用 opts.targetCount
    let targetN;
    if (typeof opts.targetCount === 'number') {
      targetN = Math.max(1, Math.min(3, Math.min(opts.targetCount, empties.length)));
    } else {
      // 默认 1-3 随机
      targetN = Math.max(1, Math.min(3, Math.min(1 + Math.floor(Math.random() * 3), empties.length)));
    }
    let picked = empties.slice(0, targetN);
    // 确保 mustIncludeKey 包含在内（候选保证出现过真实位置，最后"定格"也就能落在那）
    if (mustIncludeKey && empties.includes(mustIncludeKey) && !picked.includes(mustIncludeKey)) {
      picked[picked.length - 1] = mustIncludeKey;
    }
    this.aiCandidates = picked;
    this.aiCandidatesActiveIdx = 0;

    // 候选切换周期：外部传入 > 默认 1400-1600ms
    const cyclePeriod = (typeof opts.cyclePeriod === 'number' && opts.cyclePeriod > 0)
      ? opts.cyclePeriod
      : (1400 + Math.floor(Math.random() * 201));
    this.render();
    this.aiCandidatesTimer = setInterval(() => {
      this.aiCandidatesActiveIdx = (this.aiCandidatesActiveIdx + 1) % this.aiCandidates.length;
      this.render();
    }, cyclePeriod);
    return cyclePeriod;
  },

  // ==================== 联机 ====================
  goOnline() {
    // 单机静态分享版本（moon-chess-standalone.html）：没有真实 WebSocket 服务
    if (window.MOON_CHESS_STANDALONE && typeof window.__moon_chess_showOnlineTip === 'function') {
      window.__moon_chess_showOnlineTip();
      return;
    }
    this.mode = 'online';
    this.playerSide = (this.mySeat === 1) ? 'white' : 'black';
    this.clearAiTimer(true);
    this.stopAiCandidateCycle();
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
    if (this.socket) this.socket.emit('room:create');
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
      // 不再渲染 last-move 光圈（用户要求去掉蓝框）
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
      const humanPlayer = (this.playerSide === 'white') ? WHITE : BLACK;
      const aiPlayer    = (this.playerSide === 'white') ? BLACK : WHITE;
      if (this.state.current !== humanPlayer) return;
      if (this.aiTimer) return;                    // AI 思考中，点不了
      if (this.local.board[row][col] !== 0) return;
      const res = this.local.place(row, col, humanPlayer);
      if (!res.ok) return;
      this.state = this.local.snapshot();
      // 落子后有棋子消失，挂视觉幽灵播放淡出动画（逻辑已移除）
      if (res.removed) this.stageRemovingVisual(res.removed);
      this.updateRestartButton();
      this.render();

      // AI 自动下（候选红圈动画 + 慢速落子）—— 推迟到下一帧，保证首帧渲染就绪
      if (this.state.status === 'playing' && this.state.current === aiPlayer) {
        const aiRef = aiPlayer;
        setTimeout(() => this.scheduleAiMove(aiRef), 60);
      }
      return;
    }

    if (this.mode === 'online') {
      if (this.state.current !== this.mySeat) return;
      if (this.state.board[row][col] !== 0) return;
      this.socket.emit('game:place', { roomCode: this.roomCode, row, col, seat: this.mySeat });
    }
  },

  scheduleAiMove(aiPlayerNum) {
    this.clearAiTimer(false);
    this.stopAiCandidateCycle();
    this.setBoardDisabled(true);

    // ======== 节奏设计（用户核心：保证玩家至少看完 1.5 个"消失预警闪烁"周期） ========
    // 预警闪烁 fadeBlink 周期 = 4s → 1.5 周期 = 6s；本实现整段 AI 动画 ≈ 6~8s
    // 用户进一步要求：
    //   1) 候选最多 2 个（1 个随机假位置 + 真实要下的位置）—— 3 个显慢
    //   2) 切换到最后时，自然落脚点就等于 moveKey，不多做一次"最后切换动画"
    const aiTotalFloor = 6000;
    const aiTotalJitter = Math.floor(Math.random() * 1700); // 0..1699
    const aiTotalTime = aiTotalFloor + aiTotalJitter;  // 6.0..7.7s

    // 候选切换间隔：1400-1600ms
    const cyclePeriod = 1400 + Math.floor(Math.random() * 201);

    // 定格：按设定的"同样间隔"（即 1 × cyclePeriod）
    const freezeDuration = cyclePeriod;

    // 候选数量：1-2 个随机"假"位置 + 真实要下的位置 → 总数 2 或 3（用户修正："1-2个随机+实际位置"）
    let emptyCount = 0;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (this.local.board[r][c] === 0) emptyCount++;
    const fakeCount = 1 + Math.floor(Math.random() * 2); // 1 或 2 个干扰位
    const targetCount = Math.max(1, Math.min(1 + fakeCount, emptyCount));  // 总数 2 或 3；空格不够时收缩

    // 切换阶段最少 3 轮（候选数由 3→2 后，3 轮约 4.2s 已经够玩家看清闪烁 + 切换，总时长 5.6+1.4=7s）
    const minSwitchCycles = 3;
    let switchCycles = Math.floor((aiTotalTime - freezeDuration) / cyclePeriod);
    if (switchCycles < minSwitchCycles) switchCycles = minSwitchCycles;

    // 同步计算 AI 真实着法
    const move = AI.aiMove(this.local.board, this.local.pieces, this.local.order, aiPlayerNum, this.difficulty);
    if (!move) {
      this.clearAiTimer(true);
      this.stopAiCandidateCycle();
      this.setBoardDisabled(false);
      this.render();
      return;
    }
    const moveKey = `${move.row}-${move.col}`;

    // 启动候选（1~2 个；必须包含 moveKey）
    this.startAiCandidateCycle(this.local.board, moveKey, { targetCount, cyclePeriod });
    this.render();

    // ==== 关键：调整 switchCycles，让 N 轮切换后的 (0+S) % N 正好 = moveKey 的下标
    //      → 最后一个位置自然就是要下的位置，不用额外再切一次
    const N = this.aiCandidates.length;
    const moveKeyIdx = this.aiCandidates.indexOf(moveKey);
    if (N >= 1 && moveKeyIdx >= 0) {
      const currentFinalAfterCycles = (0 + switchCycles) % N;
      const delta = (moveKeyIdx - currentFinalAfterCycles + N) % N;
      switchCycles += delta;
    }
    const thinkWaitTime = switchCycles * cyclePeriod;

    this.aiTimer = setTimeout(() => {
      // ===== 定格：此时 activeIdx 自然就是 moveKeyIdx，不再做一次"切换"渲染 =====
      // （循环 setInterval 在 thinkWaitTime 里正好跑了 switchCycles 次，所以 (0+switchCycles)%N == moveKeyIdx）
      // 为保险仍对齐一次（无视觉变化因为本来就对），然后直接进入定格
      if (moveKeyIdx >= 0 && this.aiCandidatesActiveIdx !== moveKeyIdx) {
        this.aiCandidatesActiveIdx = moveKeyIdx;
      }
      this.render();
      // 经过一个完整的 cyclePeriod 定格展示后 → 实际落下（按同样间隔）
      this.aiTimer = setTimeout(() => {
        this.stopAiCandidateCycle();
        const res = this.local.place(move.row, move.col, aiPlayerNum);
        this.aiTimer = null;
        this.state = this.local.snapshot();
        if (res && res.removed) this.stageRemovingVisual(res.removed);
        this.setBoardDisabled(false);
        this.updateRestartButton();
        this.render();
        if (!res) return;
        if (this.state.status === 'ended') return;
        const humanPlayer = (this.playerSide === 'white') ? WHITE : BLACK;
        if (this.state.current !== humanPlayer) {
          this.scheduleAiMove(this.state.current);
        }
      }, freezeDuration);
    }, thinkWaitTime);
  },

  // 顶部重开 / 结束横幅「再来一局」共用
  handleRestart() {
    if (this.mode === 'local') {
      // 只要一个标题"再开一局"，去掉描述句子
      this.showConfirm({
        title: '再开一局',
        desc: '',
        onYes: () => {
          this.clearAiTimer(true);
          this.stopAiCandidateCycle();
          this.clearRemovingVisual(false);
          this._resetCellRenderKeys();
          this.local.reset();
          this.state = this.local.snapshot();
          this.hideEndBanner();
          this.setBoardDisabled(false);
          this.updateRestartButton();
          this.render();
          // 玩家选执黑先手时，开局由 AI 执白先走
          const aiPlayer = (this.playerSide === 'white') ? BLACK : WHITE;
          if (this.state.status === 'playing' && this.state.current === aiPlayer) {
            this.scheduleAiMove(aiPlayer);
          }
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
    this.stopAiCandidateCycle();
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

    // ===== 每个单元格使用"渲染签名 + 缓存"，只在内容真正变化时重建 DOM
    // 目的：AI 候选切换动画时，不变的棋子（尤其是带 .fading 闪烁动画的）不会被销毁重建 → 动画流畅不卡
    const pendingRemove = this.state.pendingRemove;
    const visualR = this.visualRemoving;
    const cells = document.querySelectorAll('.cell');
    cells.forEach((el) => {
      const row = parseInt(el.dataset.row, 10);
      const col = parseInt(el.dataset.col, 10);
      const v = this.state.board[row][col];

      // 计算本单元格"应渲染内容"的唯一签名 key
      // 形式: piece-p1-fading  /  piece-p2-removing  /  cand-active  /  cand-dim  /  empty  /  win
      let key;
      if (v !== 0) {
        key = 'p'; // 有棋
        const isFading = (pendingRemove && pendingRemove.row === row && pendingRemove.col === col);
        key += v + (isFading ? '-F' : '');
      } else {
        // 空棋格
        if (visualR && visualR.row === row && visualR.col === col) {
          key = 'g' + visualR.player; // ghost 幽灵消失棋
        } else if (this.mode === 'local' && this.aiCandidates.length > 0) {
          const candIdx = this.aiCandidates.indexOf(`${row}-${col}`);
          if (candIdx > -1) {
            const active = (candIdx === this.aiCandidatesActiveIdx);
            key = active ? 'cA' : 'cD'; // candidate Active / Dim
          } else {
            key = 'e'; // empty
          }
        } else {
          key = 'e'; // empty
        }
      }

      // 签名没变 → DOM 可以保留（例如只切AI候选active/dim在别的格子，不影响这里的闪烁棋子）
      // 例外：候选 dim→active / active→dim 也需要更新，这个已经包含在 key ('cA' vs 'cD') 中
      if (el.dataset._k === key) return;
      el.dataset._k = key;

      // 真正需要重绘时才清空并重写
      el.innerHTML = '';

      if (v !== 0) {
        const piece = document.createElement('div');
        piece.className = 'piece p' + v;
        const isFading = (pendingRemove && pendingRemove.row === row && pendingRemove.col === col);
        if (isFading) piece.classList.add('fading');
        piece.classList.add('drop');
        requestAnimationFrame(() => piece.classList.remove('drop'));
        piece.innerHTML = this._gemSVG(v);
        el.appendChild(piece);
      } else if (visualR && visualR.row === row && visualR.col === col) {
        // 逻辑上已消失的棋子，再播放一次 600ms 淡出动画作为视觉过渡
        const piece = document.createElement('div');
        piece.className = 'piece p' + visualR.player + ' removing-out';
        piece.innerHTML = this._gemSVG(visualR.player);
        el.appendChild(piece);
      } else if (this.mode === 'local' && this.aiCandidates.length > 0) {
        const candIdx = this.aiCandidates.indexOf(`${row}-${col}`);
        if (candIdx > -1) {
          const cv = document.createElement('div');
          const active = (candIdx === this.aiCandidatesActiveIdx);
          cv.className = 'think-candidate ' + (active ? 'active' : 'dim');
          el.appendChild(cv);
        }
      }
    });

    // 赢线（.win 类）属于单元格额外状态，与签名解耦，单独刷新
    // 先清除，再加
    cells.forEach((el) => el.classList.remove('win'));
    const winLine = this.state.winLine;
    if (winLine && this.state.status === 'ended') {
      for (const [r, c] of winLine) {
        const cell = document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
        if (cell) cell.classList.add('win');
      }
    }

    // 棋盘禁用态（AI 思考 / 对局结束）
    const humanPlayer = (this.playerSide === 'white') ? WHITE : BLACK;
    if (this.state.status === 'ended') {
      this.setBoardDisabled(true);
    } else if (this.mode === 'local') {
      this.setBoardDisabled(!!this.aiTimer || this.state.current !== humanPlayer);
    }

    this.renderTurnIndicator();

    // 结束显示：横幅按钮区 + 联机投票条
    if (this.state.status === 'ended') {
      this.renderEndBanner();
      if (this.mode === 'online') this.renderRematchBar();
      else this.hideRematchBar();
    } else {
      this.hideEndBanner();
      if (this.mode === 'local') {
        this.hideRematchBar();
      } else if (this.rematch.status === 'none') {
        this.hideRematchBar();
      }
    }

    if (this.mode === 'online') this.updateRoomUI({});
  },

  renderTurnIndicator() {
    const el = safeGet('turn-indicator');
    if (!el || !this.state) return;
    const cur = this.state.current;
    let label = '';
    let dotHtml = '';
    let miniGem = '';

    if (this.state.status === 'ended') {
      // 胜利文案改为玩家视角：本方胜利 / AI胜利 / 平局
      const w = this.state.winner;
      if (w === 0) {
        label = '平局';
      } else if (this.mode === 'local') {
        const humanPlayer = (this.playerSide === 'white') ? WHITE : BLACK;
        label = (w === humanPlayer) ? '本方胜利！ 🎉' : 'AI胜利！';
        miniGem = this._miniGemSVG(w === humanPlayer ? humanPlayer : (this.playerSide === 'white' ? BLACK : WHITE));
      } else {
        // online 视角：本方 / 对方
        label = (w === this.mySeat) ? '本方胜利！ 🎉' : '对方胜利！';
      }
    } else if (this.mode === 'local') {
      const humanPlayer = (this.playerSide === 'white') ? WHITE : BLACK;
      const aiPlayer    = (this.playerSide === 'white') ? BLACK : WHITE;
      // 简化：只显示"你的回合 / AI 思考中" + 迷你棋子图标（本方颜色）
      miniGem = this._miniGemSVG(humanPlayer);
      if (cur === humanPlayer) {
        label = '你的回合';
      } else {
        label = 'AI 思考中';
        dotHtml = '<span class="thinking-dot" aria-hidden="true"></span>';
      }
    } else if (this.mode === 'online') {
      miniGem = this._miniGemSVG(this.mySeat);
      label = cur === this.mySeat ? '你的回合' : '对方回合';
      if (cur !== this.mySeat) dotHtml = '<span class="thinking-dot" aria-hidden="true"></span>';
    } else {
      label = cur === WHITE ? '白方回合' : '黑方回合';
    }
    el.innerHTML = miniGem + label + dotHtml;
    // 颜色：本地/联机都根据 cur 选用白色类或黑色类（white/black），ended 保持中性 white
    if (this.state.status === 'ended') el.className = 'turn-indicator ended';
    else if (this.mode === 'local') el.className = 'turn-indicator ' + ((cur === WHITE) ? 'white' : 'black');
    else el.className = 'turn-indicator ' + ((cur === this.mySeat) ? 'white' : 'black');
  },

  _miniGemSVG(player) {
    // 迷你棋子图标（嵌入 turn-indicator）
    if (player === WHITE) {
      return `<svg class="mini-gem" viewBox="0 0 100 100" aria-hidden="true"><defs>
        <radialGradient id="mgw" cx="48%" cy="36%" r="68%">
          <stop offset="0%" stop-color="#ffffff"/><stop offset="40%" stop-color="#ffd5ef"/>
          <stop offset="75%" stop-color="#ff9bd1"/><stop offset="100%" stop-color="#c97bff"/>
        </radialGradient></defs>
        <polygon points="50,10 86,30 86,70 50,90 14,70 14,30" fill="url(#mgw)" stroke="#ffd8ec" stroke-opacity="0.7" stroke-width="1.4"/>
        <polygon points="50,10 68,30 50,44 32,30" fill="#ffffff" fill-opacity="0.55"/>
        <circle cx="46" cy="40" r="4" fill="#ffffff" fill-opacity="0.9"/></svg>`;
    } else {
      return `<svg class="mini-gem" viewBox="0 0 100 100" aria-hidden="true"><defs>
        <radialGradient id="mgb" cx="50%" cy="34%" r="70%">
          <stop offset="0%" stop-color="#e9efff"/><stop offset="30%" stop-color="#8fb3ff"/>
          <stop offset="60%" stop-color="#7a5bff"/><stop offset="88%" stop-color="#4a2bc7"/><stop offset="100%" stop-color="#241070"/>
        </radialGradient></defs>
        <polygon points="50,10 86,30 86,70 50,90 14,70 14,30" fill="url(#mgb)" stroke="#c0b8ff" stroke-opacity="0.7" stroke-width="1.4"/>
        <polygon points="50,10 68,30 50,44 32,30" fill="#d7e6ff" fill-opacity="0.42"/>
        <circle cx="46" cy="40" r="3.6" fill="#e9f2ff" fill-opacity="0.9"/></svg>`;
    }
  },

  renderEndBanner() {
    // 用户要求：对局结束时只保留顶部一行按钮（重开/退出），移除下方 end-banner 重复按钮排
    this.hideEndBanner();
  },

  _gemSVG(player) {
    // P1 = 先手 · 粉白（粉+珠光白+青蓝边，原神月亮棋白棋色）
    // P2 = 后手 · 紫蓝（皇家蓝 + 紫罗兰，原神月亮棋黑棋色）
    if (player === WHITE) {
      return `<svg viewBox="0 0 100 100" class="gem"><defs>
        <radialGradient id="gw" cx="48%" cy="36%" r="68%">
          <stop offset="0%"   stop-color="#ffffff" stop-opacity="1"/>
          <stop offset="32%"  stop-color="#fff5fb" stop-opacity="0.98"/>
          <stop offset="58%"  stop-color="#ffc3de" stop-opacity="0.96"/>
          <stop offset="82%"  stop-color="#ff8fc7" stop-opacity="0.94"/>
          <stop offset="100%" stop-color="#c97bff" stop-opacity="0.9"/>
        </radialGradient>
        <linearGradient id="gws" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"  stop-color="#b6efff" stop-opacity="0.45"/>
          <stop offset="100%" stop-color="#ffa4d6" stop-opacity="0.1"/>
        </linearGradient>
        <filter id="glw"><feGaussianBlur stdDeviation="2.4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <polygon points="50,8 88,30 88,70 50,92 12,70 12,30" fill="url(#gw)" filter="url(#glw)" stroke="#ffd8ec" stroke-opacity="0.78" stroke-width="1.2"/>
      <!-- 左上青蓝粉 facet -->
      <polygon points="12,30 30,30 14,52 12,30" fill="url(#gws)"/>
      <polygon points="30,30 50,8 50,50 30,70 14,52 30,30" fill="#c4f3ff" fill-opacity="0.14"/>
      <!-- 顶部高光 -->
      <polygon points="50,8 70,30 50,44 30,30" fill="#ffffff" fill-opacity="0.52"/>
      <!-- 右下粉 facet -->
      <polygon points="88,30 88,70 70,50 70,30" fill="#ff6fb8" fill-opacity="0.18"/>
      <polygon points="50,92 30,70 50,54 70,70 88,70 50,92" fill="#b87aff" fill-opacity="0.18"/>
      <!-- 中央闪耀点 -->
      <circle cx="46" cy="40" r="3.4" fill="#ffffff" fill-opacity="0.92"/>
    </svg>`;
    } else {
      return `<svg viewBox="0 0 100 100" class="gem"><defs>
        <radialGradient id="gb" cx="50%" cy="34%" r="70%">
          <stop offset="0%"   stop-color="#e9efff" stop-opacity="1"/>
          <stop offset="30%"  stop-color="#8fb3ff" stop-opacity="0.98"/>
          <stop offset="58%"  stop-color="#7a5bff" stop-opacity="0.97"/>
          <stop offset="84%"  stop-color="#4a2bc7" stop-opacity="0.95"/>
          <stop offset="100%" stop-color="#241070" stop-opacity="0.92"/>
        </radialGradient>
        <linearGradient id="gbs" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"  stop-color="#7e6bff" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="#3b6fff" stop-opacity="0.28"/>
        </linearGradient>
        <filter id="glb"><feGaussianBlur stdDeviation="2.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <polygon points="50,8 88,30 88,70 50,92 12,70 12,30" fill="url(#gb)" filter="url(#glb)" stroke="#c0b8ff" stroke-opacity="0.72" stroke-width="1.2"/>
      <!-- 左紫 facet + 右蓝 facet 斜切 -->
      <polygon points="12,30 30,30 14,52 12,30" fill="#9e7cff" fill-opacity="0.28"/>
      <polygon points="30,30 50,8 50,50 30,70 14,52 30,30" fill="url(#gbs)"/>
      <!-- 顶部高光 -->
      <polygon points="50,8 70,30 50,44 30,30" fill="#d7e6ff" fill-opacity="0.38"/>
      <!-- 右下紫+蓝混合 facet -->
      <polygon points="88,30 88,70 68,50 70,30" fill="#3a6bff" fill-opacity="0.24"/>
      <polygon points="50,92 30,70 50,54 70,70 88,70 50,92" fill="#6b3cff" fill-opacity="0.2"/>
      <!-- 中央闪耀点 -->
      <circle cx="46" cy="40" r="3" fill="#e9f2ff" fill-opacity="0.9"/>
    </svg>`;
    }
  },
};

function safeGet(id) {
  const el = document.getElementById(id);
  return el || null;
}

document.addEventListener('DOMContentLoaded', () => App.init());
