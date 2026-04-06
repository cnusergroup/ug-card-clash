// ===== Checkin Page — WebSocket with HTTP fallback =====
(function CheckinPage() {
  const RECONNECT_DELAY = 3000;
  const FALLBACK_INTERVAL = 5000;

  // DOM elements
  const eventNameEl     = document.getElementById('eventName');
  const formArea        = document.getElementById('checkinFormArea');
  const form            = document.getElementById('checkinForm');
  const nicknameInput   = document.getElementById('nicknameInput');
  const submitBtn       = document.getElementById('checkinSubmitBtn');
  const errorEl         = document.getElementById('checkinError');
  const successEl       = document.getElementById('checkinSuccess');
  const listArea        = document.getElementById('checkinListArea');
  const countEl         = document.getElementById('checkinCount');
  const listEl          = document.getElementById('checkinList');
  const closedEl        = document.getElementById('checkinClosed');
  const invalidEl       = document.getElementById('checkinInvalid');

  let ws = null;
  let fallbackTimer = null;
  let reconnectTimer = null;
  let usingFallback = false;
  let checkedIn = false; // whether current user has successfully checked in

  // Get session param from URL
  const urlParams = new URLSearchParams(window.location.search);
  const session = urlParams.get('session') || '';

  function apiBase() {
    return ((window.APP_CONFIG || {}).apiEndpoint || '').replace(/\/$/, '');
  }

  function wsUrl() {
    return (window.APP_CONFIG || {}).wsEndpoint || null;
  }

  // ── HTML escape to prevent XSS ─────────────────────────────────────────
  function escapeHtml(str) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(str).replace(/[&<>"']/g, c => map[c]);
  }

  // ── Show/hide helpers ──────────────────────────────────────────────────
  function showInvalid() {
    formArea.style.display = 'none';
    successEl.style.display = 'none';
    listArea.style.display = 'none';
    closedEl.style.display = 'none';
    invalidEl.style.display = 'block';
    eventNameEl.textContent = '签到链接无效';
  }

  function showClosed() {
    formArea.style.display = 'none';
    closedEl.style.display = 'block';
    invalidEl.style.display = 'none';
  }

  function showForm() {
    if (!checkedIn) {
      formArea.style.display = 'block';
    }
    closedEl.style.display = 'none';
    invalidEl.style.display = 'none';
  }

  function showSuccess() {
    checkedIn = true;
    formArea.style.display = 'none';
    successEl.style.display = 'block';
    errorEl.textContent = '';
  }

  // ── Render checkin state ───────────────────────────────────────────────
  function render(data) {
    if (!data) return;

    // Validate session matches server sessionId
    if (data.sessionId && data.sessionId !== session) {
      showInvalid();
      return;
    }

    // Update event name
    if (data.eventName) {
      eventNameEl.textContent = escapeHtml(data.eventName);
    }

    // Show/hide based on active state
    if (data.active === false) {
      showClosed();
    } else {
      showForm();
    }

    // Render player list
    const players = data.players || [];
    listArea.style.display = players.length > 0 || checkedIn ? 'block' : 'none';
    countEl.textContent = players.length;
    listEl.innerHTML = players.map(p =>
      `<li class="checkin-list-item"><span class="checkin-nickname">${escapeHtml(p.nickname)}</span></li>`
    ).join('');
  }

  // ── Submit checkin ─────────────────────────────────────────────────────
  async function submitCheckin(nickname) {
    errorEl.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = '签到中...';

    try {
      const res = await fetch(`${apiBase()}/checkin?session=${encodeURIComponent(session)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname })
      });

      if (res.status === 201) {
        showSuccess();
        // Fetch latest state to render list
        await fetchState();
        return;
      }

      const body = await res.json().catch(() => ({}));
      const msg = body.error || '签到失败';

      if (res.status === 400) {
        errorEl.textContent = msg;
      } else if (res.status === 403) {
        errorEl.textContent = msg;
      } else if (res.status === 409) {
        errorEl.textContent = msg;
      } else {
        errorEl.textContent = '网络连接失败，请重试';
      }
    } catch (e) {
      errorEl.textContent = '网络连接失败，请重试';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '我要参赛';
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const nickname = nicknameInput.value;
    submitCheckin(nickname);
  });

  // ── HTTP fallback (polling) ────────────────────────────────────────────
  async function fetchState() {
    try {
      const res = await fetch(`${apiBase()}/checkin`);
      if (!res.ok) throw new Error(res.statusText);
      render(await res.json());
    } catch (e) {
      // silently fail on poll errors
    }
  }

  function startFallback() {
    if (usingFallback) return;
    usingFallback = true;
    fetchState();
    fallbackTimer = setInterval(fetchState, FALLBACK_INTERVAL);
  }

  function stopFallback() {
    usingFallback = false;
    clearInterval(fallbackTimer);
    fallbackTimer = null;
  }

  // ── WebSocket ──────────────────────────────────────────────────────────
  function connect() {
    const url = wsUrl();
    if (!url) {
      startFallback();
      return;
    }

    ws = new WebSocket(url);

    ws.onopen = () => {
      stopFallback();
      clearTimeout(reconnectTimer);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Accept messages with type "checkin" or id "__checkin__"
        if (data.type === 'checkin' || data.id === '__checkin__') {
          render(data);
        }
      } catch (_) {}
    };

    ws.onerror = () => {};

    ws.onclose = () => {
      ws = null;
      startFallback();
      reconnectTimer = setTimeout(() => {
        stopFallback();
        connect();
      }, RECONNECT_DELAY);
    };
  }

  // ── Init ───────────────────────────────────────────────────────────────
  async function init() {
    if (!session) {
      showInvalid();
      return;
    }

    try {
      const res = await fetch(`${apiBase()}/checkin`);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();

      // Validate session matches
      if (data.sessionId && data.sessionId !== session) {
        showInvalid();
        return;
      }

      // If no active session exists at all
      if (!data.sessionId && data.active === false) {
        showInvalid();
        return;
      }

      render(data);
    } catch (e) {
      eventNameEl.textContent = '加载失败，请刷新重试';
    }

    // Start WebSocket for real-time updates
    connect();
  }

  init();

  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    clearTimeout(reconnectTimer);
    clearInterval(fallbackTimer);
    if (ws) ws.close();
  });

  // Export escapeHtml for testing
  if (typeof window !== 'undefined') {
    window.CheckinPage = { escapeHtml };
  }
})();
