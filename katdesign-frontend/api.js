// KatDesign Holdings — Frontend API Client
// Include this in every HTML page:  <script src="api.js"></script>

const API_BASE = '/api';

const KDH = {

  // ── Auth ───────────────────────────────────────────────────────────────────
  async login(username, password) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed.');
    // Save token
    sessionStorage.setItem('kdh_token', data.token);
    sessionStorage.setItem('kdh_admin',  JSON.stringify(data.admin));
    return data;
  },

  logout() {
    sessionStorage.removeItem('kdh_token');
    sessionStorage.removeItem('kdh_admin');
    window.location.href = 'login.html';
  },

  getToken() {
    return sessionStorage.getItem('kdh_token');
  },

  getAdmin() {
    const a = sessionStorage.getItem('kdh_admin');
    return a ? JSON.parse(a) : null;
  },

  // ── Authenticated fetch helper ─────────────────────────────────────────────
  async authFetch(url, options = {}) {
    const token = this.getToken();
    if (!token) { window.location.href = 'login.html'; return; }
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(options.headers || {})
      }
    });
    if (res.status === 401) { this.logout(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed.');
    return data;
  },

  // ── Applications ───────────────────────────────────────────────────────────
  async submitApplication(formData) {
    const res = await fetch(`${API_BASE}/applications`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(formData)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Submission failed.');
    return data;
  },

  async getApplications(filters = {}) {
    const params = new URLSearchParams(filters).toString();
    return this.authFetch(`${API_BASE}/applications${params ? '?' + params : ''}`);
  },

  async getApplication(id) {
    return this.authFetch(`${API_BASE}/applications/${id}`);
  },

  async updateStatus(id, status, notes = '') {
    return this.authFetch(`${API_BASE}/applications/${id}/status`, {
      method: 'PATCH',
      body:   JSON.stringify({ status, notes })
    });
  },

  // ── Tracker ────────────────────────────────────────────────────────────────
  async trackLoan(omang) {
    const res  = await fetch(`${API_BASE}/tracker/${encodeURIComponent(omang)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lookup failed.');
    return data;
  },

  // ── Dashboard ──────────────────────────────────────────────────────────────
  async getDashboard() {
    return this.authFetch(`${API_BASE}/dashboard`);
  }
};
