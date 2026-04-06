// ===== Particle Background =====
(function initParticles() {
  const canvas = document.getElementById('particles');
  const ctx = canvas.getContext('2d');
  let particles = [];
  const COUNT = 60;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  for (let i = 0; i < COUNT; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.5 + 0.5,
      dx: (Math.random() - 0.5) * 0.4,
      dy: (Math.random() - 0.5) * 0.4,
      alpha: Math.random() * 0.4 + 0.1
    });
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p, i) => {
      p.x += p.dx;
      p.y += p.dy;
      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 153, 0, ${p.alpha})`;
      ctx.fill();

      // Draw connections
      for (let j = i + 1; j < particles.length; j++) {
        const p2 = particles[j];
        const dist = Math.hypot(p.x - p2.x, p.y - p2.y);
        if (dist < 120) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = `rgba(255, 153, 0, ${0.06 * (1 - dist / 120)})`;
          ctx.stroke();
        }
      }
    });
    requestAnimationFrame(draw);
  }
  draw();
})();

// ===== Scroll Nav =====
window.addEventListener('scroll', () => {
  document.getElementById('nav').classList.toggle('scrolled', window.scrollY > 50);
});

// ===== Hamburger Menu =====
const hamburger = document.getElementById('navHamburger');
const navLinks = document.getElementById('navLinks');

hamburger.addEventListener('click', () => {
  const isOpen = navLinks.classList.toggle('open');
  hamburger.classList.toggle('open', isOpen);
  hamburger.setAttribute('aria-expanded', isOpen);
  document.body.style.overflow = isOpen ? 'hidden' : '';
});

// Close menu when a link is clicked
navLinks.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    hamburger.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  });
});

// ===== Swiss Tournament Engine =====
const TournamentApp = (() => {
  let players = [];
  let rounds = [];
  let currentRound = 0;
  let totalRounds = 0;
  let tournamentStarted = false;

  // DOM refs
  const playerNameInput = document.getElementById('playerName');
  const addPlayerBtn = document.getElementById('addPlayerBtn');
  const bulkPlayersInput = document.getElementById('bulkPlayers');
  const bulkImportBtn = document.getElementById('bulkImportBtn');
  const playerList = document.getElementById('playerList');
  const playerCount = document.getElementById('playerCount');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const startBtn = document.getElementById('startTournamentBtn');
  const nextRoundBtn = document.getElementById('nextRoundBtn');
  const resetBtn = document.getElementById('resetTournamentBtn');
  const currentRoundEl = document.getElementById('currentRound');
  const totalRoundsEl = document.getElementById('totalRounds');
  const pairingsArea = document.getElementById('pairingsArea');
  const standingsArea = document.getElementById('standingsArea');
  const standingsBody = document.getElementById('standingsBody');
  const saveRecordBtn = document.getElementById('saveRecordBtn');

  // Guard: if core tool elements don't exist, this is not the tool page
  if (!playerList) return { players, rounds };

  // ── localStorage persistence ───────────────────────────────────────────
  const STORAGE_KEY = 'cardclash_tournament';

  function saveState() {
    try {
      const data = {
        players: players.map(p => ({
          id: p.id, name: p.name, wins: p.wins, draws: p.draws,
          losses: p.losses, points: p.points, opponents: p.opponents, hadBye: p.hadBye
        })),
        rounds: rounds.map(round => round.map(m => ({
          p1Id: m.p1.id, p2Id: m.p2 ? m.p2.id : null, result: m.result
        }))),
        currentRound, totalRounds, tournamentStarted
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (_) {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data.players || !data.players.length) return false;

      // Restore players
      players = data.players.map(p => ({
        id: p.id, name: p.name, wins: p.wins, draws: p.draws,
        losses: p.losses, points: p.points, opponents: p.opponents || [], hadBye: p.hadBye || false
      }));

      // Restore rounds with player object references
      const playerMap = new Map(players.map(p => [p.id, p]));
      rounds = (data.rounds || []).map(round => round.map(m => ({
        p1: playerMap.get(m.p1Id),
        p2: m.p2Id ? playerMap.get(m.p2Id) : null,
        result: m.result
      })));

      currentRound = data.currentRound || 0;
      totalRounds = data.totalRounds || 0;
      tournamentStarted = data.tournamentStarted || false;
      return true;
    } catch (_) { return false; }
  }

  function clearSavedState() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  }

  // Player data structure
  function createPlayer(name) {
    return {
      id: Date.now() + Math.random(),
      name: name.trim(),
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
      opponents: [],
      hadBye: false
    };
  }

  // Calculate Buchholz score (sum of opponents' points)
  function buchholz(player) {
    return player.opponents.reduce((sum, oppId) => {
      const opp = players.find(p => p.id === oppId);
      return sum + (opp ? opp.points : 0);
    }, 0);
  }

  // Calculate recommended rounds: ceil(log2(n))
  function calcRounds(n) {
    if (n <= 1) return 0;
    return Math.ceil(Math.log2(n));
  }

  // Swiss pairing algorithm
  function generatePairings() {
    // Sort by points descending, then buchholz
    const sorted = [...players].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return buchholz(b) - buchholz(a);
    });

    const paired = new Set();
    const pairings = [];

    for (let i = 0; i < sorted.length; i++) {
      const p1 = sorted[i];
      if (paired.has(p1.id)) continue;

      let matched = false;
      for (let j = i + 1; j < sorted.length; j++) {
        const p2 = sorted[j];
        if (paired.has(p2.id)) continue;
        if (p1.opponents.includes(p2.id)) continue;

        pairings.push({ p1, p2, result: null });
        paired.add(p1.id);
        paired.add(p2.id);
        matched = true;
        break;
      }

      // If no match found, try anyone not yet paired
      if (!matched) {
        for (let j = 0; j < sorted.length; j++) {
          const p2 = sorted[j];
          if (p2.id === p1.id || paired.has(p2.id)) continue;
          pairings.push({ p1, p2, result: null });
          paired.add(p1.id);
          paired.add(p2.id);
          matched = true;
          break;
        }
      }

      // Bye
      if (!matched && !p1.hadBye) {
        pairings.push({ p1, p2: null, result: 'bye' });
        paired.add(p1.id);
        p1.hadBye = true;
        p1.wins++;
        p1.points += 3;
      }
    }

    return pairings;
  }

  // Render player list
  function renderPlayers() {
    playerCount.textContent = players.length;
    playerList.innerHTML = '';
    players.forEach((p, idx) => {
      const li = document.createElement('li');
      li.className = 'player-item';
      li.innerHTML = `
        <span>${idx + 1}. ${p.name}</span>
        <button class="player-remove" data-id="${p.id}" aria-label="移除选手 ${p.name}">&times;</button>
      `;
      playerList.appendChild(li);
    });
  }

  // Render pairings for current round
  function renderPairings() {
    const round = rounds[currentRound - 1];
    if (!round) return;

    let html = `<div class="round-header">第 ${currentRound} 轮 配对</div>`;

    let roomNum = 1;
    round.forEach((match, idx) => {
      if (match.p2 === null) {
        // Bye — no room assigned
        html += `
          <div class="pairing-row">
            <span class="pairing-room">—</span>
            <span class="pairing-player">${match.p1.name}</span>
            <span class="pairing-vs">BYE</span>
            <span class="pairing-player pairing-bye">轮空 (自动获胜)</span>
          </div>`;
      } else {
        const resultClass1 = match.result === 'p1' ? 'active-win' : '';
        const resultClassDraw = match.result === 'draw' ? 'active-draw' : '';
        const resultClass2 = match.result === 'p2' ? 'active-win' : '';
        const room = roomNum++;

        html += `
          <div class="pairing-row">
            <span class="pairing-room">${room}</span>
            <span class="pairing-player">${match.p1.name}</span>
            <span class="pairing-vs">VS</span>
            <span class="pairing-player">${match.p2.name}</span>
            <div class="result-btns">
              <button class="result-btn ${resultClass1}" data-match="${idx}" data-result="p1" aria-label="${match.p1.name} 获胜">左胜</button>
              <button class="result-btn ${resultClassDraw}" data-match="${idx}" data-result="draw" aria-label="平局">平局</button>
              <button class="result-btn ${resultClass2}" data-match="${idx}" data-result="p2" aria-label="${match.p2.name} 获胜">右胜</button>
            </div>
          </div>`;
      }
    });

    pairingsArea.innerHTML = html;

    // Bind result buttons
    pairingsArea.querySelectorAll('.result-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const matchIdx = parseInt(btn.dataset.match);
        const result = btn.dataset.result;
        setResult(matchIdx, result);
      });
    });
  }

  // Set match result
  function setResult(matchIdx, result) {
    const round = rounds[currentRound - 1];
    const match = round[matchIdx];
    if (!match || match.p2 === null) return;

    // Undo previous result
    if (match.result) {
      undoResult(match);
    }

    match.result = result;

    if (result === 'p1') {
      match.p1.wins++;
      match.p1.points += 3;
      match.p2.losses++;
    } else if (result === 'p2') {
      match.p2.wins++;
      match.p2.points += 3;
      match.p1.losses++;
    } else if (result === 'draw') {
      match.p1.draws++;
      match.p1.points += 1;
      match.p2.draws++;
      match.p2.points += 1;
    }

    // Record opponents
    if (!match.p1.opponents.includes(match.p2.id)) {
      match.p1.opponents.push(match.p2.id);
      match.p2.opponents.push(match.p1.id);
    }

    renderPairings();
    renderStandings();
    checkRoundComplete();
    pushLiveState();
    saveState();
  }

  function undoResult(match) {
    if (match.result === 'p1') {
      match.p1.wins--;
      match.p1.points -= 3;
      match.p2.losses--;
    } else if (match.result === 'p2') {
      match.p2.wins--;
      match.p2.points -= 3;
      match.p1.losses--;
    } else if (match.result === 'draw') {
      match.p1.draws--;
      match.p1.points -= 1;
      match.p2.draws--;
      match.p2.points -= 1;
    }
    match.result = null;
  }

  function checkRoundComplete() {
    const round = rounds[currentRound - 1];
    const allDone = round.every(m => m.result !== null);
    const isLastRound = currentRound >= totalRounds;
    nextRoundBtn.disabled = !allDone || isLastRound;
    // Enable save only when all rounds are done
    if (saveRecordBtn) saveRecordBtn.disabled = !(allDone && isLastRound);
  }

  // Render standings table
  function renderStandings() {
    standingsArea.style.display = 'block';
    const sorted = [...players].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return buchholz(b) - buchholz(a);
    });

    standingsBody.innerHTML = '';
    sorted.forEach((p, idx) => {
      const rank = idx + 1;
      const rankClass = rank <= 3 ? `rank-${rank}` : '';
      const buch = buchholz(p);
      const tr = document.createElement('tr');
      tr.className = rankClass;
      tr.innerHTML = `
        <td>${rank}</td>
        <td>${p.name}</td>
        <td>${p.wins}</td>
        <td>${p.draws}</td>
        <td>${p.losses}</td>
        <td>${p.points}</td>
        <td>${buch}</td>
      `;
      standingsBody.appendChild(tr);
    });
  }

  // ── Live state sync ────────────────────────────────────────────────────────
  async function pushLiveState() {
    try {
      const cfg = (window.APP_CONFIG || {});
      const apiBase = (cfg.apiEndpoint || '').replace(/\/$/, '');
      const token = await Auth.getToken();
      if (!token) return; // only push if authenticated
      const headers = { 'Content-Type': 'application/json', Authorization: token };

      const payload = {
        active: tournamentStarted,
        currentRound,
        totalRounds,
        rounds: rounds.map(round => round.map(m => ({
          p1Name: m.p1.name,
          p2Name: m.p2 ? m.p2.name : null,
          result: m.result
        }))),
        standings: [...players].sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points;
          return buchholz(b) - buchholz(a);
        }).map(p => ({
          name: p.name,
          wins: p.wins,
          draws: p.draws,
          losses: p.losses,
          points: p.points,
          buchholz: buchholz(p)
        }))
      };

      await fetch(`${apiBase}/live`, { method: 'PUT', headers, body: JSON.stringify(payload) });
    } catch (e) {
      // silent fail — live sync is best-effort
    }
  }

  function addPlayer(name) {
    if (!name.trim()) return;
    if (tournamentStarted) return;
    if (players.some(p => p.name === name.trim())) {
      alert('该选手已存在');
      return;
    }
    players.push(createPlayer(name));
    renderPlayers();
    saveState();
  }

  // Event listeners
  addPlayerBtn.addEventListener('click', () => {
    addPlayer(playerNameInput.value);
    playerNameInput.value = '';
    playerNameInput.focus();
  });

  playerNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      addPlayer(playerNameInput.value);
      playerNameInput.value = '';
    }
  });

  bulkImportBtn.addEventListener('click', () => {
    const lines = bulkPlayersInput.value.split('\n').filter(l => l.trim());
    lines.forEach(name => addPlayer(name));
    bulkPlayersInput.value = '';
  });

  playerList.addEventListener('click', (e) => {
    if (e.target.classList.contains('player-remove')) {
      const id = parseFloat(e.target.dataset.id);
      players = players.filter(p => p.id !== id);
      renderPlayers();
      saveState();
    }
  });

  clearAllBtn.addEventListener('click', () => {
    if (tournamentStarted) return;
    players = [];
    renderPlayers();
    saveState();
  });

  startBtn.addEventListener('click', () => {
    if (players.length < 2) {
      alert('至少需要 2 名选手');
      return;
    }
    tournamentStarted = true;
    totalRounds = calcRounds(players.length);
    currentRound = 1;

    currentRoundEl.textContent = currentRound;
    totalRoundsEl.textContent = totalRounds;

    // Shuffle for first round
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    players = shuffled;

    const pairings = generatePairings();
    rounds.push(pairings);

    startBtn.disabled = true;
    renderPairings();
    renderStandings();
    pushLiveState();
    saveState();
  });

  nextRoundBtn.addEventListener('click', () => {
    if (currentRound >= totalRounds) return;
    currentRound++;
    currentRoundEl.textContent = currentRound;

    const pairings = generatePairings();
    rounds.push(pairings);

    nextRoundBtn.disabled = true;
    renderPairings();
    renderStandings();
    pushLiveState();
    saveState();
  });

  resetBtn.addEventListener('click', () => {
    if (!confirm('确定要重置赛事吗？所有比赛数据将被清除。')) return;
    players.forEach(p => {
      p.wins = 0;
      p.draws = 0;
      p.losses = 0;
      p.points = 0;
      p.opponents = [];
      p.hadBye = false;
    });
    rounds = [];
    currentRound = 0;
    totalRounds = 0;
    tournamentStarted = false;

    currentRoundEl.textContent = '未开始';
    totalRoundsEl.textContent = '-';
    startBtn.disabled = false;
    nextRoundBtn.disabled = true;
    if (saveRecordBtn) saveRecordBtn.disabled = true;

    pairingsArea.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏆</div>
        <p>添加选手并点击"开始锦标赛"生成配对</p>
      </div>`;
    standingsArea.style.display = 'none';
    renderPlayers();
    // Clear live state
    (async () => {
      try {
        const cfg = (window.APP_CONFIG || {});
        const apiBase = (cfg.apiEndpoint || '').replace(/\/$/, '');
        const token = await Auth.getToken();
        if (token) await fetch(`${apiBase}/live`, { method: 'DELETE', headers: { Authorization: token } });
      } catch (e) {}
    })();
    clearSavedState();
  });

  // Save record to localStorage
  if (saveRecordBtn) {
    saveRecordBtn.addEventListener('click', () => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      const defaultName = `Card Clash ${new Date().toLocaleDateString('zh-CN')} 场`;
      overlay.innerHTML = `
        <div style="background:var(--bg-card);border:1px solid var(--border-accent);border-radius:12px;padding:32px;max-width:440px;width:100%;box-shadow:0 24px 80px rgba(0,0,0,.5);">
          <h3 style="font-size:18px;font-weight:700;margin-bottom:20px;font-family:var(--font-body);">保存本次成绩</h3>
          <div style="margin-bottom:16px;">
            <label style="display:block;font-size:13px;color:var(--text-secondary);margin-bottom:6px;">活动名称</label>
            <input type="text" id="saveNameInput" value="${defaultName}" style="width:100%;padding:10px 14px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-family:var(--font-body);font-size:14px;outline:none;box-sizing:border-box;">
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:24px;">
            <button id="cancelSave" style="padding:8px 18px;background:transparent;border:1px solid var(--border-accent);border-radius:8px;color:var(--text-primary);cursor:pointer;font-family:var(--font-body);font-size:14px;">取消</button>
            <button id="confirmSave" style="padding:8px 18px;background:linear-gradient(135deg,var(--accent),var(--accent-dim));border:none;border-radius:8px;color:#000;font-weight:700;cursor:pointer;font-family:var(--font-body);font-size:14px;">保存并查看</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const input = overlay.querySelector('#saveNameInput');
      input.focus(); input.select();

      overlay.querySelector('#cancelSave').onclick = () => overlay.remove();
      overlay.querySelector('#confirmSave').onclick = async () => {
        const btn = overlay.querySelector('#confirmSave');
        btn.textContent = '保存中...';
        btn.disabled = true;

        const eventName = input.value.trim() || defaultName;

        const sortedPlayers = [...players].sort((a, b) => {
          const ba = players.reduce((s, op) => op.opponents.includes(a.id) ? s + op.points : s, 0);
          const bb = players.reduce((s, op) => op.opponents.includes(b.id) ? s + op.points : s, 0);
          if (b.points !== a.points) return b.points - a.points;
          return bb - ba;
        });

        const standings = sortedPlayers.map(p => ({
          name: p.name,
          wins: p.wins,
          draws: p.draws,
          losses: p.losses,
          points: p.points,
          buchholz: players.reduce((s, op) => op.opponents.includes(p.id) ? s + op.points : s, 0)
        }));

        const serializedRounds = rounds.map(round =>
          round.map(m => ({
            p1Name: m.p1.name,
            p2Name: m.p2 ? m.p2.name : null,
            result: m.result
          }))
        );

        const record = {
          id: Date.now().toString(),
          eventName,
          savedAt: Date.now(),
          standings,
          rounds: serializedRounds
        };

        try {
          // 直接调用 API 保存，不依赖 RecordsApp
          const cfg = (window.APP_CONFIG || {});
          const apiBase = (cfg.apiEndpoint || '').replace(/\/$/, '') + '/records';
          const token = await Auth.getToken();
          const headers = { 'Content-Type': 'application/json' };
          if (token) headers['Authorization'] = token;

          const res = await fetch(apiBase, {
            method: 'POST',
            headers,
            body: JSON.stringify(record)
          });
          if (!res.ok) throw new Error(await res.text());

          overlay.remove();
          saveRecordBtn.disabled = true;
          saveRecordBtn.textContent = '✅ 已保存';
          clearSavedState();

          // 显示跳转提示（避免 confirm 被浏览器拦截）
          const toast = document.createElement('div');
          toast.style.cssText = 'position:fixed;bottom:32px;left:50%;transform:translateX(-50%);background:var(--bg-card);border:1px solid var(--border-accent);border-radius:10px;padding:16px 24px;display:flex;align-items:center;gap:16px;box-shadow:0 8px 32px rgba(0,0,0,.4);z-index:9999;font-family:var(--font-body);';
          toast.innerHTML = `
            <span style="font-size:14px;color:var(--text-primary);">✅ 成绩已保存</span>
            <a href="records.html" style="padding:6px 16px;background:linear-gradient(135deg,var(--accent),var(--accent-dim));border-radius:6px;color:#000;font-weight:700;font-size:13px;text-decoration:none;">查看成绩 →</a>
            <button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;line-height:1;">×</button>`;
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 8000);
        } catch (err) {
          btn.textContent = '保存';
          btn.disabled = false;
          alert('保存失败：' + (err.message || '请检查网络或登录状态'));
        }
      };

      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    });
  }

  // ── Restore saved state on page load ─────────────────────────────────
  if (loadState()) {
    renderPlayers();
    if (tournamentStarted) {
      currentRoundEl.textContent = currentRound;
      totalRoundsEl.textContent = totalRounds;
      startBtn.disabled = true;
      renderPairings();
      renderStandings();
      checkRoundComplete();
    }
  }

  // Expose internals needed by CheckinManager
  return {
    get players() { return players; },
    set players(v) { players = v; },
    get tournamentStarted() { return tournamentStarted; },
    rounds,
    createPlayer,
    renderPlayers,
    addPlayer
  };
})();


// ===== Checkin Manager (Admin Panel) =====
const CheckinManager = (() => {
  // DOM refs
  const checkinPanel     = document.getElementById('checkinPanel');
  const eventNameInput   = document.getElementById('checkinEventName');
  const startBtn         = document.getElementById('startCheckinBtn');
  const stopBtn          = document.getElementById('stopCheckinBtn');
  const linkArea         = document.getElementById('checkinLinkArea');
  const linkInput        = document.getElementById('checkinLink');
  const copyBtn          = document.getElementById('copyCheckinLinkBtn');
  const listEl           = document.getElementById('adminCheckinList');
  const countEl          = document.getElementById('adminCheckinCount');
  const importBtn        = document.getElementById('importCheckinBtn');
  const importMsg        = document.getElementById('checkinImportMsg');

  // Guard: if panel doesn't exist, bail out
  if (!checkinPanel) return {};

  let currentState = null;
  let ws = null;
  let reconnectTimer = null;
  const RECONNECT_DELAY = 3000;

  function apiBase() {
    return ((window.APP_CONFIG || {}).apiEndpoint || '').replace(/\/$/, '');
  }

  function wsUrl() {
    return (window.APP_CONFIG || {}).wsEndpoint || null;
  }

  // HTML escape to prevent XSS
  function escapeHtml(str) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(str).replace(/[&<>"']/g, c => map[c]);
  }

  // ── API helpers ────────────────────────────────────────────────────────
  async function checkinPut(body) {
    const token = await Auth.getToken();
    if (!token) return null;
    const res = await fetch(`${apiBase()}/checkin`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify(body)
    });
    return res;
  }

  // ── Core methods ───────────────────────────────────────────────────────
  async function startCheckin(eventName) {
    try {
      const res = await checkinPut({ action: 'start', eventName });
      if (!res || !res.ok) return;
      const data = await res.json();
      const sessionId = data.sessionId;
      // Build checkin link relative to current page
      const base = window.location.href.replace(/[^/]*$/, '');
      const link = `${base}checkin.html?session=${sessionId}`;
      // Update state and render
      currentState = {
        active: true,
        eventName,
        sessionId,
        players: [],
        ...(currentState || {})
      };
      currentState.active = true;
      currentState.eventName = eventName;
      currentState.sessionId = sessionId;
      currentState.players = [];
      render(currentState);
      // Show link
      linkInput.value = link;
      linkArea.style.display = 'block';
    } catch (e) {
      // silent fail
    }
  }

  async function stopCheckin() {
    try {
      const res = await checkinPut({ action: 'stop' });
      if (!res || !res.ok) return;
      if (currentState) {
        currentState.active = false;
      }
      render(currentState);
    } catch (e) {
      // silent fail
    }
  }

  async function removePlayer(nickname) {
    try {
      const res = await checkinPut({ action: 'remove', nickname });
      if (!res || !res.ok) return;
      // Optimistically remove from local state
      if (currentState && currentState.players) {
        currentState.players = currentState.players.filter(
          p => p.nickname.toLowerCase() !== nickname.toLowerCase()
        );
      }
      render(currentState);
    } catch (e) {
      // silent fail
    }
  }

  function importToTournament() {
    if (!currentState || !currentState.players || currentState.players.length === 0) return;
    if (TournamentApp.tournamentStarted) return;

    let imported = 0;
    const existingPlayers = TournamentApp.players;

    for (const cp of currentState.players) {
      const duplicate = existingPlayers.some(
        p => p.name.toLowerCase() === cp.nickname.toLowerCase()
      );
      if (!duplicate) {
        existingPlayers.push(TournamentApp.createPlayer(cp.nickname));
        imported++;
      }
    }

    TournamentApp.renderPlayers();
    importMsg.textContent = `已导入 ${imported} 名选手到赛程`;
    // Persist after import
    try { localStorage.setItem('cardclash_tournament', JSON.stringify({
      players: TournamentApp.players.map(p => ({
        id: p.id, name: p.name, wins: p.wins, draws: p.draws,
        losses: p.losses, points: p.points, opponents: p.opponents, hadBye: p.hadBye
      })),
      rounds: [], currentRound: 0, totalRounds: 0, tournamentStarted: false
    })); } catch (_) {}
    // Clear message after a few seconds
    setTimeout(() => { importMsg.textContent = ''; }, 5000);
  }

  // ── Render ─────────────────────────────────────────────────────────────
  function render(state) {
    currentState = state;

    // Show panel when authenticated
    if (Auth.isAuthenticated()) {
      checkinPanel.style.display = '';
    }

    if (!state) {
      // No checkin state — show start button, hide everything else
      startBtn.style.display = '';
      stopBtn.style.display = 'none';
      linkArea.style.display = 'none';
      countEl.textContent = '0';
      listEl.innerHTML = '';
      return;
    }

    const isActive = state.active === true;

    // Toggle start/stop buttons
    startBtn.style.display = isActive ? 'none' : '';
    stopBtn.style.display = isActive ? '' : 'none';

    // Show/hide link area
    if (isActive && state.sessionId) {
      const base = window.location.href.replace(/[^/]*$/, '');
      linkInput.value = `${base}checkin.html?session=${state.sessionId}`;
      linkArea.style.display = 'block';
    } else {
      linkArea.style.display = 'none';
    }

    // Update event name input
    if (state.eventName && eventNameInput) {
      eventNameInput.value = state.eventName;
    }

    // Render player list
    const players = state.players || [];
    countEl.textContent = players.length;
    listEl.innerHTML = players.map(p => {
      const safe = escapeHtml(p.nickname);
      // Use escapeHtml for attribute value too (safe for both display and attribute contexts)
      return `<li class="checkin-list-item">
        <span class="checkin-nickname">${safe}</span>
        <button class="checkin-remove-btn admin-only" data-nickname="${encodeURIComponent(p.nickname)}" aria-label="移除 ${safe}">&times;</button>
      </li>`;
    }).join('');

    // Disable import button when tournament has started
    importBtn.disabled = TournamentApp.tournamentStarted;
  }

  // ── Event listeners ────────────────────────────────────────────────────
  startBtn.addEventListener('click', () => {
    const name = eventNameInput.value.trim();
    if (!name) {
      eventNameInput.focus();
      return;
    }
    startCheckin(name);
  });

  stopBtn.addEventListener('click', () => {
    stopCheckin();
  });

  copyBtn.addEventListener('click', () => {
    linkInput.select();
    navigator.clipboard.writeText(linkInput.value).then(() => {
      copyBtn.textContent = '已复制';
      setTimeout(() => { copyBtn.textContent = '复制链接'; }, 2000);
    }).catch(() => {
      // Fallback for older browsers
      document.execCommand('copy');
      copyBtn.textContent = '已复制';
      setTimeout(() => { copyBtn.textContent = '复制链接'; }, 2000);
    });
  });

  listEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('checkin-remove-btn')) {
      const nickname = decodeURIComponent(e.target.dataset.nickname);
      if (nickname) removePlayer(nickname);
    }
  });

  importBtn.addEventListener('click', () => {
    importToTournament();
  });

  // ── WebSocket ──────────────────────────────────────────────────────────
  function connect() {
    const url = wsUrl();
    if (!url) return;

    ws = new WebSocket(url);

    ws.onopen = () => {
      clearTimeout(reconnectTimer);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'checkin' || data.id === '__checkin__') {
          render(data);
        }
      } catch (_) {}
    };

    ws.onerror = () => {};

    ws.onclose = () => {
      ws = null;
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
    };
  }

  // ── Init ───────────────────────────────────────────────────────────────
  async function init() {
    // Fetch initial checkin state
    try {
      const res = await fetch(`${apiBase()}/checkin`);
      if (res.ok) {
        const data = await res.json();
        if (data && (data.active !== undefined)) {
          render(data);
        }
      }
    } catch (e) {
      // silent fail
    }

    // Start WebSocket for real-time updates
    connect();
  }

  // Start when auth is ready
  init();

  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    clearTimeout(reconnectTimer);
    if (ws) ws.close();
  });

  return { startCheckin, stopCheckin, removePlayer, importToTournament, render, escapeHtml };
})();
