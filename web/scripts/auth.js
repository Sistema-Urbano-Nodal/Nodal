(() => {
  'use strict';

  function safeReturnPath(value) {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/dashboard.html';
    if (value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return '/dashboard.html';
    try {
      const parsed = new URL(value, location.origin);
      if (parsed.origin !== location.origin) return '/dashboard.html';
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return '/dashboard.html';
    }
  }

  const params = new URLSearchParams(location.search);
  const next = params.get('next') || '/courses.html';
  const safeNext = safeReturnPath(next);

  const $ = (id) => document.getElementById(id);
  const setError = (node, message) => {
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
  };
  const clearError = (node) => {
    if (!node) return;
    node.textContent = '';
    node.hidden = true;
  };

  async function post(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  const loginForm = $('loginForm');
  const signupForm = $('signupForm');

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('loginError');
    clearError(error);
    const submit = loginForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await post('/api/auth/login', {
        email: $('loginEmail').value.trim(),
        password: $('loginPassword').value,
      });
      location.assign(safeNext);
    } catch (err) {
      setError(error, err.message);
      submit.disabled = false;
    }
  });

  signupForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('signupError');
    clearError(error);
    const submit = signupForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const data = await post('/api/auth/signup', {
        fullName: $('signupName').value.trim(),
        email: $('signupEmail').value.trim(),
        password: $('signupPassword').value,
      });
      if (data.requiresEmailConfirmation) {
        setError(error, window.nodalI18n
          ? window.nodalI18n.t('a.confirm')
          : 'Check your email to confirm your account. If you already confirmed it, sign in.');
        submit.disabled = false;
        return;
      }
      location.assign(safeNext);
    } catch (err) {
      setError(error, err.message);
      submit.disabled = false;
    }
  });
})();
