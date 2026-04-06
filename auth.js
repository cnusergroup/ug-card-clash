/**
 * auth.js — Cognito 认证模块
 * 依赖 amazon-cognito-identity-js (通过 CDN 加载)
 * 配置项由 CDK 部署后注入 window.APP_CONFIG
 */

const Auth = (() => {
  // CDK 部署后会在 config.js 里注入这些值
  function getConfig() {
    return window.APP_CONFIG || {
      userPoolId: '',
      userPoolClientId: '',
      apiEndpoint: '',
      region: 'ap-northeast-1'
    };
  }

  let _idToken = null;
  let _userPool = null;
  let _currentUser = null;

  function getUserPool() {
    if (_userPool) return _userPool;
    const cfg = getConfig();
    if (!cfg.userPoolId || !cfg.userPoolClientId) return null;
    _userPool = new AmazonCognitoIdentity.CognitoUserPool({
      UserPoolId: cfg.userPoolId,
      ClientId: cfg.userPoolClientId
    });
    return _userPool;
  }

  // 从 session storage 恢复 token
  function restoreSession() {
    const pool = getUserPool();
    if (!pool) return Promise.resolve(null);
    return new Promise(resolve => {
      const user = pool.getCurrentUser();
      if (!user) return resolve(null);
      user.getSession((err, session) => {
        if (err || !session.isValid()) return resolve(null);
        _idToken = session.getIdToken().getJwtToken();
        _currentUser = user;
        resolve(_idToken);
      });
    });
  }

  // 登录
  function signIn(username, password) {
    const pool = getUserPool();
    if (!pool) return Promise.reject(new Error('Auth not configured'));
    return new Promise((resolve, reject) => {
      const user = new AmazonCognitoIdentity.CognitoUser({ Username: username, Pool: pool });
      const authDetails = new AmazonCognitoIdentity.AuthenticationDetails({
        Username: username, Password: password
      });
      user.authenticateUser(authDetails, {
        onSuccess(session) {
          _idToken = session.getIdToken().getJwtToken();
          _currentUser = user;
          resolve(_idToken);
        },
        onFailure(err) { reject(err); },
        newPasswordRequired(userAttributes) {
          // 首次登录需要改密码
          reject({ code: 'NewPasswordRequired', user, userAttributes });
        }
      });
    });
  }

  // 首次登录强制改密码
  function completeNewPassword(cognitoUser, newPassword) {
    return new Promise((resolve, reject) => {
      cognitoUser.completeNewPasswordChallenge(newPassword, {}, {
        onSuccess(session) {
          _idToken = session.getIdToken().getJwtToken();
          _currentUser = cognitoUser;
          resolve(_idToken);
        },
        onFailure(err) { reject(err); }
      });
    });
  }

  // 登出
  function signOut() {
    if (_currentUser) _currentUser.signOut();
    _idToken = null;
    _currentUser = null;
    updateUI(false);
  }

  // 获取当前 token（自动刷新）
  async function getToken() {
    if (_idToken) return _idToken;
    return restoreSession();
  }

  // 是否已登录
  function isAuthenticated() {
    return !!_idToken;
  }

  // 更新页面 UI（显示/隐藏管理员功能）
  function updateUI(isAdmin) {
    const adminOnlyEls = document.querySelectorAll('.admin-only');
    const authBtn = document.getElementById('authBtn');
    const authStatus = document.getElementById('authStatus');

    adminOnlyEls.forEach(el => {
      if (isAdmin) {
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    });

    if (authBtn) {
      authBtn.textContent = isAdmin ? '退出登录' : '管理员登录';
    }
    if (authStatus) {
      authStatus.textContent = isAdmin ? '✓ 管理员模式' : '';
      authStatus.style.color = 'var(--success)';
    }
  }

  // 显示登录弹窗
  function showLoginModal() {
    const existing = document.getElementById('loginModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'loginModal';
    overlay.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border-accent);border-radius:12px;padding:32px;max-width:400px;width:100%;box-shadow:0 24px 80px rgba(0,0,0,.6);">
        <h3 style="font-size:18px;font-weight:700;margin-bottom:6px;font-family:var(--font-body);">管理员登录</h3>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:24px;">登录后可使用赛程工具和管理成绩记录</p>
        <div id="loginError" style="display:none;padding:10px 14px;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);border-radius:8px;color:#f87171;font-size:13px;margin-bottom:16px;"></div>
        <div id="newPwdSection" style="display:none;">
          <p style="font-size:13px;color:var(--warning);margin-bottom:12px;">首次登录，请设置新密码</p>
          <input type="password" id="newPwdInput" placeholder="新密码（至少8位）" style="width:100%;padding:10px 14px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-family:var(--font-body);font-size:14px;outline:none;box-sizing:border-box;margin-bottom:12px;">
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-size:13px;color:var(--text-secondary);margin-bottom:6px;">用户名</label>
          <input type="text" id="loginUser" placeholder="输入用户名" style="width:100%;padding:10px 14px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-family:var(--font-body);font-size:14px;outline:none;box-sizing:border-box;">
        </div>
        <div style="margin-bottom:24px;">
          <label style="display:block;font-size:13px;color:var(--text-secondary);margin-bottom:6px;">密码</label>
          <input type="password" id="loginPwd" placeholder="输入密码" style="width:100%;padding:10px 14px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-family:var(--font-body);font-size:14px;outline:none;box-sizing:border-box;">
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button id="cancelLogin" style="padding:10px 20px;background:transparent;border:1px solid var(--border-accent);border-radius:8px;color:var(--text-primary);cursor:pointer;font-family:var(--font-body);font-size:14px;">取消</button>
          <button id="confirmLogin" style="padding:10px 20px;background:linear-gradient(135deg,var(--accent),var(--accent-dim));border:none;border-radius:8px;color:#000;font-weight:700;cursor:pointer;font-family:var(--font-body);font-size:14px;">登录</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    let pendingCognitoUser = null;

    const showError = msg => {
      const el = overlay.querySelector('#loginError');
      el.textContent = msg;
      el.style.display = 'block';
    };

    overlay.querySelector('#cancelLogin').onclick = () => overlay.remove();
    overlay.querySelector('#confirmLogin').onclick = async () => {
      const btn = overlay.querySelector('#confirmLogin');
      btn.textContent = '登录中...';
      btn.disabled = true;

      try {
        if (pendingCognitoUser) {
          // 处理新密码
          const newPwd = overlay.querySelector('#newPwdInput').value;
          await completeNewPassword(pendingCognitoUser, newPwd);
        } else {
          const user = overlay.querySelector('#loginUser').value.trim();
          const pwd = overlay.querySelector('#loginPwd').value;
          await signIn(user, pwd);
        }
        overlay.remove();
        updateUI(true);
      } catch (err) {
        if (err.code === 'NewPasswordRequired') {
          pendingCognitoUser = err.user;
          overlay.querySelector('#newPwdSection').style.display = 'block';
          overlay.querySelector('#loginUser').closest('div').style.display = 'none';
          overlay.querySelector('#loginPwd').closest('div').style.display = 'none';
          showError('请设置新密码后继续');
        } else {
          showError(err.message || '登录失败，请检查用户名和密码');
        }
        btn.textContent = '登录';
        btn.disabled = false;
      }
    };

    // Enter 键提交
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Enter') overlay.querySelector('#confirmLogin').click();
    });

    overlay.querySelector('#loginUser').focus();
  }

  // 初始化：恢复 session，注入登录按钮
  async function init() {
    injectAuthButton();
    const token = await restoreSession();
    updateUI(!!token);
  }

  function injectAuthButton() {
    const navLinks = document.querySelector('.nav-links');
    if (!navLinks) return;

    const authWrap = document.createElement('div');
    authWrap.style.cssText = 'display:flex;align-items:center;gap:12px;';
    authWrap.innerHTML = `
      <span id="authStatus" style="font-size:12px;font-family:var(--font-mono);"></span>
      <button id="authBtn" style="padding:6px 16px;background:rgba(255,153,0,.1);border:1px solid var(--border-accent);border-radius:6px;color:var(--accent);cursor:pointer;font-family:var(--font-body);font-size:13px;font-weight:600;">管理员登录</button>`;
    navLinks.appendChild(authWrap);

    document.getElementById('authBtn').addEventListener('click', () => {
      if (isAuthenticated()) {
        if (confirm('确定要退出登录吗？')) signOut();
      } else {
        showLoginModal();
      }
    });
  }

  return { init, getToken, isAuthenticated, signOut, getConfig };
})();
