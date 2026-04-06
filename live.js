// ===== Live Tournament Viewer — WebSocket with HTTP fallback =====
(function LiveViewer() {
  const RECONNECT_DELAY = 3000;  // ms before reconnect attempt
  const FALLBACK_INTERVAL = 15000; // ms polling interval if WS unavailable

  const liveDot    = document.getElementById('liveDot');
  const liveStatus = document.getElementById('liveStatus');
  const liveMeta   = document.getElementById('liveMeta');
  const liveIdle   = document.getElementById('liveIdle');
  const liveContent= document.getElementById('liveContent');
  const roundLabel = document.getElementById('liveRoundLabel');
  const pairingsEl = document.getElementById('livePairings');
  const standingsEl= document.getElementById('liveStandingsBody');

  let ws = null;
  let fallbackTimer = null;
  let reconnectTimer = null;
  let usingFallback = false;

  function apiBase() {
    return ((window.APP_CONFIG || {}).apiEndpoint || '').replace(/\/$/, '');
  }

  function wsUrl() {
    return (window.APP_CONFIG || {}).wsEndpoint || null;
  }

  // ── Status indicator ───────────────────────────────────────────────────────
  function setStatus(state) {
    // state: 'connecting' | 'live' | 'fallback' | 'offline'
    liveDot.className = 'live-dot ' + (
      state === 'live' || state === 'fallback' ? 'dot-online' : 'dot-offline'
    );
    liveStatus.textContent = {
      connecting: '连接中...',
      live:       '实时同步中',
      fallback:   '轮询模式',
      offline:    '连接断开，重试中...'
    }[state] || '连接中...';
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function resultBadge(result, p1Name, p2Name) {
    if (!result) return '';
    if (result === 'p1')   return `<span class="live-result win">${p1Name} 胜</span>`;
    if (result === 'p2')   return `<span class="live-result win">${p2Name} 胜</span>`;
    if (result === 'draw') return `<span class="live-result draw">平局</span>`;
    return '';
  }

  function render(data) {
    if (!data || !data.active) {
      liveIdle.style.display = 'block';
      liveContent.style.display = 'none';
      liveMeta.textContent = '';
      return;
    }

    liveIdle.style.display = 'none';
    liveContent.style.display = 'block';

    roundLabel.textContent = `第 ${data.currentRound} 轮 / 共 ${data.totalRounds} 轮`;

    if (data.updatedAt) {
      liveMeta.textContent = `最后更新：${new Date(data.updatedAt).toLocaleTimeString('zh-CN')}`;
    }

    // Pairings
    const matches = (data.rounds || [])[data.currentRound - 1] || [];
    let pHtml = '';
    let roomNum = 1;
    matches.forEach(m => {
      if (!m.p2Name) {
        pHtml += `
          <div class="live-pairing-row bye-row">
            <span class="live-room">—</span>
            <span class="live-player">${m.p1Name}</span>
            <span class="live-vs">BYE</span>
            <span class="live-player" style="color:var(--warning)">轮空</span>
            <span class="live-result bye">自动胜</span>
          </div>`;
      } else {
        const room = roomNum++;
        pHtml += `
          <div class="live-pairing-row ${m.result ? 'has-result' : ''}">
            <span class="live-room">${room}</span>
            <span class="live-player ${m.result === 'p1' ? 'player-win' : ''}">${m.p1Name}</span>
            <span class="live-vs">VS</span>
            <span class="live-player ${m.result === 'p2' ? 'player-win' : ''}">${m.p2Name}</span>
            ${resultBadge(m.result, m.p1Name, m.p2Name)}
          </div>`;
      }
    });
    pairingsEl.innerHTML = pHtml || '<p style="color:var(--text-muted);text-align:center;padding:24px;">暂无配对数据</p>';

    // Standings
    const standings = data.standings || [];
    standingsEl.innerHTML = standings.map((p, i) => {
      let rank = i + 1;
      for (let j = i - 1; j >= 0; j--) {
        const prev = standings[j];
        if (prev.points === p.points && prev.buchholz === p.buchholz) rank = j + 1;
        else break;
      }
      const cls = rank <= 3 ? `live-rank-${rank}` : '';
      return `<tr class="${cls}">
        <td>${rank}</td><td>${p.name}</td><td>${p.wins}</td>
        <td>${p.draws}</td><td>${p.losses}</td><td>${p.points}</td><td>${p.buchholz}</td>
      </tr>`;
    }).join('');
  }

  // ── HTTP fallback (polling) ────────────────────────────────────────────────
  async function fetchAndRender() {
    try {
      const res = await fetch(`${apiBase()}/live`);
      if (!res.ok) throw new Error(res.statusText);
      render(await res.json());
      setStatus('fallback');
    } catch (e) {
      setStatus('offline');
    }
  }

  function startFallback() {
    if (usingFallback) return;
    usingFallback = true;
    fetchAndRender();
    fallbackTimer = setInterval(fetchAndRender, FALLBACK_INTERVAL);
  }

  function stopFallback() {
    usingFallback = false;
    clearInterval(fallbackTimer);
    fallbackTimer = null;
  }

  // ── WebSocket ──────────────────────────────────────────────────────────────
  function connect() {
    const url = wsUrl();
    if (!url) {
      // No WS endpoint configured — use fallback
      startFallback();
      return;
    }

    setStatus('connecting');
    ws = new WebSocket(url);

    ws.onopen = () => {
      setStatus('live');
      stopFallback();
      clearTimeout(reconnectTimer);
      // Fetch current state immediately — don't rely solely on $connect push
      fetchAndRender();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Ignore checkin messages — only handle live tournament data
        if (data.type === 'checkin' || data.id === '__checkin__') return;
        render(data);
        if (data.updatedAt) {
          liveMeta.textContent = `最后更新：${new Date(data.updatedAt).toLocaleTimeString('zh-CN')}`;
        }
      } catch (_) {}
    };

    ws.onerror = () => {
      setStatus('offline');
    };

    ws.onclose = () => {
      setStatus('offline');
      ws = null;
      // Start fallback polling while reconnecting
      startFallback();
      reconnectTimer = setTimeout(() => {
        stopFallback();
        connect();
      }, RECONNECT_DELAY);
    };
  }

  // Kick off
  connect();

  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    clearTimeout(reconnectTimer);
    clearInterval(fallbackTimer);
    if (ws) ws.close();
  });
})();
