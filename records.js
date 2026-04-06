// ===== Records Page Logic =====
const RecordsApp = (() => {
  function apiBase() {
    const cfg = (window.APP_CONFIG || {});
    // Strip trailing slash, append /records
    return (cfg.apiEndpoint || '').replace(/\/$/, '') + '/records';
  }

  async function authHeaders() {
    const token = await Auth.getToken();
    return token ? { Authorization: token } : {};
  }

  // ── API calls ──────────────────────────────────────────────────────────────
  async function loadRecords() {
    try {
      const res = await fetch(apiBase());
      if (!res.ok) throw new Error(res.statusText);
      return await res.json();
    } catch (e) {
      console.error('loadRecords failed', e);
      return [];
    }
  }

  async function saveRecord(record) {
    const headers = await authHeaders();
    const res = await fetch(apiBase(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(record)
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async function deleteRecord(id) {
    const headers = await authHeaders();
    const res = await fetch(`${apiBase()}/${id}`, {
      method: 'DELETE',
      headers
    });
    if (!res.ok) throw new Error(await res.text());
    await render();
  }

  async function updateEventName(id, name) {
    const headers = await authHeaders();
    const res = await fetch(`${apiBase()}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ eventName: name })
    });
    if (!res.ok) throw new Error(await res.text());
    await render();
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  function calcStats(records) {
    return {
      totalEvents: records.length,
      totalPlayers: records.reduce((s, r) => s + r.standings.length, 0),
      totalMatches: records.reduce((s, r) =>
        s + r.rounds.reduce((rs, round) => rs + round.filter(m => m.p2Name).length, 0), 0)
    };
  }

  // ── Render helpers ─────────────────────────────────────────────────────────
  function resultLabel(result, p1Name, p2Name) {
    if (result === 'p1') return `<span class="match-result result-win">${p1Name} 胜</span>`;
    if (result === 'p2') return `<span class="match-result result-win">${p2Name} 胜</span>`;
    if (result === 'draw') return `<span class="match-result result-draw">平局</span>`;
    return '';
  }

  function renderPodium(standings) {
    const medals = ['🥇', '🥈', '🥉'];

    // Assign true ranks accounting for ties (same points + buchholz = same rank)
    const ranked = standings.map((p, i) => {
      let rank = i + 1;
      for (let j = i - 1; j >= 0; j--) {
        const prev = standings[j];
        if (prev.points === p.points && prev.buchholz === p.buchholz) {
          rank = j + 1;
        } else break;
      }
      return { ...p, rank };
    });

    // Only show players ranked 1-3
    const podiumPlayers = ranked.filter(p => p.rank <= 3);
    // Display order: 2nd, 1st, 3rd (classic podium layout)
    const byRank = [2, 1, 3].map(r => podiumPlayers.filter(p => p.rank === r)).flat();

    let html = '<div class="podium">';
    byRank.forEach(p => {
      const medal = medals[p.rank - 1] || '';
      html += `
        <div class="podium-place place-${p.rank}">
          <div class="podium-avatar">${medal}</div>
          <div class="podium-name" title="${p.name}">${p.name}</div>
          <div class="podium-pts">${p.points}分</div>
          <div class="podium-block">${p.rank}</div>
        </div>`;
    });
    return html + '</div>';
  }

  function renderEventCard(rec, idx, total) {
    const date = new Date(rec.savedAt).toLocaleDateString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const matchCount = rec.rounds.reduce((s, r) => s + r.filter(m => m.p2Name).length, 0);

    // Compute tied ranks: same points AND same buchholz = same rank
    const standingRows = rec.standings.map((p, i) => {
      let rank = i + 1;
      // Walk back to find the first player with the same points & buchholz
      for (let j = i - 1; j >= 0; j--) {
        const prev = rec.standings[j];
        if (prev.points === p.points && prev.buchholz === p.buchholz) {
          rank = j + 1;
        } else {
          break;
        }
      }
      const rankDisplay = rank <= 3 ? `<span style="color:${['var(--accent)','#c0c0c0','#cd7f32'][rank-1]}">${rank}</span>` : rank;
      return `<tr class="${rank <= 3 ? 'r' + rank : ''}">
        <td>${rankDisplay}</td><td>${p.name}</td><td>${p.wins}</td>
        <td>${p.draws}</td><td>${p.losses}</td><td>${p.points}</td><td>${p.buchholz}</td>
      </tr>`;
    }).join('');

    const roundsHtml = rec.rounds.map((round, ri) => {
      const matchesHtml = round.map(m => {
        if (!m.p2Name) return `<div class="match-row">
          <span class="match-p">${m.p1Name}</span>
          <span class="match-vs">BYE</span>
          <span class="match-p" style="color:var(--warning)">轮空</span>
          <span class="match-result result-bye">自动胜</span>
        </div>`;
        return `<div class="match-row">
          <span class="match-p">${m.p1Name}</span>
          <span class="match-vs">VS</span>
          <span class="match-p">${m.p2Name}</span>
          ${resultLabel(m.result, m.p1Name, m.p2Name)}
        </div>`;
      }).join('');
      return `<div class="round-group"><div class="round-label">第 ${ri + 1} 轮</div>${matchesHtml}</div>`;
    }).join('');

    // Escape single quotes for inline onclick
    const safeName = rec.eventName.replace(/'/g, "\\'");

    return `
      <div class="event-card" id="event-${rec.id}">
        <div class="event-header" onclick="RecordsApp.toggle('${rec.id}')">
          <div class="event-meta">
            <div class="event-num">${String(total - idx).padStart(2, '0')}</div>
            <div class="event-info">
              <div class="event-title">${rec.eventName}</div>
              <div class="event-date">${date}</div>
            </div>
          </div>
          <div class="event-badges">
            <span class="badge badge-players">👥 ${rec.standings.length} 人</span>
            <span class="badge badge-rounds">🔄 ${rec.rounds.length} 轮</span>
            <span class="badge badge-matches">⚔️ ${matchCount} 局</span>
          </div>
          <span class="event-toggle">▼</span>
        </div>
        <div class="event-body">
          <div class="event-body-inner">
            ${renderPodium(rec.standings)}
            <table class="event-standings">
              <thead><tr><th>排名</th><th>选手</th><th>胜</th><th>平</th><th>负</th><th>积分</th><th>布赫兹分</th></tr></thead>
              <tbody>${standingRows}</tbody>
            </table>
            <div class="rounds-section"><h4>对局详情</h4>${roundsHtml}</div>
            <div class="event-actions admin-only">
              <button class="btn btn-ghost btn-sm" onclick="RecordsApp.editName('${rec.id}', '${safeName}')">✏️ 修改名称</button>
              <button class="btn btn-danger btn-sm" onclick="RecordsApp.confirmDelete('${rec.id}')">🗑️ 删除记录</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  async function render(filter = '') {
    const list = document.getElementById('recordsList');
    const empty = document.getElementById('emptyState');
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">加载中...</div>';

    let records = await loadRecords();
    const stats = calcStats(records);

    document.getElementById('totalEvents').textContent = stats.totalEvents;
    document.getElementById('totalPlayers').textContent = stats.totalPlayers;
    document.getElementById('totalMatches').textContent = stats.totalMatches;

    if (filter) {
      const q = filter.toLowerCase();
      records = records.filter(r =>
        r.eventName.toLowerCase().includes(q) ||
        r.standings.some(p => p.name.toLowerCase().includes(q))
      );
    }

    if (records.length === 0) {
      list.innerHTML = '';
      empty.style.display = 'block';
    } else {
      empty.style.display = 'none';
      list.innerHTML = records.map((r, i) => renderEventCard(r, i, records.length)).join('');
    }

    // Hide admin-only elements if not authenticated
    const isAdmin = Auth.isAuthenticated();
    document.querySelectorAll('.admin-only').forEach(el => {
      el.style.display = isAdmin ? '' : 'none';
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    async init() {
      await render();
      document.getElementById('searchInput').addEventListener('input', e => render(e.target.value));
      document.getElementById('clearAllRecordsBtn').addEventListener('click', async () => {
        if (!confirm('确定要清空所有成绩记录吗？此操作不可撤销。')) return;
        const records = await loadRecords();
        const headers = await authHeaders();
        await Promise.all(records.map(r =>
          fetch(`${apiBase()}/${r.id}`, { method: 'DELETE', headers })
        ));
        await render();
      });
    },

    toggle(id) {
      const card = document.getElementById(`event-${id}`);
      if (card) card.classList.toggle('expanded');
    },

    editName(id, currentName) {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal">
          <h3>修改活动名称</h3>
          <div class="input-group">
            <label>活动名称</label>
            <input type="text" id="editNameInput" value="${currentName}" style="width:100%">
          </div>
          <div class="modal-actions">
            <button class="btn btn-ghost btn-sm" id="cancelEdit">取消</button>
            <button class="btn btn-primary btn-sm" id="confirmEdit">保存</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const input = overlay.querySelector('#editNameInput');
      input.focus(); input.select();
      overlay.querySelector('#cancelEdit').onclick = () => overlay.remove();
      overlay.querySelector('#confirmEdit').onclick = async () => {
        const val = input.value.trim();
        if (val) { await updateEventName(id, val); }
        overlay.remove();
      };
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    },

    async confirmDelete(id) {
      if (confirm('确定要删除这条成绩记录吗？')) await deleteRecord(id);
    },

    // Called by app.js to save a record after tournament ends
    saveRecord
  };
})();

RecordsApp.init();
