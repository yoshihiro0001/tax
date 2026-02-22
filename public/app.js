/* ============================================
   Keihi v2 — App
   ============================================ */
// ベースパス自動検出（/tax 配下なら /tax、ローカルなら空文字）
const BASE = location.pathname.replace(/\/+$/, '').startsWith('/tax') ? '/tax' : '';

const App = {
  user: null,
  books: [],
  currentBook: null,
  currentView: 'home',
  receiptFile: null,
  receiptDataUrl: null,
  reportChart: null,
  editingItem: null,

  // ===== 階層型支出カテゴリ =====
  expenseGroups: [
    { id: 'business', label: '事業経費', icon: '💼', items: [
      { id: 'cogs', name: '仕入・原価', icon: '📦', desc: '商品・材料の仕入れ' },
      { id: 'labor', name: '外注・人件費', icon: '🤝', desc: '外注・業務委託・給与' },
      { id: 'rent', name: '事務所・家賃', icon: '🏠', desc: '家賃・光熱費・通信費' },
      { id: 'general', name: '一般経費', icon: '📋', desc: '交通・広告・消耗品等' },
      { id: 'entertainment', name: '接待交際費', icon: '🍽', desc: '取引先との飲食' },
    ]},
    { id: 'deduction', label: '控除につながる支出', icon: '🛡', items: [
      { id: 'insurance', name: '社会保険・年金', icon: '🛡', desc: '全額が所得控除' },
      { id: 'life_insurance', name: '生命保険', icon: '💚', desc: '生命保険料控除' },
      { id: 'earthquake_insurance', name: '地震保険', icon: '🏔', desc: '地震保険料控除' },
      { id: 'medical', name: '医療費', icon: '🏥', desc: '10万円超で医療費控除' },
      { id: 'donation', name: '寄附金', icon: '🎁', desc: 'ふるさと納税等' },
    ]},
    { id: 'tax', label: '税金', icon: '🏛', items: [
      { id: 'tax_deductible', name: '租税公課', icon: '🏛', desc: '事業税・固定資産税等' },
      { id: 'tax_non_deductible', name: '所得税・住民税', icon: '📋', desc: '経費にならない税金' },
    ]},
    { id: 'asset_grp', label: '固定資産', icon: '💻', items: [
      { id: 'asset', name: '設備・備品', icon: '💻', desc: '10万円超で減価償却' },
    ]},
  ],
  // 全カテゴリをフラット化
  get categories() {
    const flat = [];
    for (const g of this.expenseGroups) for (const item of g.items) flat.push(item);
    return flat;
  },
  isTaxProfit(cat) { return cat === 'tax_non_deductible'; },
  categoryName(id) { const c = this.categories.find(c => c.id === id); return c ? c.name : id; },
  categoryIcon(id) { const c = this.categories.find(c => c.id === id); return c ? c.icon : '📌'; },

  // ===== 階層型収入タイプ =====
  incomeGroups: [
    { id: 'main', label: 'よく使う', icon: '⭐', items: [
      { id: 'business', name: '売上（営業）', icon: '💼', desc: '事業の売上' },
      { id: 'salary', name: '給与', icon: '🏢', desc: '給与・賞与' },
      { id: 'real_estate', name: '不動産', icon: '🏠', desc: '家賃収入等' },
    ]},
    { id: 'financial', label: '金融・投資', icon: '📈', items: [
      { id: 'dividend', name: '配当', icon: '📊', desc: '株式配当金' },
      { id: 'stock_transfer', name: '株式売却', icon: '📈', desc: '株式等の譲渡' },
      { id: 'fx_stock', name: 'FX・先物', icon: '💱', desc: 'FX・先物取引' },
      { id: 'interest', name: '利子', icon: '🏦', desc: '預貯金の利子' },
    ]},
    { id: 'pension_other', label: '年金・一時・その他', icon: '📋', items: [
      { id: 'pension', name: '公的年金', icon: '👴', desc: '公的年金等' },
      { id: 'temporary', name: '一時所得', icon: '🎯', desc: '保険満期金等' },
      { id: 'subsidy', name: '助成金・補助金', icon: '🏛', desc: '国・自治体の助成金' },
      { id: 'refund', name: '還付金', icon: '💰', desc: '税金の還付等' },
      { id: 'misc_other', name: 'その他', icon: '📌', desc: 'その他の所得' },
    ]},
    { id: 'special', label: '特殊な所得', icon: '📑', collapsed: true, items: [
      { id: 'agriculture', name: '農業', icon: '🌾', desc: '農業所得' },
      { id: 'capital_short', name: '譲渡（短期）', icon: '⏱', desc: '5年以内の資産譲渡' },
      { id: 'capital_long', name: '譲渡（長期）', icon: '📅', desc: '5年超の資産譲渡' },
      { id: 'misc_business', name: '雑所得（業務）', icon: '💻', desc: '副業収入等' },
      { id: 'forest', name: '山林所得', icon: '🌲', desc: '山林の譲渡・伐採' },
      { id: 'retirement', name: '退職所得', icon: '🎓', desc: '退職金等' },
    ]},
  ],
  get incomeTypes() {
    const map = {};
    for (const g of this.incomeGroups) for (const item of g.items) map[item.id] = item;
    return map;
  },
  incomeTypeName(id) { return (this.incomeTypes[id] || { name: id }).name; },
  incomeTypeIcon(id) { return (this.incomeTypes[id] || { icon: '📌' }).icon; },

  profile: null,

  // ========================================
  // 初期化
  // ========================================
  async init() {
    try {
      const res = await this.api('/api/auth/me');
      this.user = res.user;
      this.books = res.books;
      this.profile = res.profile || null;
      this.currentBook = this.books[0] || null;
      this.showApp();
      if (!this.profile?.onboarding_done) this.startOnboarding();
    } catch {
      this.showAuth();
    }
    this.setupAuth();
    this.setupNav();
    this.setupHome();
    this.setupReport();
    this.setupSettings();
    this.setupModals();
    this.setupCSV();
    this.setupHistory();
    this.setupFoldToggles();
    this.initGoogleSignIn();
  },

  // ========================================
  // API helper
  // ========================================
  async api(url, opts = {}) {
    const fullUrl = (url.startsWith('/api') ? BASE : '') + url;
    const res = await fetch(fullUrl, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'エラーが発生しました');
    return data;
  },

  // ========================================
  // トースト
  // ========================================
  toast(msg, type = '') {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2500);
  },

  // ========================================
  // 折りたたみトグル
  // ========================================
  setupFoldToggles() {
    document.querySelectorAll('.card-fold-head').forEach(head => {
      head.addEventListener('click', () => {
        const body = head.nextElementSibling;
        if (!body) return;
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : '';
        const toggle = head.querySelector('.fold-toggle');
        if (toggle) toggle.textContent = isOpen ? '›' : '⌄';
      });
    });
  },

  // ========================================
  // 階層カテゴリ描画
  // ========================================
  renderHierarchicalCategories(containerId, groups, selectedId, onSelect) {
    const wrap = typeof containerId === 'string' ? qs(`#${containerId}`) : containerId;
    if (!wrap) return;
    wrap.innerHTML = groups.map(g => {
      const isCollapsed = g.collapsed;
      return `<div class="hcat-group${isCollapsed ? ' hcat-collapsed' : ''}">
        <div class="hcat-group-head" data-gid="${g.id}">
          <span class="hcat-group-icon">${g.icon}</span>
          <span class="hcat-group-label">${g.label}</span>
          <span class="hcat-group-arrow">${isCollapsed ? '＋' : ''}</span>
        </div>
        <div class="hcat-items"${isCollapsed ? ' style="display:none"' : ''}>
          ${g.items.map(item => `<div class="hcat-item${item.id === selectedId ? ' selected' : ''}" data-id="${item.id}">
            <span class="hcat-item-icon">${item.icon}</span>
            <span class="hcat-item-name">${item.name}</span>
          </div>`).join('')}
        </div>
      </div>`;
    }).join('');
    wrap.querySelectorAll('.hcat-group-head').forEach(h => {
      h.addEventListener('click', () => {
        const items = h.nextElementSibling;
        const arrow = h.querySelector('.hcat-group-arrow');
        if (!items) return;
        const open = items.style.display !== 'none';
        items.style.display = open ? 'none' : '';
        if (arrow) arrow.textContent = open ? '＋' : '';
      });
    });
    wrap.querySelectorAll('.hcat-item').forEach(el => {
      el.addEventListener('click', () => {
        wrap.querySelectorAll('.hcat-item').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
        if (onSelect) onSelect(el.dataset.id);
      });
    });
  },

  // ========================================
  // オンボーディング
  // ========================================
  obStep: 0,
  obData: {},
  startOnboarding() {
    this.obStep = 0;
    this.obData = { full_name: this.user?.name || '' };
    this.openOverlay('onboarding');
    this.renderOnboardingStep();
  },
  renderOnboardingStep() {
    const steps = [
      { title: 'お名前', field: 'full_name', type: 'text', placeholder: '例: 橋本 太郎', value: this.obData.full_name || '' },
      { title: '生年月日', field: 'birth_date', type: 'date', value: this.obData.birth_date || '' },
      { title: '確定申告の種類', field: 'filing_type', type: 'select', options: [
        { value: 'white', label: '白色申告' },
        { value: 'blue', label: '青色申告' },
      ], value: this.obData.filing_type || 'white' },
      { title: '主な収入源', field: 'main_income', type: 'chips', options: [
        { value: 'business', label: '💼 事業', selected: true },
        { value: 'salary', label: '🏢 給与' },
        { value: 'real_estate', label: '🏠 不動産' },
        { value: 'financial', label: '📈 金融・投資' },
        { value: 'pension', label: '👴 年金' },
      ]},
    ];
    const total = steps.length;
    const step = steps[this.obStep] || steps[total - 1];
    const pct = Math.round(((this.obStep + 1) / total) * 100);
    qs('#ob-progress-fill').style.width = pct + '%';
    const content = qs('#ob-content');
    let html = `<h2 class="ob-title">${step.title}</h2>`;
    if (step.type === 'text') {
      html += `<input type="text" class="fi ob-input" id="ob-field" value="${this.esc(step.value)}" placeholder="${step.placeholder || ''}">`;
    } else if (step.type === 'date') {
      html += `<input type="date" class="fi ob-input" id="ob-field" value="${step.value}">`;
    } else if (step.type === 'select') {
      html += `<div class="ob-options">${step.options.map(o => `<button class="ob-option${o.value === step.value ? ' selected' : ''}" data-val="${o.value}">${o.label}</button>`).join('')}</div>`;
    } else if (step.type === 'chips') {
      html += `<div class="ob-chips">${step.options.map(o => `<button class="ob-chip${o.selected ? ' selected' : ''}" data-val="${o.value}">${o.label}</button>`).join('')}</div>`;
    }
    content.innerHTML = html;
    if (step.type === 'select') {
      content.querySelectorAll('.ob-option').forEach(btn => {
        btn.addEventListener('click', () => {
          content.querySelectorAll('.ob-option').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          this.obData[step.field] = btn.dataset.val;
        });
      });
    }
    if (step.type === 'chips') {
      content.querySelectorAll('.ob-chip').forEach(btn => {
        btn.addEventListener('click', () => btn.classList.toggle('selected'));
      });
    }
    qs('#ob-next').textContent = this.obStep >= total - 1 ? '完了' : '次へ';
    qs('#ob-next').onclick = () => this.nextOnboardingStep(step);
    qs('#ob-skip').onclick = () => this.finishOnboarding();
  },
  nextOnboardingStep(step) {
    if (step.type === 'text' || step.type === 'date') {
      const val = qs('#ob-field')?.value || '';
      this.obData[step.field] = val;
    }
    const totalSteps = 4;
    if (this.obStep >= totalSteps - 1) {
      this.finishOnboarding();
    } else {
      this.obStep++;
      this.renderOnboardingStep();
    }
  },
  async finishOnboarding() {
    this.closeOverlay('onboarding');
    try {
      const body = { ...this.obData, onboarding_done: 1 };
      const res = await this.api('/api/profile', { method: 'PUT', body: JSON.stringify(body) });
      this.profile = res.profile;
      this.toast('基礎情報を保存しました', 'success');
    } catch { /* ignore */ }
  },

  // ========================================
  // プロフィールフォーム（設定内）
  // ========================================
  renderProfileForm() {
    const area = qs('#profile-form-area');
    if (!area) return;
    const p = this.profile || {};
    area.innerHTML = `
      <div class="pf-grid">
        <div class="fg"><label>氏名</label><input type="text" class="fi" id="pf-name" value="${this.esc(p.full_name || '')}"></div>
        <div class="fg"><label>氏名（カナ）</label><input type="text" class="fi" id="pf-kana" value="${this.esc(p.full_name_kana || '')}"></div>
        <div class="fg"><label>生年月日</label><input type="date" class="fi" id="pf-birth" value="${p.birth_date || ''}"></div>
        <div class="fg"><label>住所</label><input type="text" class="fi" id="pf-address" value="${this.esc(p.address || '')}"></div>
        <div class="fg"><label>電話番号</label><input type="tel" class="fi" id="pf-phone" value="${this.esc(p.phone || '')}"></div>
        <div class="fg"><label>職業</label><input type="text" class="fi" id="pf-occupation" value="${this.esc(p.occupation || '')}"></div>
        <div class="fg"><label>確定申告</label>
          <select class="fi" id="pf-filing">${['white','blue'].map(v => `<option value="${v}"${p.filing_type === v ? ' selected' : ''}>${v === 'blue' ? '青色申告' : '白色申告'}</option>`).join('')}</select>
        </div>
        <div class="fg" id="pf-blue-group" style="${p.filing_type === 'blue' ? '' : 'display:none'}"><label>青色控除額</label>
          <select class="fi" id="pf-blue-type">${['10','55','65'].map(v => `<option value="${v}"${p.blue_return_type === v ? ' selected' : ''}>${v}万円</option>`).join('')}</select>
        </div>
        <div class="fg"><label>配偶者</label>
          <select class="fi" id="pf-spouse">${['none','dependent','working'].map(v => `<option value="${v}"${p.spouse_status === v ? ' selected' : ''}>${v === 'none' ? 'なし' : v === 'dependent' ? 'あり（扶養）' : 'あり（収入あり）'}</option>`).join('')}</select>
        </div>
        <div class="fg"><label>扶養親族（一般）</label><input type="number" class="fi" id="pf-dep-gen" value="${p.dependents_general || 0}" min="0"></div>
        <div class="fg"><label>扶養親族（特定）</label><input type="number" class="fi" id="pf-dep-spec" value="${p.dependents_specific || 0}" min="0"></div>
        <div class="fg"><label>40歳以上</label>
          <select class="fi" id="pf-over40"><option value="0"${!p.over40 ? ' selected' : ''}>いいえ</option><option value="1"${p.over40 ? ' selected' : ''}>はい</option></select>
        </div>
      </div>
      <button class="btn-save btn-full" id="btn-save-profile" style="margin-top:12px">保存</button>
    `;
    qs('#pf-filing').addEventListener('change', () => {
      qs('#pf-blue-group').style.display = qs('#pf-filing').value === 'blue' ? '' : 'none';
    });
    qs('#btn-save-profile').addEventListener('click', async () => {
      const body = {
        full_name: qs('#pf-name').value, full_name_kana: qs('#pf-kana').value,
        birth_date: qs('#pf-birth').value, address: qs('#pf-address').value,
        phone: qs('#pf-phone').value, occupation: qs('#pf-occupation').value,
        filing_type: qs('#pf-filing').value, blue_return_type: qs('#pf-blue-type')?.value || '10',
        spouse_status: qs('#pf-spouse').value,
        dependents_general: parseInt(qs('#pf-dep-gen').value) || 0,
        dependents_specific: parseInt(qs('#pf-dep-spec').value) || 0,
        over40: parseInt(qs('#pf-over40').value) || 0,
        onboarding_done: 1,
      };
      try {
        const res = await this.api('/api/profile', { method: 'PUT', body: JSON.stringify(body) });
        this.profile = res.profile;
        this.toast('保存しました', 'success');
      } catch (err) { this.toast(err.message, 'error'); }
    });
  },

  // ========================================
  // Google Sign-In
  // ========================================
  async initGoogleSignIn() {
    try {
      const cfg = await this.api('/api/config');
      if (!cfg.googleClientId) return; // Google未設定なら非表示のまま

      // GSIが読み込まれるまで待機
      const waitForGoogle = () => new Promise((resolve) => {
        if (window.google?.accounts?.id) return resolve();
        const check = setInterval(() => {
          if (window.google?.accounts?.id) { clearInterval(check); resolve(); }
        }, 100);
        setTimeout(() => { clearInterval(check); resolve(); }, 5000);
      });
      await waitForGoogle();
      if (!window.google?.accounts?.id) return;

      google.accounts.id.initialize({
        client_id: cfg.googleClientId,
        callback: (response) => this.handleGoogleCallback(response),
        auto_select: false,
        context: 'signin'
      });

      const btnWrap = qs('#google-signin-btn');
      google.accounts.id.renderButton(btnWrap, {
        type: 'standard', theme: 'outline', size: 'large',
        text: 'signin_with', shape: 'pill', width: 280, locale: 'ja'
      });
      qs('#google-signin-wrap').style.display = '';
    } catch { /* Google未設定 */ }
  },

  async handleGoogleCallback(response) {
    try {
      const res = await this.api('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential: response.credential })
      });
      this.user = res.user;
      const me = await this.api('/api/auth/me');
      this.user = me.user;
      this.books = me.books;
      this.currentBook = this.books[0];
      this.showApp();
      this.toast('ログインしました', 'success');
    } catch (err) { this.toast(err.message, 'error'); }
  },

  // ========================================
  // 認証
  // ========================================
  showAuth() {
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('app-screen').style.display = 'none';
  },
  showApp() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = '';
    this.updateTopbar();
    this.loadDashboard();
  },

  setupAuth() {
    const loginForm = document.getElementById('form-login');
    const regForm = document.getElementById('form-register');
    const togLink = document.getElementById('auth-toggle-link');
    const togText = document.getElementById('auth-toggle-text');
    let isLogin = true;

    togLink.addEventListener('click', (e) => {
      e.preventDefault();
      isLogin = !isLogin;
      loginForm.style.display = isLogin ? '' : 'none';
      regForm.style.display = isLogin ? 'none' : '';
      togText.textContent = isLogin ? 'アカウントをお持ちでない方' : 'すでにアカウントをお持ちの方';
      togLink.textContent = isLogin ? '新規登録' : 'ログイン';
    });

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await this.api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: qs('#login-email').value, password: qs('#login-password').value })
        });
        this.user = res.user;
        const me = await this.api('/api/auth/me');
        this.books = me.books;
        this.currentBook = this.books[0];
        loginForm.reset();
        this.showApp();
        this.toast('ログインしました', 'success');
      } catch (err) { this.toast(err.message, 'error'); }
    });

    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await this.api('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ name: qs('#reg-name').value, email: qs('#reg-email').value, password: qs('#reg-password').value })
        });
        this.user = res.user;
        const me = await this.api('/api/auth/me');
        this.books = me.books;
        this.currentBook = this.books[0];
        regForm.reset();
        this.showApp();
        this.toast('アカウントを作成しました！', 'success');
      } catch (err) { this.toast(err.message, 'error'); }
    });
  },

  async logout() {
    await this.api('/api/auth/logout', { method: 'POST' });
    this.user = null; this.books = []; this.currentBook = null;
    this.showAuth();
    this.toast('ログアウトしました');
  },

  // ========================================
  // ナビゲーション
  // ========================================
  setupNav() {
    document.querySelectorAll('.bnav-item').forEach(btn => {
      btn.addEventListener('click', () => this.navigate(btn.dataset.view));
    });
  },

  navigate(view) {
    this.currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById(`view-${view}`);
    if (el) el.classList.add('active');
    document.querySelectorAll('.bnav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));

    if (view === 'home') this.loadDashboard();
    if (view === 'report') this.loadReport();
    if (view === 'settings') { this.renderBookList(); this.loadOverview(); }
  },

  // ========================================
  // トップバー
  // ========================================
  updateTopbar() {
    if (!this.currentBook) return;
    qs('#cur-book-emoji').textContent = this.currentBook.emoji;
    qs('#cur-book-name').textContent = this.currentBook.name;
    if (this.user) {
      qs('#user-initial').textContent = this.user.name.charAt(0).toUpperCase();
      const avatarImg = qs('#user-avatar-img');
      if (this.user.avatar_url) {
        avatarImg.src = this.user.avatar_url;
        avatarImg.style.display = '';
        qs('#user-initial').style.display = 'none';
      } else {
        avatarImg.style.display = 'none';
        qs('#user-initial').style.display = '';
      }
    }
  },

  // ========================================
  // ホーム
  // ========================================
  galleryQueue: [],
  galleryIdx: 0,

  setupHome() {
    qs('#receipt-input').addEventListener('change', (e) => {
      if (e.target.files[0]) this.startOcr(e.target.files[0]);
    });
    qs('#gallery-input').addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;
      if (files.length === 1) {
        this.startOcr(files[0]);
      } else {
        this.galleryQueue = files;
        this.galleryIdx = 0;
        this.toast(`${files.length}枚の写真を読み取ります`, 'success');
        this.startOcr(files[0]);
      }
      e.target.value = '';
    });
    qs('#btn-add-income').addEventListener('click', () => this.openOverlay('income'));
    qs('#btn-add-manual').addEventListener('click', () => this.openOverlay('manual'));
    qs('#btn-view-all').addEventListener('click', () => {
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      qs('#view-history').classList.add('active');
      document.querySelectorAll('.bnav-item').forEach(b => b.classList.remove('active'));
      this.loadHistory();
    });
    qs('#btn-approve-all').addEventListener('click', () => this.approveAll());
  },

  async loadDashboard() {
    if (!this.currentBook) return;
    try {
      const d = await this.api(`/api/dashboard?bookId=${this.currentBook.id}`);
      qs('#home-expense').textContent = `¥${d.monthExpense.toLocaleString()}`;
      qs('#home-income').textContent = `¥${d.monthIncome.toLocaleString()}`;
      this.renderTransactions(d.recentTransactions, 'home-transactions', 'home-empty');
      // 権限ベースUI制御
      const b = this.currentBook;
      const canIncome = b.memberRole === 'owner' || b.can_input_income;
      const canExpense = b.memberRole === 'owner' || b.can_input_expense !== 0;
      const canViewIncome = b.memberRole === 'owner' || b.can_view_income;
      const incBtn = qs('#btn-add-income');
      if (incBtn) incBtn.style.display = canIncome ? '' : 'none';
      const incSection = qs('#home-income')?.closest('.dash-card');
      if (incSection) incSection.style.display = canViewIncome ? '' : 'none';

      // 承認待ちデータ表示
      const pendingSec = qs('#pending-section');
      if (d.pendingCount > 0 && (b.memberRole === 'owner' || b.memberRole === 'manager')) {
        pendingSec.style.display = '';
        qs('#pending-badge').textContent = d.pendingCount;
        this.loadPendingItems();
      } else {
        pendingSec.style.display = 'none';
      }
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async loadPendingItems() {
    if (!this.currentBook) return;
    try {
      const d = await this.api(`/api/pending?bookId=${this.currentBook.id}`);
      const wrap = qs('#pending-list');
      const items = [
        ...d.expenses.map(e => ({ ...e, kind: 'expense' })),
        ...d.income.map(i => ({ ...i, kind: 'income', category: i.type }))
      ].sort((a, b) => (b.created_at || '') > (a.created_at || '') ? 1 : -1);

      if (items.length === 0) {
        qs('#pending-section').style.display = 'none';
        return;
      }

      wrap.innerHTML = items.map((t, i) => {
        const isInc = t.kind === 'income';
        const icon = isInc ? '💰' : this.categoryIcon(t.category);
        const sign = isInc ? '+' : '-';
        const cls = isInc ? 'income' : 'expense';
        const desc = t.description || this.categoryName(t.category);
        const creator = t.creator_name || '不明';
        const createdAt = t.created_at ? t.created_at.slice(5, 16).replace('T', ' ') : '';
        return `<div class="pending-item" style="--i:${i}">
          <div class="pending-main">
            <div class="tx-icon ${cls}">${icon}</div>
            <div class="tx-info">
              <div class="tx-desc">${this.esc(desc)}</div>
              <div class="pending-meta">
                <span class="pending-creator">👤 ${this.esc(creator)}</span>
                <span class="pending-date">${this.fmtDate(t.date)}</span>
                <span class="pending-submitted">${createdAt}</span>
              </div>
            </div>
            <div class="tx-amount ${cls}">${sign}¥${Math.abs(t.amount).toLocaleString()}</div>
          </div>
          <div class="pending-actions">
            <button class="pending-btn approve" data-type="${t.kind}" data-id="${t.id}" title="承認">✓ 承認</button>
            <button class="pending-btn detail" data-type="${t.kind}" data-id="${t.id}" title="詳細">📋</button>
            <button class="pending-btn reject" data-type="${t.kind}" data-id="${t.id}" title="却下">✕</button>
          </div>
        </div>`;
      }).join('');

      wrap.querySelectorAll('.pending-btn.approve').forEach(btn => {
        btn.addEventListener('click', () => this.approveSingle(btn.dataset.type, btn.dataset.id));
      });
      wrap.querySelectorAll('.pending-btn.reject').forEach(btn => {
        btn.addEventListener('click', () => this.rejectSingle(btn.dataset.type, btn.dataset.id));
      });
      wrap.querySelectorAll('.pending-btn.detail').forEach(btn => {
        btn.addEventListener('click', () => this.openEditModal(btn.dataset.id, btn.dataset.type));
      });
    } catch (err) { console.error('pending load error:', err); }
  },

  async approveSingle(type, id) {
    try {
      await this.api(`/api/approve/${type}/${id}`, { method: 'PUT' });
      this.toast('承認しました', 'success');
      this.loadDashboard();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async rejectSingle(type, id) {
    if (!confirm('このデータを却下（削除）しますか？')) return;
    try {
      await this.api(`/api/reject/${type}/${id}`, { method: 'DELETE' });
      this.toast('却下しました');
      this.loadDashboard();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async approveAll() {
    if (!this.currentBook) return;
    if (!confirm('すべての未取込データを承認しますか？')) return;
    try {
      const d = await this.api('/api/approve-all', { method: 'PUT', body: JSON.stringify({ bookId: this.currentBook.id }) });
      this.toast(`${d.approved}件を承認しました`, 'success');
      this.loadDashboard();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  renderTransactions(txs, containerId, emptyId) {
    const wrap = qs(`#${containerId}`);
    const empty = qs(`#${emptyId}`);
    if (!txs || txs.length === 0) { wrap.innerHTML = ''; empty.style.display = ''; return; }
    empty.style.display = 'none';
    wrap.innerHTML = txs.map((t, i) => {
      const isInc = t.kind === 'income';
      const icon = isInc ? '💰' : this.categoryIcon(t.category);
      const sign = isInc ? '+' : '-';
      const cls = isInc ? 'income' : 'expense';
      const desc = t.description || this.categoryName(t.category);
      const isPending = t.status === 'pending';
      const pendingBadge = isPending ? '<span class="tx-pending-badge">承認待ち</span>' : '';
      const creatorInfo = t.creator_name ? `<span class="tx-creator">by ${this.esc(t.creator_name)}</span>` : '';
      return `<div class="tx-item${isPending ? ' tx-pending' : ''}" style="--i:${i}" data-id="${t.id}" data-kind="${t.kind}">
        <div class="tx-icon ${cls}">${icon}</div>
        <div class="tx-info"><div class="tx-desc">${this.esc(desc)}${pendingBadge}</div><div class="tx-date">${this.fmtDate(t.date)} ${creatorInfo}</div></div>
        <div class="tx-amount ${cls}">${sign}¥${Math.abs(t.amount).toLocaleString()}</div>
      </div>`;
    }).join('');
    wrap.querySelectorAll('.tx-item').forEach(el => {
      el.addEventListener('click', () => this.openEditModal(el.dataset.id, el.dataset.kind));
    });
  },

  // ========================================
  // OCR フロー
  // ========================================
  async startOcr(file) {
    this.receiptFile = file;
    const reader = new FileReader();
    reader.onload = (e) => { this.receiptDataUrl = e.target.result; };
    reader.readAsDataURL(file);

    this.openOverlay('scanning');
    qs('#scan-img').src = URL.createObjectURL(file);
    qs('#scan-progress-fill').style.width = '0%';
    qs('#scan-status').textContent = '読み取り中...';

    try {
      const processed = await this.preprocessImage(file);
      const result = await Tesseract.recognize(processed, 'jpn+eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            const pct = Math.round(m.progress * 100);
            qs('#scan-progress-fill').style.width = pct + '%';
            qs('#scan-status').textContent = `読み取り中... ${pct}%`;
          }
        }
      });
      const extracted = this.parseReceipt(result.data.text);
      this.closeOverlay('scanning');
      this.showConfirm(extracted, result.data.text);
    } catch (err) {
      this.closeOverlay('scanning');
      this.toast('読み取りに失敗しました', 'error');
      console.error(err);
    }
    qs('#receipt-input').value = '';
  },

  preprocessImage(file) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const maxW = 2000;
        let w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);
        const d = imgData.data;
        const contrast = 1.6, threshold = 140;
        for (let i = 0; i < d.length; i += 4) {
          let gray = d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114;
          gray = ((gray - 128) * contrast) + 128;
          gray = gray > threshold ? 255 : 0;
          d[i] = d[i+1] = d[i+2] = gray;
        }
        ctx.putImageData(imgData, 0, 0);
        canvas.toBlob(resolve, 'image/png');
      };
      img.src = URL.createObjectURL(file);
    });
  },

  parseReceipt(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    let amount = 0, date = '', description = '';

    // 金額: 合計・税込キーワードを優先
    for (const l of lines) {
      if (/合計|税込|Total/i.test(l)) {
        const m = l.match(/[\d,]+/g);
        if (m) { const v = parseInt(m[m.length-1].replace(/,/g,'')); if (v > amount) amount = v; }
      }
    }
    if (!amount) {
      const amts = [];
      for (const l of lines) {
        const ms = l.match(/[¥￥][\s]*[\d,]+|[\d,]+\s*円/g);
        if (ms) ms.forEach(s => { const v = parseInt(s.replace(/[^0-9]/g,'')); if (v > 0) amts.push(v); });
      }
      if (amts.length) amount = Math.max(...amts);
    }

    // 日付
    for (const l of lines) {
      let m = l.match(/(\d{4})[\/\.\-](\d{1,2})[\/\.\-](\d{1,2})/);
      if (m && parseInt(m[1]) >= 2000 && parseInt(m[1]) <= 2099) { date = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`; break; }
      m = l.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
      if (m) { date = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`; break; }
      m = l.match(/[RＲ令](\d{1,2})[\.\/年](\d{1,2})[\.\/月](\d{1,2})/);
      if (m) { date = `${2018+parseInt(m[1])}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`; break; }
    }

    // 店舗名: 上部の行から候補探索
    const storeKeys = ['店','株式会社','有限会社','ストア','Store','STORE','マート','モール'];
    for (let i = 0; i < Math.min(8, lines.length); i++) {
      const l = lines[i];
      if (l.length < 2 || /^[\d\s\-\/\.\,\:]+$/.test(l)) continue;
      if (storeKeys.some(k => l.includes(k))) { description = l.replace(/[\s]{2,}/g,' ').substring(0,50); break; }
    }
    if (!description) {
      for (let i = 0; i < Math.min(5, lines.length); i++) {
        const l = lines[i];
        if (l.length >= 2 && !/^[\d\s\-\/\.\,\:\#\*]+$/.test(l) && !/^\d{2,4}[\/\-]/.test(l)) { description = l.substring(0,50); break; }
      }
    }

    return { amount, date: date || new Date().toISOString().slice(0,10), description };
  },

  // ========================================
  // 確認画面
  // ========================================
  showConfirm(extracted) {
    this.openOverlay('confirm');
    qs('#confirm-img').src = this.receiptDataUrl;
    qs('#cf-date').value = extracted.date;
    qs('#cf-amount').value = extracted.amount || '';
    qs('#cf-desc').value = extracted.description;

    const grid = qs('#cf-cats');
    const suggested = this.suggestCategory(extracted.description);
    this._cfSelectedCat = suggested;
    this.renderHierarchicalCategories(grid, this.expenseGroups, suggested, (id) => { this._cfSelectedCat = id; });

    qs('#btn-cf-retake').onclick = () => {
      this.closeOverlay('confirm');
      qs('#receipt-input').click();
    };
    qs('#btn-cf-save').onclick = () => this.saveFromConfirm();
  },

  suggestCategory(desc, amount) {
    if (!desc) return 'general';
    const d = desc.toLowerCase();
    const map = {
      medical: ['病院','医院','クリニック','歯科','薬局','薬店','ドラッグ','調剤','診療','処方','眼科','皮膚科','内科','外科','整骨','接骨','治療','健診','人間ドック','医療'],
      insurance: ['国民年金','国保','社会保険','国民健康保険','健康保険','年金','共済'],
      life_insurance: ['生命保険','損害保険','がん保険','養老保険','介護保険','学資保険','個人年金保険'],
      earthquake_insurance: ['地震保険','火災保険'],
      donation: ['寄附','寄付','ふるさと納税','赤十字','ユニセフ'],
      entertainment: ['飲食','居酒屋','レストラン','食事','ランチ','カフェ','スタバ','マクドナルド','コンビニ','セブン','ローソン','ファミマ','弁当'],
      labor: ['外注','業務委託','ランサーズ','クラウドワークス','給与','報酬'],
      rent: ['電気','ガス','水道','家賃','光熱','賃料'],
      asset: ['パソコン','PC','Mac','iPhone','iPad','カメラ','モニター','プリンター'],
      tax_deductible: ['消費税','印紙税','事業税','固定資産税','自動車税','収入印紙','都市計画税'],
      tax_non_deductible: ['所得税','住民税','法人税','予定納税','源泉所得税','確定申告'],
      general: ['交通','電車','JR','suica','タクシー','バス','新幹線','高速','ETC','ガソリン','駐車','通信','携帯','AWS','サーバー','Amazon','アマゾン','ヨドバシ','文具','コピー','消耗品','広告','宣伝','手数料','PayPal','Stripe','振込','ATM'],
    };
    for (const [cat, kws] of Object.entries(map)) {
      for (const kw of kws) { if (d.includes(kw.toLowerCase())) return cat; }
    }
    if (amount && amount >= 100000) return 'asset';
    return 'general';
  },

  async saveFromConfirm() {
    const catEl = this._cfSelectedCat;
    if (!catEl) { this.toast('科目を選択してください', 'error'); return; }
    const btn = qs('#btn-cf-save');
    btn.disabled = true; btn.textContent = '保存中...';

    const fd = new FormData();
    fd.append('bookId', this.currentBook.id);
    fd.append('date', qs('#cf-date').value);
    fd.append('amount', qs('#cf-amount').value);
    fd.append('category', catEl);
    fd.append('description', qs('#cf-desc').value);
    fd.append('source', 'ocr');
    if (this.receiptFile) fd.append('receipt', this.receiptFile);

    try {
      await fetch(BASE + '/api/expense', { method: 'POST', body: fd, credentials: 'same-origin' });
      this.closeOverlay('confirm');
      this.showSuccess(qs('#cf-amount').value, qs('#cf-desc').value, this.categoryName(catEl), catEl);
      this.loadDashboard();
    } catch (err) { this.toast(err.message, 'error'); }
    btn.disabled = false; btn.textContent = '保存する';
  },

  // ========================================
  // 成功画面
  // ========================================
  showSuccess(amount, desc, catName, category) {
    this.openOverlay('success');
    qs('#success-summary').textContent = `${desc || catName} ¥${parseInt(amount).toLocaleString()}`;
    this.createConfetti();

    // 高額支出→減価償却の自動提案
    const amt = parseInt(amount);
    if (amt >= 100000 && category === 'depreciation') {
      setTimeout(() => {
        if (confirm(`¥${amt.toLocaleString()} の支出が登録されました。\n\nこれは減価償却資産として登録しますか？\n（PC: 4年, 車両: 6年, 家具: 8年）`)) {
          const life = prompt('耐用年数（年）:', '4');
          if (life) {
            this.api('/api/depreciations', { method: 'POST', body: JSON.stringify({
              bookId: this.currentBook.id, name: desc || catName,
              purchase_date: new Date().toISOString().slice(0, 10),
              purchase_amount: amt, useful_life: parseInt(life) || 4
            })}).then(() => this.toast('減価償却資産に登録しました', 'success'))
              .catch(err => this.toast(err.message, 'error'));
          }
        }
      }, 500);
    }

    qs('#btn-ss-another').onclick = () => {
      this.closeOverlay('success');
      if (this.galleryQueue.length > 0 && this.galleryIdx < this.galleryQueue.length - 1) {
        this.galleryIdx++;
        this.toast(`${this.galleryIdx + 1}/${this.galleryQueue.length}枚目`, 'success');
        setTimeout(() => this.startOcr(this.galleryQueue[this.galleryIdx]), 200);
      } else {
        this.galleryQueue = [];
        this.galleryIdx = 0;
        setTimeout(() => qs('#receipt-input').click(), 200);
      }
    };
    qs('#btn-ss-home').onclick = () => {
      this.closeOverlay('success');
      this.galleryQueue = [];
      this.galleryIdx = 0;
      this.navigate('home');
    };
  },

  createConfetti() {
    const container = qs('#success-particles');
    container.innerHTML = '';
    const colors = ['#6366f1','#22c55e','#f59e0b','#ef4444','#06b6d4','#8b5cf6'];
    for (let i = 0; i < 30; i++) {
      const p = document.createElement('div');
      p.className = 'success-particle';
      p.style.left = Math.random()*100 + '%';
      p.style.top = '40%';
      p.style.background = colors[Math.floor(Math.random()*colors.length)];
      p.style.animationDelay = Math.random()*0.4 + 's';
      p.style.animationDuration = (1 + Math.random()*0.8) + 's';
      container.appendChild(p);
    }
  },

  // ========================================
  // レポート
  // ========================================
  setupReport() {
    const sel = qs('#report-year');
    const thisYear = new Date().getFullYear();
    for (let y = thisYear; y >= thisYear - 3; y--) {
      sel.innerHTML += `<option value="${y}">${y}年</option>`;
    }
    sel.addEventListener('change', () => this.loadReport());

    qs('#btn-toggle-analytics').addEventListener('click', () => {
      const sec = qs('#analytics-section');
      const isHidden = sec.style.display === 'none';
      sec.style.display = isHidden ? '' : 'none';
      const btn = qs('#btn-toggle-analytics');
      if (isHidden) { btn.style.background = 'var(--pri-bg)'; btn.style.color = 'var(--pri)'; btn.style.borderColor = 'var(--pri)'; }
      else { btn.style.background = ''; btn.style.color = ''; btn.style.borderColor = ''; }
    });

    qs('#btn-ai-gen').addEventListener('click', async () => {
      try {
        const y = qs('#report-year').value;
        const d = await this.api(`/api/ai-format/${y}?bookId=${this.currentBook.id}`);
        qs('#ai-output').value = d.text;
        qs('#btn-ai-copy').style.display = '';
      } catch (err) { this.toast(err.message, 'error'); }
    });

    qs('#btn-ai-copy').addEventListener('click', () => {
      qs('#ai-output').select();
      navigator.clipboard.writeText(qs('#ai-output').value);
      this.toast('コピーしました', 'success');
    });

    // フロー行タップで一覧を表示
    qs('#tf-income-row').addEventListener('click', () => {
      const y = qs('#report-year').value;
      this.openTxListModal('income', y);
    });
    qs('#tf-expense-row').addEventListener('click', () => {
      const y = qs('#report-year').value;
      this.openTxListModal('expense', y);
    });

    // 控除追加
    qs('#btn-add-deduction').addEventListener('click', () => {
      const types = [
        ['blue_return', '青色申告特別控除（65万円）', 650000],
        ['medical', '医療費控除', 0],
        ['social_insurance', '社会保険料控除', 0],
        ['spouse', '配偶者控除（38万円）', 380000],
        ['dependent', '扶養控除', 0],
        ['life_insurance', '生命保険料控除', 0],
        ['earthquake', '地震保険料控除', 0],
        ['small_business', '小規模企業共済等掛金控除', 0],
        ['hometown_tax', 'ふるさと納税', 0],
        ['other', 'その他']
      ];
      const typeStr = types.map((t, i) => `${i+1}. ${t[1]}`).join('\n');
      const choice = prompt(`控除の種類を番号で選んでください:\n\n${typeStr}`);
      if (!choice) return;
      const idx = parseInt(choice) - 1;
      if (idx < 0 || idx >= types.length) { this.toast('無効な選択です', 'error'); return; }
      const [type, label, defaultAmt] = types[idx];
      const amtStr = prompt(`${label}\n金額を入力してください（円）:`, defaultAmt || '');
      if (!amtStr) return;
      const amount = parseInt(amtStr.replace(/[^0-9]/g, ''));
      if (!amount || amount <= 0) { this.toast('金額が無効です', 'error'); return; }
      this.api('/api/deductions', { method: 'POST', body: JSON.stringify({
        bookId: this.currentBook.id, year: qs('#report-year').value, type, name: label, amount
      })}).then(() => { this.toast('控除を追加しました', 'success'); this.loadReport(); })
        .catch(err => this.toast(err.message, 'error'));
    });

    // 減価償却追加
    qs('#btn-add-depreciation').addEventListener('click', () => {
      const name = prompt('資産名を入力してください:\n（例: MacBook Pro, 業務用車両）');
      if (!name) return;
      const purchaseDate = prompt('取得日（YYYY-MM-DD）:', new Date().toISOString().slice(0, 10));
      if (!purchaseDate) return;
      const amtStr = prompt('取得価格（円）:');
      if (!amtStr) return;
      const amount = parseInt(amtStr.replace(/[^0-9]/g, ''));
      if (!amount) { this.toast('金額が無効です', 'error'); return; }
      const lifeStr = prompt('耐用年数（年）:\n\nPC: 4年, 車両: 6年, 家具: 8年, 建物: 22-47年', '4');
      if (!lifeStr) return;
      const life = parseInt(lifeStr);
      this.api('/api/depreciations', { method: 'POST', body: JSON.stringify({
        bookId: this.currentBook.id, name, purchase_date: purchaseDate, purchase_amount: amount, useful_life: life
      })}).then(() => { this.toast('減価償却資産を追加しました', 'success'); this.loadReport(); })
        .catch(err => this.toast(err.message, 'error'));
    });
  },

  getReportPeriod() {
    const y = qs('#report-year').value;
    const book = this.currentBook;
    const fm = book?.fiscal_start_month || 1;
    if (fm === 1) return { year: y, startDate: `${y}-01-01`, endDate: `${y}-12-31` };
    const startY = parseInt(y);
    const endM = fm - 1;
    const endY = startY + 1;
    return {
      year: y,
      startDate: `${startY}-${String(fm).padStart(2,'0')}-01`,
      endDate: `${endY}-${String(endM).padStart(2,'0')}-${new Date(endY, endM, 0).getDate()}`
    };
  },

  async exportReceipts() {
    if (!this.currentBook) return;
    const startDate = qs('#receipt-start')?.value;
    const endDate = qs('#receipt-end')?.value;
    if (!startDate || !endDate) { this.toast('期間を指定してください', 'error'); return; }
    try {
      const url = `${BASE}/api/export-receipts?bookId=${this.currentBook.id}&startDate=${startDate}&endDate=${endDate}`;
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) { const e = await res.json(); this.toast(e.error, 'error'); return; }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Receipts_${startDate}_${endDate}.zip`;
      a.click();
      this.toast('ダウンロード開始', 'success');
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async loadReport() {
    if (!this.currentBook) return;
    const { year: y, startDate, endDate } = this.getReportPeriod();
    try {
      const periodParam = `&startDate=${startDate}&endDate=${endDate}`;
      const d = await this.api(`/api/summary/${y}?bookId=${this.currentBook.id}${periodParam}`);

      // 収入内訳バー
      const incBdWrap = qs('#rpt-income-breakdown');
      const incEmpty = qs('#rpt-income-empty');
      if (d.incomeBreakdown && d.incomeBreakdown.length > 0) {
        incEmpty.style.display = 'none';
        const maxInc = d.incomeBreakdown[0].total;
        incBdWrap.innerHTML = d.incomeBreakdown.map(b => `
          <div class="bd-item" data-income-type="${b.income_type}"><div class="bd-head"><span class="bd-name">${this.incomeTypeIcon(b.income_type)} ${this.incomeTypeName(b.income_type)}</span><span class="bd-val">¥${b.total.toLocaleString()} (${b.count}件) <span class="bd-arrow">›</span></span></div>
          <div class="bd-bar"><div class="bd-fill income" style="width:${(b.total/maxInc*100).toFixed(1)}%"></div></div></div>
        `).join('');
        incBdWrap.querySelectorAll('.bd-item').forEach(el => {
          el.addEventListener('click', () => this.openTxListModal('income', y, null, el.dataset.incomeType));
        });
      } else {
        incBdWrap.innerHTML = '';
        incEmpty.style.display = '';
      }

      // 支出内訳バー
      const bdWrap = qs('#rpt-breakdown');
      const expEmpty = qs('#rpt-expense-empty');
      if (d.breakdown.length > 0) {
        expEmpty.style.display = 'none';
        const maxBd = Math.max(...d.breakdown.map(b => b.total));
        bdWrap.innerHTML = d.breakdown.map(b => {
          const isTp = b.isTaxProfit;
          const ratioLabel = b.incomeRatio ? `${b.incomeRatio}%` : '';
          return `<div class="bd-item ${isTp ? 'bd-tax-profit' : ''}" data-category="${b.category}">
            <div class="bd-head">
              <span class="bd-name">${this.categoryIcon(b.category)} ${this.categoryName(b.category)}${isTp ? ' <span class="bd-tag-tp">非経費</span>' : ''}</span>
              <span class="bd-val">¥${b.total.toLocaleString()} <span class="bd-ratio">${ratioLabel}</span> <span class="bd-arrow">›</span></span>
            </div>
            <div class="bd-bar"><div class="bd-fill ${isTp ? 'tax-profit' : ''}" style="width:${(b.total/maxBd*100).toFixed(1)}%"></div></div>
          </div>`;
        }).join('');
        bdWrap.querySelectorAll('.bd-item').forEach(el => {
          el.addEventListener('click', () => this.openTxListModal('expense', y, el.dataset.category));
        });
      } else {
        bdWrap.innerHTML = '';
        expEmpty.style.display = '';
      }
      this.renderReportChart(d);
      this.renderAnalytics(d);

      // 税額シミュレーション
      const t = await this.api(`/api/tax-simulation/${y}?bookId=${this.currentBook.id}`);
      this._taxData = t;
      const tax = t.tax || {};
      const ctd = t.comprehensiveTaxDetail || {};
      const cb = t.currentBracket || { rate: 0, ratePercent: 0 };

      // 真の自由資金ヒーロー
      const freeCash = t.freeCash || 0;
      qs('#free-cash-val').textContent = `¥${freeCash.toLocaleString()}`;
      qs('#free-cash-sub').textContent = `収入 ¥${(t.totalIncome || 0).toLocaleString()} − 支出 ¥${(t.totalExpenses || 0).toLocaleString()} − 税 ¥${(t.totalAllTaxes || 0).toLocaleString()}`;
      const fchEl = qs('#free-cash-hero');
      if (fchEl) fchEl.classList.toggle('negative', freeCash < 0);

      // 税負担ヒーロー
      const allTaxes = t.totalAllTaxes || tax.totalTax || 0;
      qs('#tax-total').textContent = `¥${allTaxes.toLocaleString()}`;
      const effRate = t.effectiveTotalRate || 0;
      qs('#tax-hero-sub').textContent = effRate > 0 ? `実効税率 ${effRate}%` : '';

      // 赤字の貯金箱
      const lc = t.lossCarryforward || {};
      const lossCard = qs('#loss-card');
      if (lossCard) {
        const avail = (lc.availableLosses || []);
        const totalLoss = avail.reduce((s, l) => s + l.remaining, 0);
        if (totalLoss > 0 || (lc.currentYearLoss || 0) > 0) {
          lossCard.style.display = '';
          let html = '<div class="loss-head"><span class="loss-icon">🏦</span><span class="loss-title">赤字の貯金箱</span></div>';
          if (totalLoss > 0) {
            const futSave = Math.floor(totalLoss * 0.3);
            html += `<div class="loss-main">繰越欠損金 <strong>¥${totalLoss.toLocaleString()}</strong></div>`;
            html += `<div class="loss-sub">将来の税金を約 ¥${futSave.toLocaleString()} 軽減できる資産</div>`;
          }
          if ((lc.currentYearLoss || 0) > 0) {
            html += `<div class="loss-current">今年の赤字 ¥${lc.currentYearLoss.toLocaleString()} → 翌年以降に繰越</div>`;
          }
          if ((lc.totalUsed || 0) > 0) {
            html += `<div class="loss-used">今年 ¥${lc.totalUsed.toLocaleString()} の繰越を使用 → 節税済み</div>`;
          }
          qs('#loss-content').innerHTML = html;
        } else {
          lossCard.style.display = 'none';
        }
      }

      // 消費税アラート
      const cta = t.consumptionTaxAlert || {};
      const ctaCard = qs('#cta-card');
      if (ctaCard && cta.level && cta.level !== 'safe' && cta.message) {
        ctaCard.style.display = '';
        ctaCard.innerHTML = `<div class="cta-level cta-${cta.level}">${cta.level === 'over' ? '⚠️' : '📊'} ${cta.message}</div>`;
      } else if (ctaCard) {
        ctaCard.style.display = 'none';
      }

      // 消費税最適化表示
      const ct = t.consumptionTax || {};
      if (ct.applicable && ct.method) {
        const otherMethod = ct.method === 'simplified' ? '本則課税' : '簡易課税';
        const otherAmt = ct.method === 'simplified' ? ct.standard : ct.simplified;
      }

      // 税負担サマリーバー
      const summaryBars = t.taxSummary || [];
      const maxTaxAmt = Math.max(...summaryBars.map(s => s.amount), 1);
      const catColors = { '所得税': '', '住民税': 'resident', '国民健康保険': 'nhi', '個人事業税': 'biz', '消費税': 'consump', '分離課税': 'separate' };
      qs('#tax-summary-bars').innerHTML = summaryBars.filter(s => s.amount > 0).map(s => {
        const pct = Math.round(s.amount / allTaxes * 100);
        const fillCls = catColors[s.label] || '';
        return `<div class="tax-bar-item">
          <span class="tax-bar-icon">${s.icon}</span>
          <div class="tax-bar-info">
            <div class="tax-bar-label">${s.label}</div>
            <div class="tax-bar-gauge"><div class="tax-bar-fill ${fillCls}" style="width:${(s.amount/maxTaxAmt*100).toFixed(1)}%"></div></div>
          </div>
          <span class="tax-bar-amount">¥${s.amount.toLocaleString()}</span>
          <span class="tax-bar-pct">${pct}%</span>
        </div>`;
      }).join('');

      // 支払スケジュール
      this.renderPaymentSchedule(t.paymentSchedule || []);

      // 収入区分と課税方式
      const tbtWrap = qs('#tax-by-type');
      if (t.taxByIncomeType && t.taxByIncomeType.length > 0) {
        qs('#tax-by-type-card').style.display = '';
        tbtWrap.innerHTML = t.taxByIncomeType.map(item => {
          const isSep = item.method === '申告分離課税';
          return `<div class="tbt-item ${isSep ? 'separate' : ''}">
            <div class="tbt-head">
              <span class="tbt-label">${this.incomeTypeIcon(item.income_type)} ${item.label}</span>
              <span class="tbt-amount">¥${(item.amount || 0).toLocaleString()}</span>
            </div>
            <div class="tbt-meta">
              <span class="tbt-badge ${isSep ? 'separate' : 'comprehensive'}">${item.method}</span>
              <span class="tbt-rate">${item.taxRateLabel || ''}</span>
            </div>
            ${isSep && item.taxAmount ? `<div class="tbt-tax">→ 税額: ¥${item.taxAmount.toLocaleString()} (${item.taxRate}%)</div>` : ''}
          </div>`;
        }).join('');
      } else {
        qs('#tax-by-type-card').style.display = 'none';
      }

      // 収支フロー
      qs('#rpt-income').textContent = `¥${(t.comprehensiveIncome || 0).toLocaleString()}`;
      qs('#rpt-expense').textContent = `¥${(t.totalExpenses || 0).toLocaleString()}`;
      qs('#rpt-depreciation').textContent = `¥${(t.totalDepreciation || 0).toLocaleString()}`;
      qs('#rpt-deductions').textContent = `¥${(t.totalDeductions || 0).toLocaleString()}`;
      qs('#rpt-taxable').textContent = `¥${(t.taxableIncome || 0).toLocaleString()}`;

      // 利益課税の表示
      if ((t.taxProfitTotal || 0) > 0) {
        const tpRow = qs('#tf-tax-profit-row');
        if (tpRow) { tpRow.style.display = ''; tpRow.querySelector('.tf-val').textContent = `¥${t.taxProfitTotal.toLocaleString()}`; }
      } else {
        const tpRow = qs('#tf-tax-profit-row');
        if (tpRow) tpRow.style.display = 'none';
      }

      // 税額内訳（全税種）
      let bdHtml = '';
      bdHtml += `<div class="tax-bd-row"><div class="tax-bd-left"><span class="tax-bd-label">所得税</span><span class="tax-bd-rate">課税所得 × ${cb.ratePercent}%</span></div><span class="tax-bd-val">¥${(tax.incomeTax || 0).toLocaleString()}</span></div>`;
      bdHtml += `<div class="tax-bd-row"><div class="tax-bd-left"><span class="tax-bd-label">復興特別所得税</span><span class="tax-bd-rate">×2.1%</span></div><span class="tax-bd-val">¥${(tax.reconstructionTax || 0).toLocaleString()}</span></div>`;
      bdHtml += `<div class="tax-bd-row"><div class="tax-bd-left"><span class="tax-bd-label">住民税</span><span class="tax-bd-rate">×10%</span></div><span class="tax-bd-val">¥${(tax.residentTax || 0).toLocaleString()}</span></div>`;
      const nhi = t.nhi || {};
      if ((nhi.total || 0) > 0) {
        bdHtml += `<div class="tax-bd-row"><div class="tax-bd-left"><span class="tax-bd-label">国民健康保険</span><span class="tax-bd-rate">医療+支援+介護</span></div><span class="tax-bd-val">¥${nhi.total.toLocaleString()}</span></div>`;
      }
      if ((t.businessTax || 0) > 0) {
        bdHtml += `<div class="tax-bd-row"><div class="tax-bd-left"><span class="tax-bd-label">個人事業税</span><span class="tax-bd-rate">×5%</span></div><span class="tax-bd-val">¥${t.businessTax.toLocaleString()}</span></div>`;
      }
      if (t.consumptionTax?.applicable) {
        bdHtml += `<div class="tax-bd-row"><div class="tax-bd-left"><span class="tax-bd-label">消費税</span><span class="tax-bd-rate">簡易課税</span></div><span class="tax-bd-val">¥${t.consumptionTax.amount.toLocaleString()}</span></div>`;
      }
      if ((tax.separateTax || 0) > 0) {
        bdHtml += `<div class="tax-bd-row"><div class="tax-bd-left"><span class="tax-bd-label">分離課税</span><span class="tax-bd-rate">×20.315%</span></div><span class="tax-bd-val">¥${tax.separateTax.toLocaleString()}</span></div>`;
      }
      bdHtml += `<div class="tax-bd-row total"><span>年間税負担合計</span><span class="tax-bd-val">¥${(t.totalAllTaxes || tax.totalTax || 0).toLocaleString()}</span></div>`;
      qs('#tax-breakdown').innerHTML = bdHtml;

      // 支出の節税効果
      if (t.expenseTaxImpact && t.expenseTaxImpact.length > 0) {
        qs('#expense-impact-card').style.display = '';
        qs('#expense-impact-desc').textContent = `実効税率 約${t.expenseTaxImpact[0].effectiveRate}%。支出1万円で約¥${Math.floor(t.expenseTaxImpact[0].effectiveRate * 100)}の節税。`;
        qs('#expense-impact').innerHTML = t.expenseTaxImpact.map(e => `
          <div class="ei-item">
            <span class="ei-icon">${this.categoryIcon(e.category)}</span>
            <div class="ei-body">
              <div class="ei-name">${this.categoryName(e.category)}</div>
              <div class="ei-detail">¥${e.total.toLocaleString()} (${e.count}件)</div>
            </div>
            <div class="ei-saving">
              <div class="ei-saving-val">-¥${e.taxSaving.toLocaleString()}</div>
              <div class="ei-saving-rate">節税額</div>
            </div>
          </div>
        `).join('');
      } else {
        qs('#expense-impact-card').style.display = 'none';
      }

      // 節税アドバイス（グループ×段階）
      this.renderAdviceGroups(t.adviceGroups || []);

      // 消費税壁アラート
      this.renderConsumptionTaxAlert(t.consumptionTaxAlert);

      // 欠損金（赤字）繰越
      this.renderCarryoverLoss(t.carryoverLoss);

      // 税務健全性スコア
      this.renderHealthScore(t.healthScore);

      // 控除一覧
      this.renderDeductions(t.deductions || [], y);
      // 減価償却一覧
      this.renderDepreciations(t.depreciationDetails || [], y);
    } catch (err) { this.toast(err.message, 'error'); }
  },

  renderAdviceGroups(groups) {
    const wrap = qs('#tax-tips');
    const card = qs('#tax-tips-card');
    if (!groups || groups.length === 0) {
      if (card) card.style.display = 'none';
      return;
    }
    if (card) card.style.display = '';

    wrap.innerHTML = groups.map(g => {
      if (g.id === 'summary') {
        return `<div class="adv-summary">
          <span class="adv-summary-icon">${g.icon || '🎯'}</span>
          <span class="adv-summary-text">${g.desc}</span>
        </div>`;
      }
      const stepsHtml = (g.steps || []).map(s => {
        if (s.note) return `<div class="adv-step"><span class="adv-step-label">${s.note}</span></div>`;
        return `<div class="adv-step">
          <span class="adv-step-add">+¥${(s.add || 0).toLocaleString()}</span>
          <span class="adv-step-arrow">→</span>
          <span class="adv-step-saving">-¥${(s.saving || 0).toLocaleString()}</span>
        </div>`;
      }).join('');

      return `<div class="adv-group">
        <div class="adv-group-head">
          <span class="adv-group-icon">${g.icon || '📊'}</span>
          <div class="adv-group-info">
            <div class="adv-group-title">${g.title}</div>
            <div class="adv-group-desc">${g.desc}</div>
          </div>
          <span class="adv-group-toggle">›</span>
        </div>
        <div class="adv-steps" style="display:none">${stepsHtml}</div>
      </div>`;
    }).join('');

    wrap.querySelectorAll('.adv-group-head').forEach(h => {
      h.addEventListener('click', () => {
        const steps = h.nextElementSibling;
        const toggle = h.querySelector('.adv-group-toggle');
        const isOpen = steps.style.display !== 'none';
        steps.style.display = isOpen ? 'none' : '';
        toggle.textContent = isOpen ? '›' : '⌄';
      });
    });
  },

  renderConsumptionTaxAlert(alert) {
    const card = qs('#cta-card');
    if (!card) return;
    if (!alert || alert.level === 'safe') { card.style.display = 'none'; return; }
    card.style.display = '';
    const levelClass = { warning: 'cta-warning', danger: 'cta-danger', over: 'cta-over' };
    const levelIcon = { warning: '⚠️', danger: '🚨', over: '🔴' };
    card.className = `card cta-card ${levelClass[alert.level] || ''}`;
    const pct = alert.ratio || 0;
    card.innerHTML = `
      <div class="cta-head">
        <span class="cta-icon">${levelIcon[alert.level] || '⚠️'}</span>
        <div class="cta-info">
          <div class="cta-title">消費税の壁 — ${alert.level === 'over' ? '納税義務発生' : '接近中'}</div>
          <div class="cta-msg">${alert.message || ''}</div>
        </div>
      </div>
      <div class="cta-bar-wrap">
        <div class="cta-bar">
          <div class="cta-bar-fill ${levelClass[alert.level] || ''}" style="width:${Math.min(pct, 100)}%"></div>
          <span class="cta-bar-label">課税売上 ¥${(alert.taxableRevenue || 0).toLocaleString()} / 1,000万円</span>
        </div>
        <span class="cta-pct">${pct}%</span>
      </div>
      ${(alert.nonTaxableRevenue || 0) > 0 ? `<div class="cta-note">非課税売上: ¥${alert.nonTaxableRevenue.toLocaleString()}（輸出・土地・医療等）は消費税計算から除外</div>` : ''}
    `;
  },

  renderCarryoverLoss(loss) {
    const card = qs('#carryover-card');
    if (!card) return;
    if (!loss || !loss.hasLoss) { card.style.display = 'none'; return; }
    card.style.display = '';
    card.innerHTML = `
      <div class="cl-head">
        <span class="cl-icon">📉</span>
        <div class="cl-info">
          <div class="cl-title">欠損金（赤字）の繰越控除</div>
          <div class="cl-desc">今年の赤字は「節税の貯金」です</div>
        </div>
      </div>
      <div class="cl-amounts">
        <div class="cl-item">
          <span class="cl-label">今年の欠損金</span>
          <span class="cl-val loss">¥${loss.amount.toLocaleString()}</span>
        </div>
        <div class="cl-item">
          <span class="cl-label">来年の節税効果（最大）</span>
          <span class="cl-val saving">▲¥${loss.nextYearSaving.toLocaleString()}</span>
        </div>
        <div class="cl-item">
          <span class="cl-label">繰越可能年数</span>
          <span class="cl-val">${loss.carryoverYears}年間</span>
        </div>
      </div>
      <div class="cl-note">${loss.message || ''}</div>
    `;
  },

  renderHealthScore(score) {
    const card = qs('#health-score-card');
    if (!card || !score) return;
    card.style.display = '';
    const gradeColors = { A: '#22c55e', B: '#6366f1', C: '#f59e0b', D: '#ef4444' };
    const color = gradeColors[score.grade] || '#94a3b8';
    card.innerHTML = `
      <div class="hs-head">
        <div class="hs-score-wrap">
          <div class="hs-score" style="color:${color}">${score.score}</div>
          <div class="hs-grade" style="background:${color}">${score.grade}</div>
          <div class="hs-label">${score.gradeLabel}</div>
        </div>
        <div class="hs-title">
          <div class="hs-title-text">税務健全性スコア</div>
          <div class="hs-subtitle">税務調査リスク指標</div>
        </div>
      </div>
      <div class="hs-bar-wrap">
        <div class="hs-bar">
          <div class="hs-bar-fill" style="width:${score.score}%;background:${color}"></div>
        </div>
      </div>
      ${score.issues && score.issues.length > 0 ? `
      <div class="hs-issues">
        ${score.issues.map(issue => {
          const cls = issue.severity === 'high' ? 'hs-issue-high' : issue.severity === 'medium' ? 'hs-issue-medium' : 'hs-issue-good';
          const icon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
          return `<div class="hs-issue ${cls}">
            <span class="hs-issue-icon">${icon}</span>
            <div class="hs-issue-body">
              <div class="hs-issue-label">${issue.label}</div>
              <div class="hs-issue-detail">${issue.detail}</div>
            </div>
          </div>`;
        }).join('')}
      </div>` : ''}
    `;
  },

  renderPaymentSchedule(schedule) {
    const wrap = qs('#payment-schedule');
    const wrapAll = qs('#payment-schedule-all');
    const btnAll = qs('#btn-show-all-schedule');
    if (!wrap || !schedule.length) {
      if (wrap) wrap.innerHTML = '<div style="text-align:center;color:var(--text3);font-size:13px;padding:12px">データを入力すると支払予定が表示されます</div>';
      if (wrapAll) wrapAll.style.display = 'none';
      if (btnAll) btnAll.style.display = 'none';
      return;
    }
    const now = new Date();
    const upcoming = schedule.filter(p => new Date(p.date) >= now).sort((a, b) => a.date.localeCompare(b.date));
    const preview = upcoming.slice(0, 3);
    const rest = upcoming.slice(3);

    const renderItems = (items) => items.map(p => `<div class="pt-item">
      <div class="pt-item-left">
        <span class="pt-item-icon">${p.icon || '📋'}</span>
        <span class="pt-item-label">${p.label}</span>
        <span class="pt-item-date">${(p.date || '').slice(5)}</span>
      </div>
      <span class="pt-item-amount">¥${(p.amount || 0).toLocaleString()}</span>
    </div>`).join('');

    wrap.innerHTML = preview.length ? renderItems(preview) : '<div style="text-align:center;color:var(--text3);padding:8px">直近の予定なし</div>';

    if (rest.length && btnAll && wrapAll) {
      btnAll.style.display = '';
      wrapAll.innerHTML = renderItems(rest);
      btnAll.onclick = () => {
        const open = wrapAll.style.display !== 'none';
        wrapAll.style.display = open ? 'none' : '';
        btnAll.textContent = open ? 'すべて見る' : '閉じる';
      };
    } else {
      if (btnAll) btnAll.style.display = 'none';
      if (wrapAll) wrapAll.style.display = 'none';
    }
  },

  renderDeductions(deductions, year) {
    const wrap = qs('#deduction-list');
    if (deductions.length === 0) {
      wrap.innerHTML = '<div class="ded-empty">基礎控除（48万円）は自動適用されます</div>';
    } else {
      wrap.innerHTML = deductions.map(d => `
        <div class="ded-item">
          <div class="ded-info"><div class="ded-name">${this.esc(d.label || d.name)}</div><div class="ded-type">${d.auto ? '自動' : ''}</div></div>
          <span class="ded-amount">¥${d.amount.toLocaleString()}</span>
          ${d.auto ? '' : `<button class="ded-del" data-id="${d.id}">✕</button>`}
        </div>`).join('');
      wrap.querySelectorAll('.ded-del').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('この控除を削除しますか？')) return;
          try {
            await this.api(`/api/deductions/${btn.dataset.id}`, { method: 'DELETE' });
            this.loadReport();
          } catch (err) { this.toast(err.message, 'error'); }
        });
      });
    }
  },

  renderDepreciations(deps) {
    const wrap = qs('#depreciation-list');
    if (deps.length === 0) {
      wrap.innerHTML = '<div class="dep-empty">減価償却資産はありません</div>';
    } else {
      wrap.innerHTML = deps.map(d => {
        const isSold = !!d.sold_date;
        const pct = d.depreciatedPercent || 0;
        const remainTxt = isSold ? '売却済み' : d.remainingMonths > 0 ? `残り${Math.floor(d.remainingMonths/12)}年${d.remainingMonths%12}ヶ月` : '償却完了';
        const statusCls = isSold ? 'sold' : d.remainingMonths <= 0 ? 'done' : '';
        return `
        <div class="dep-item ${statusCls}">
          <div class="dep-info">
            <div class="dep-name">${this.esc(d.name)} ${isSold ? '<span class="dep-sold-badge">売却済</span>' : ''}</div>
            <div class="dep-detail">取得: ¥${d.purchase_amount.toLocaleString()} ・ ${d.useful_life}年 ・ ${d.purchase_date}</div>
            <div class="dep-progress"><div class="dep-progress-fill" style="width:${pct}%"></div></div>
            <div class="dep-remain">${remainTxt}${isSold ? ` (売却額: ¥${(d.sold_amount||0).toLocaleString()})` : ''}</div>
          </div>
          <span class="dep-amount">${d.yearAmount > 0 ? `¥${d.yearAmount.toLocaleString()}/年` : '—'}</span>
          <div class="dep-actions">
            ${!isSold ? `<button class="dep-sell-btn" data-id="${d.id}" title="売却">💰</button>` : ''}
            <button class="dep-del" data-id="${d.id}">✕</button>
          </div>
        </div>`;
      }).join('');

      wrap.querySelectorAll('.dep-sell-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const soldDate = prompt('売却日（YYYY-MM-DD）:', new Date().toISOString().slice(0, 10));
          if (!soldDate) return;
          const soldAmt = prompt('売却金額（円）:');
          if (!soldAmt) return;
          try {
            await this.api(`/api/depreciations/${btn.dataset.id}/sell`, { method: 'PUT', body: JSON.stringify({ sold_date: soldDate, sold_amount: parseInt(soldAmt.replace(/[^0-9]/g, '')) }) });
            this.toast('売却を記録しました', 'success');
            this.loadReport();
          } catch (err) { this.toast(err.message, 'error'); }
        });
      });

      wrap.querySelectorAll('.dep-del').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('この資産を削除しますか？')) return;
          try {
            await this.api(`/api/depreciations/${btn.dataset.id}`, { method: 'DELETE' });
            this.loadReport();
          } catch (err) { this.toast(err.message, 'error'); }
        });
      });
    }
  },

  async openTxListModal(kind, year, category, incomeType) {
    const titleEl = qs('#tx-list-title');
    const content = qs('#tx-list-content');
    const empty = qs('#tx-list-empty');
    content.innerHTML = '<div class="overview-loading"><div class="spinner"></div></div>';
    empty.style.display = 'none';

    if (kind === 'income') {
      titleEl.textContent = incomeType ? `${this.incomeTypeIcon(incomeType)} ${this.incomeTypeName(incomeType)}` : '収入一覧';
    } else {
      titleEl.textContent = category ? `${this.categoryIcon(category)} ${this.categoryName(category)}` : '支出一覧';
    }
    this.openOverlay('tx-list');

    try {
      let items = [];
      if (kind === 'income') {
        let url = `/api/income?bookId=${this.currentBook.id}&year=${year}&include_pending=1`;
        if (incomeType) url += `&income_type=${incomeType}`;
        items = await this.api(url);
      } else {
        let url = `/api/expenses?bookId=${this.currentBook.id}&year=${year}&include_pending=1`;
        if (category) url += `&category=${category}`;
        items = await this.api(url);
      }

      if (items.length === 0) {
        content.innerHTML = '';
        empty.style.display = '';
        return;
      }

      content.innerHTML = items.map(t => {
        const isInc = kind === 'income';
        const icon = isInc ? this.incomeTypeIcon(t.income_type || 'business') : this.categoryIcon(t.category);
        const cls = isInc ? 'income' : 'expense';
        const desc = t.description || (isInc ? this.incomeTypeName(t.income_type || 'business') : this.categoryName(t.category));
        const statusLabel = t.status === 'pending' ? '<span class="txl-status pending">承認待ち</span>' : (t.status === 'approved' ? '<span class="txl-status approved">承認済</span>' : '');
        const creator = t.creator_name ? `<span class="txl-creator">by ${this.esc(t.creator_name)}</span>` : '';
        return `<div class="txl-item" data-id="${t.id}" data-kind="${kind}">
          <div class="txl-icon ${cls}">${icon}</div>
          <div class="txl-body">
            <div class="txl-desc">${this.esc(desc)}</div>
            <div class="txl-date">${t.date} ${creator}</div>
          </div>
          <div class="txl-right">
            <div class="txl-amount ${cls}">${isInc ? '+' : '-'}¥${t.amount.toLocaleString()}</div>
            ${statusLabel}
          </div>
        </div>`;
      }).join('');

      content.querySelectorAll('.txl-item').forEach(el => {
        el.addEventListener('click', () => {
          this.closeOverlay('tx-list');
          this.openEditModal(el.dataset.id, el.dataset.kind);
        });
      });
    } catch (err) {
      content.innerHTML = '';
      this.toast(err.message, 'error');
    }
  },

  renderReportChart(d) {
    const allMonths = new Set([
      ...d.monthlyIncome.map(m => m.month),
      ...d.monthlyExpense.map(m => m.month)
    ]);
    const sortedMonths = [...allMonths].sort();
    const labels = sortedMonths.map(m => {
      const parts = m.split('-');
      return parts.length === 2 ? parseInt(parts[1]) + '月' : m;
    });
    const incData = sortedMonths.map(m => (d.monthlyIncome.find(i => i.month === m) || {}).total || 0);
    const expData = sortedMonths.map(m => (d.monthlyExpense.find(e => e.month === m) || {}).total || 0);

    if (this.reportChart) this.reportChart.destroy();
    const ctx = qs('#chart-report').getContext('2d');
    this.reportChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '収入', data: incData, backgroundColor: 'rgba(34,197,94,.4)', borderRadius: 4 },
          { label: '支出', data: expData, backgroundColor: 'rgba(239,68,68,.4)', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: {
          y: { ticks: { callback: v => '¥' + (v/10000).toFixed(0) + '万' }, grid: { color: '#f1f5f9' } },
          x: { grid: { display: false } }
        }
      }
    });
  },

  renderAnalytics(d) {
    const wrap = qs('#analytics-content');
    if (!wrap) return;
    const income = d.income || 0;
    const expenses = d.expenses || 0;
    const profit = d.profit || 0;
    const taxProfit = d.taxProfitTotal || 0;
    const profitRate = income > 0 ? Math.round(profit / income * 1000) / 10 : 0;
    const expenseRate = income > 0 ? Math.round(expenses / income * 1000) / 10 : 0;

    // カテゴリ分析（tax_profit除外）
    const expCats = (d.breakdown || []).filter(b => !b.isTaxProfit);
    const totalExp = expCats.reduce((s, b) => s + b.total, 0) || 1;

    let html = `
      <div class="an-summary">
        <div class="an-kpi">
          <span class="an-kpi-val income">¥${income.toLocaleString()}</span>
          <span class="an-kpi-label">売上</span>
        </div>
        <div class="an-kpi">
          <span class="an-kpi-val expense">¥${expenses.toLocaleString()}</span>
          <span class="an-kpi-label">支出（税除く）</span>
        </div>
        <div class="an-kpi">
          <span class="an-kpi-val ${profit >= 0 ? 'income' : 'expense'}">¥${profit.toLocaleString()}</span>
          <span class="an-kpi-label">利益</span>
        </div>
      </div>
      <div class="an-rates">
        <div class="an-rate-item"><span class="an-rate-bar"><span class="an-rate-fill income" style="width:${Math.min(profitRate, 100)}%"></span></span><span class="an-rate-text">利益率 ${profitRate}%</span></div>
        <div class="an-rate-item"><span class="an-rate-bar"><span class="an-rate-fill expense" style="width:${Math.min(expenseRate, 100)}%"></span></span><span class="an-rate-text">支出率 ${expenseRate}%</span></div>
      </div>`;

    if (taxProfit > 0) {
      html += `<div class="an-tax-profit-note">📋 利益課税（所得税・住民税等）: <strong>¥${taxProfit.toLocaleString()}</strong>　※支出合計には含まず</div>`;
    }

    // カテゴリ別ドーナツチャート風の割合表示
    if (expCats.length > 0) {
      html += '<h4 class="an-section-title">カテゴリ別 支出割合 <span class="an-sub">（売上に対する比率）</span></h4>';
      html += '<div class="an-cat-list">';
      const colors = ['#6366f1','#22c55e','#f59e0b','#ef4444','#06b6d4','#8b5cf6','#ec4899','#14b8a6','#f97316','#84cc16','#64748b','#a855f7','#0ea5e9'];
      expCats.forEach((b, i) => {
        const pct = Math.round(b.total / totalExp * 1000) / 10;
        const incRatio = b.incomeRatio || 0;
        const color = colors[i % colors.length];
        html += `<div class="an-cat-row">
          <span class="an-cat-dot" style="background:${color}"></span>
          <span class="an-cat-name">${this.categoryIcon(b.category)} ${this.categoryName(b.category)}</span>
          <span class="an-cat-pct">${pct}%</span>
          <span class="an-cat-ratio">売上の${incRatio}%</span>
          <span class="an-cat-val">¥${b.total.toLocaleString()}</span>
        </div>`;
      });
      html += '</div>';
    }

    // 月別サマリーテーブル
    if (d.monthlyIncome && d.monthlyIncome.length > 0) {
      const allMonths = new Set([
        ...d.monthlyIncome.map(m => m.month),
        ...d.monthlyExpense.map(m => m.month)
      ]);
      const sorted = [...allMonths].sort();
      html += '<h4 class="an-section-title">月別サマリー</h4><div class="an-monthly-table"><table><thead><tr><th>月</th><th>売上</th><th>支出</th><th>利益</th><th>利益率</th></tr></thead><tbody>';
      sorted.forEach(m => {
        const mi = (d.monthlyIncome.find(i => i.month === m) || {}).total || 0;
        const me = (d.monthlyExpense.find(e => e.month === m) || {}).total || 0;
        const mp = mi - me;
        const mr = mi > 0 ? Math.round(mp / mi * 100) : 0;
        const mLabel = m.split('-').length === 2 ? parseInt(m.split('-')[1]) + '月' : m;
        html += `<tr><td>${mLabel}</td><td class="income">¥${mi.toLocaleString()}</td><td class="expense">¥${me.toLocaleString()}</td><td class="${mp >= 0 ? 'income' : 'expense'}">¥${mp.toLocaleString()}</td><td>${mr}%</td></tr>`;
      });
      html += '</tbody></table></div>';
    }

    wrap.innerHTML = html;
  },

  // ========================================
  // データ概要（見える化）
  // ========================================
  isAdmin() { return this.user?.role === 'admin'; },
  adminChart: null,

  async loadOverview() {
    const adminArea = qs('#admin-area');
    adminArea.style.display = this.isAdmin() ? '' : 'none';

    this.loadUserOverview();
    this.loadMyInquiries();

    if (this.isAdmin()) this.loadAdminDashboard();
  },

  async loadUserOverview() {
    qs('#user-overview-loading').style.display = 'flex';
    qs('#user-overview-content').style.display = 'none';
    try {
      const d = await this.api('/api/my/overview');
      qs('#user-overview-loading').style.display = 'none';
      qs('#user-overview-content').style.display = '';
      qs('#user-overview-content').innerHTML = d.books.map((b, idx) => {
        const total = b.incomeCount + b.expenseCount;
        return `
          <div class="ov-book" style="animation-delay:${idx*0.06}s">
            <div class="ov-book-head">
              <span class="ov-book-emoji">${b.emoji}</span>
              <span class="ov-book-name">${this.esc(b.name)}</span>
              <span class="ov-book-badge">${total}件</span>
            </div>
            <div class="ov-stats">
              <div class="ov-stat"><span class="ov-stat-val income">¥${b.incomeTotal.toLocaleString()}</span><span class="ov-stat-label">収入 (${b.incomeCount}件)</span></div>
              <div class="ov-stat"><span class="ov-stat-val expense">¥${b.expenseTotal.toLocaleString()}</span><span class="ov-stat-label">支出 (${b.expenseCount}件)</span></div>
              <div class="ov-stat"><span class="ov-stat-val neutral">${b.receiptCount}</span><span class="ov-stat-label">レシート</span></div>
            </div>
          </div>`;
      }).join('') || '<p class="empty-msg">まだデータがありません</p>';
    } catch {
      qs('#user-overview-loading').innerHTML = '<span style="color:var(--text3);font-size:13px">取得失敗</span>';
    }
  },

  async loadMyInquiries() {
    try {
      const d = await this.api('/api/my/inquiries');
      const wrap = qs('#my-inquiries');
      if (!d.items || d.items.length === 0) { wrap.innerHTML = ''; return; }
      const statusLabel = { new: '未読', in_progress: '対応中', replied: '返信あり', resolved: '解決' };
      const statusClass = { new: 'st-new', in_progress: 'st-progress', replied: 'st-replied', resolved: 'st-resolved' };
      wrap.innerHTML = `<div class="my-inq-list">${d.items.map(i => `
        <div class="my-inq-item">
          <div class="my-inq-head"><span class="my-inq-subject">${this.esc(i.subject)}</span><span class="my-inq-status ${statusClass[i.status] || ''}">${statusLabel[i.status] || i.status}</span></div>
          <div class="my-inq-msg">${this.esc(i.message).substring(0, 80)}</div>
          ${i.admin_reply ? `<div class="my-inq-reply"><strong>返信:</strong> ${this.esc(i.admin_reply)}</div>` : ''}
          <div class="my-inq-date">${i.created_at?.slice(0, 16).replace('T', ' ') || ''}</div>
        </div>`).join('')}</div>`;
    } catch {}
  },

  // ========================================
  // 管理者ダッシュボード — 運用管理
  // ========================================
  async loadAdminDashboard() {
    qs('#admin-loading').style.display = 'flex';
    try {
      const d = await this.api('/api/admin/dashboard');
      qs('#admin-loading').style.display = 'none';

      // --- システムステータス ---
      const sys = d.system;
      const uptime = this.calcUptime(sys.serverStart);
      const healthClass = sys.errors24h > 5 ? 'st-error' : sys.errors24h > 0 ? 'st-warn' : 'st-ok';
      const healthLabel = sys.errors24h > 5 ? '要注意' : sys.errors24h > 0 ? '警告あり' : '正常';
      qs('#admin-status-cards').innerHTML = `
        <div class="admin-st-card ${healthClass}">
          <div class="admin-st-icon">${sys.errors24h > 5 ? '🔴' : sys.errors24h > 0 ? '🟡' : '🟢'}</div>
          <div class="admin-st-info"><span class="admin-st-val">${healthLabel}</span><span class="admin-st-label">システム状態</span></div>
        </div>
        <div class="admin-st-card"><div class="admin-st-icon">⏱</div><div class="admin-st-info"><span class="admin-st-val">${uptime}</span><span class="admin-st-label">稼働時間</span></div></div>
        <div class="admin-st-card"><div class="admin-st-icon">🔗</div><div class="admin-st-info"><span class="admin-st-val">${sys.activeSessions}</span><span class="admin-st-label">アクティブセッション</span></div></div>
        <div class="admin-st-card"><div class="admin-st-icon">🚨</div><div class="admin-st-info"><span class="admin-st-val ${sys.errors24h > 0 ? 'val-red' : ''}">${sys.errors24h}</span><span class="admin-st-label">エラー (24h)</span></div></div>
      `;
      qs('#admin-system-section').style.display = '';

      // --- 運用 KPI ---
      const um = d.userMetrics;
      const us = d.usage;
      qs('#admin-kpi-cards').innerHTML = `
        <div class="admin-kpi-item"><span class="admin-kpi-num">${um.totalUsers}</span><span class="admin-kpi-label">登録者数</span></div>
        <div class="admin-kpi-item"><span class="admin-kpi-num kpi-green">${um.newUsersWeek}</span><span class="admin-kpi-label">新規登録 (7日)</span></div>
        <div class="admin-kpi-item"><span class="admin-kpi-num kpi-blue">${um.activeUsersToday}</span><span class="admin-kpi-label">今日の利用者</span></div>
        <div class="admin-kpi-item"><span class="admin-kpi-num">${um.activeUsersWeek}</span><span class="admin-kpi-label">7日間の利用者</span></div>
        <div class="admin-kpi-item"><span class="admin-kpi-num">${us.txToday}</span><span class="admin-kpi-label">今日の入力数</span></div>
        <div class="admin-kpi-item"><span class="admin-kpi-num">${us.txWeek}</span><span class="admin-kpi-label">7日間の入力数</span></div>
        <div class="admin-kpi-item"><span class="admin-kpi-num">${us.ocrToday}</span><span class="admin-kpi-label">レシート読取 (今日)</span></div>
        <div class="admin-kpi-item"><span class="admin-kpi-num">${us.csvToday}</span><span class="admin-kpi-label">CSV取込 (今日)</span></div>
        <div class="admin-kpi-item"><span class="admin-kpi-num">${us.totalRecords}</span><span class="admin-kpi-label">全データ件数</span></div>
        <div class="admin-kpi-item"><span class="admin-kpi-num">${um.planCounts.free || 0}</span><span class="admin-kpi-label">無料プラン</span></div>
        <div class="admin-kpi-item"><span class="admin-kpi-num kpi-purple">${um.planCounts.pro || 0}</span><span class="admin-kpi-label">Proプラン</span></div>
        <div class="admin-kpi-item"><span class="admin-kpi-num kpi-gold">${um.planCounts.business || 0}</span><span class="admin-kpi-label">法人プラン</span></div>
      `;
      qs('#admin-kpi-section').style.display = '';

      // --- 日別利用者チャート ---
      this.renderAdminChart(d.dailyActive);
      qs('#admin-chart-section').style.display = '';

      // --- エラーログ ---
      qs('#admin-error-count').textContent = sys.errorsTotal;
      if (d.recentErrors.length > 0) {
        qs('#admin-errors-list').innerHTML = d.recentErrors.map(e => `
          <div class="admin-log-item log-error">
            <div class="admin-log-head"><span class="admin-log-time">${e.created_at?.slice(5, 16).replace('T', ' ') || ''}</span><span class="admin-log-endpoint">${this.esc(e.endpoint || '')}</span></div>
            <div class="admin-log-msg">${this.esc(e.message)}</div>
            ${e.user_email ? `<div class="admin-log-user">${this.esc(e.user_email)}</div>` : ''}
          </div>
        `).join('');
        qs('#btn-clear-errors').style.display = '';
      } else {
        qs('#admin-errors-list').innerHTML = '<div class="admin-empty">エラーなし — すべて正常です</div>';
        qs('#btn-clear-errors').style.display = 'none';
      }
      qs('#admin-errors-section').style.display = '';

      // --- 問い合わせ ---
      qs('#admin-inquiry-count').textContent = d.inquiries.newCount;
      qs('#admin-inquiry-count').classList.toggle('admin-badge-new', d.inquiries.newCount > 0);
      if (d.inquiries.items.length > 0) {
        const statusLabel = { new: '新規', in_progress: '対応中', replied: '返信済み', resolved: '解決' };
        const statusIcon = { new: '🔴', in_progress: '🟡', replied: '🟢', resolved: '✅' };
        qs('#admin-inquiries-list').innerHTML = d.inquiries.items.map(i => `
          <div class="admin-inq-item" data-id="${i.id}">
            <div class="admin-inq-head">
              <span class="admin-inq-status-icon">${statusIcon[i.status] || '⚪'}</span>
              <span class="admin-inq-subject">${this.esc(i.subject)}</span>
              <span class="admin-inq-st">${statusLabel[i.status] || i.status}</span>
            </div>
            <div class="admin-inq-from">${this.esc(i.user_name)} (${this.esc(i.user_email)})</div>
            <div class="admin-inq-msg">${this.esc(i.message).substring(0, 120)}</div>
            <div class="admin-inq-date">${i.created_at?.slice(0, 16).replace('T', ' ') || ''}</div>
          </div>
        `).join('');
        qs('#admin-inquiries-list').querySelectorAll('.admin-inq-item').forEach(el => {
          el.addEventListener('click', () => this.openInquiryReply(d.inquiries.items.find(i => i.id == el.dataset.id)));
        });
      } else {
        qs('#admin-inquiries-list').innerHTML = '<div class="admin-empty">問い合わせはありません</div>';
      }
      qs('#admin-inquiries-section').style.display = '';

      // --- アクティビティ ---
      const actionIcons = { login: '🔑', register: '✨', add_income: '💰', add_expense: '🧾', csv_import: '📄', inquiry: '💬', admin_action: '🛡️' };
      qs('#admin-activity-list').innerHTML = d.recentActivity.map(a => `
        <div class="admin-log-item">
          <div class="admin-log-head"><span class="admin-log-icon">${actionIcons[a.action] || '⚡'}</span><span class="admin-log-time">${a.created_at?.slice(5, 16).replace('T', ' ') || ''}</span></div>
          <div class="admin-log-msg">${this.esc(a.details || a.action)}</div>
          ${a.user_name ? `<div class="admin-log-user">${this.esc(a.user_name)}</div>` : ''}
        </div>
      `).join('') || '<div class="admin-empty">アクティビティなし</div>';
      qs('#admin-activity-section').style.display = '';

      // --- ユーザー管理 ---
      this._adminUsers = d.users;
      this.renderAdminUserList(d.users);
      qs('#admin-users-section').style.display = '';

      // --- ランキング ---
      this.renderStorageRanking(d.users);
      qs('#admin-ranking-section').style.display = '';

      // --- ストレージ ---
      const dbMB = sys.dbSizeKB < 1024 ? `${sys.dbSizeKB} KB` : `${(sys.dbSizeKB/1024).toFixed(1)} MB`;
      const imgMB = (sys.receiptSizeKB / 1024).toFixed(1);
      const totalKB = sys.dbSizeKB + sys.receiptSizeKB;
      const totalMB = (totalKB / 1024).toFixed(1);
      const totalGB = (totalKB / 1024 / 1024).toFixed(2);
      const dbPct = totalKB ? Math.round(sys.dbSizeKB / totalKB * 100) : 0;
      const imgPct = totalKB ? Math.round(sys.receiptSizeKB / totalKB * 100) : 0;
      const userCount = um.totalUsers || 1;
      const perUserKB = Math.round(totalKB / userCount);
      const perUserTxt = perUserKB >= 1024 ? `${(perUserKB/1024).toFixed(1)} MB` : `${perUserKB} KB`;
      const perUserReceiptKB = Math.round(sys.receiptSizeKB / userCount);
      const perUserReceiptTxt = perUserReceiptKB >= 1024 ? `${(perUserReceiptKB/1024).toFixed(1)} MB` : `${perUserReceiptKB} KB`;
      qs('#admin-storage').innerHTML = `
        <div class="storage-summary">
          <div class="storage-summary-total"><span class="storage-summary-val">${totalKB >= 1048576 ? totalGB + ' GB' : totalMB + ' MB'}</span><span class="storage-summary-label">全体の使用量</span></div>
        </div>
        <div class="storage-bar-wrap"><div class="storage-bar-label"><span class="storage-bar-name">データベース</span><span class="storage-bar-val">${dbMB}</span></div><div class="storage-bar"><div class="storage-bar-fill db" style="width:${Math.max(dbPct,5)}%"></div></div></div>
        <div class="storage-bar-wrap"><div class="storage-bar-label"><span class="storage-bar-name">レシート画像</span><span class="storage-bar-val">${imgMB} MB (${sys.receiptFiles}枚)</span></div><div class="storage-bar"><div class="storage-bar-fill img" style="width:${Math.max(imgPct,5)}%"></div></div></div>
        <div class="storage-per-user">
          <div class="storage-per-user-title">1人あたりの平均</div>
          <div class="storage-per-user-grid">
            <div class="storage-per-user-item"><span class="storage-per-user-val">${perUserTxt}</span><span class="storage-per-user-label">合計容量</span></div>
            <div class="storage-per-user-item"><span class="storage-per-user-val">${perUserReceiptTxt}</span><span class="storage-per-user-label">レシート画像</span></div>
            <div class="storage-per-user-item"><span class="storage-per-user-val">${Math.round(sys.receiptFiles / userCount)}枚</span><span class="storage-per-user-label">レシート枚数</span></div>
            <div class="storage-per-user-item"><span class="storage-per-user-val">${Math.round(us.totalRecords / userCount)}件</span><span class="storage-per-user-label">データ件数</span></div>
          </div>
        </div>
        <div class="storage-cost-hint">
          <span class="storage-cost-icon">💡</span>
          <span class="storage-cost-text">100人利用時の推定: 画像 ${(perUserReceiptKB * 100 / 1024 / 1024).toFixed(1)} GB ・ 1000人: ${(perUserReceiptKB * 1000 / 1024 / 1024).toFixed(1)} GB</span>
        </div>
      `;
      qs('#admin-storage-section').style.display = '';

    } catch (err) {
      qs('#admin-loading').innerHTML = '<span style="color:var(--red);font-size:13px">管理者データ取得失敗</span>';
      console.error('Admin dashboard error:', err);
    }
  },

  renderAdminUserList(users) {
    qs('#admin-users-list').innerHTML = users.map((u, i) => {
      const avatar = u.avatar_url ? `<img src="${u.avatar_url}" alt="" class="au-avatar-img">` : `<span class="au-avatar-letter">${this.esc(u.name.charAt(0).toUpperCase())}</span>`;
      const lastAct = u.lastActivity ? u.lastActivity.slice(5, 16).replace('T', ' ') : '未使用';
      const storageTxt = u.receiptSizeKB >= 1024 ? `${(u.receiptSizeKB/1024).toFixed(1)} MB` : `${u.receiptSizeKB||0} KB`;
      return `
        <div class="au-item" style="--i:${i}" data-uid="${u.id}">
          <div class="au-avatar">${avatar}</div>
          <div class="au-info">
            <div class="au-name">${this.esc(u.name)}<span class="au-role-badge au-role-${u.role}">${u.role === 'admin' ? '管理者' : 'ユーザー'}</span></div>
            <div class="au-email">${this.esc(u.email)}</div>
            <div class="au-stats">${u.bookCount||0}帳簿 ・ ${u.totalRecords}件 ・ レシート${u.receiptCount||0}枚 (${storageTxt})</div>
            <div class="au-last">最終利用: ${lastAct}</div>
          </div>
          <div class="au-controls" onclick="event.stopPropagation()">
            <select class="au-select" data-uid="${u.id}" data-field="role"><option value="user"${u.role==='user'?' selected':''}>ユーザー</option><option value="admin"${u.role==='admin'?' selected':''}>管理者</option></select>
            <select class="au-select" data-uid="${u.id}" data-field="plan"><option value="free"${(u.plan||'free')==='free'?' selected':''}>無料</option><option value="pro"${u.plan==='pro'?' selected':''}>Pro</option><option value="business"${u.plan==='business'?' selected':''}>法人</option></select>
          </div>
        </div>
        <div class="au-detail" id="au-detail-${u.id}" style="display:none">
          <div class="au-detail-loading"><div class="spinner"></div></div>
        </div>`;
    }).join('');

    // ユーザー行タップで詳細展開
    qs('#admin-users-list').querySelectorAll('.au-item').forEach(el => {
      el.addEventListener('click', () => this.toggleUserDetail(el.dataset.uid));
    });

    // role/plan変更
    qs('#admin-users-list').querySelectorAll('.au-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        const body = {}; body[sel.dataset.field] = sel.value;
        try {
          await this.api(`/api/admin/user/${sel.dataset.uid}`, { method: 'PUT', body: JSON.stringify(body) });
          this.toast(`${sel.dataset.field === 'role' ? '権限' : 'プラン'}を変更しました`, 'success');
        } catch (err) { this.toast(err.message, 'error'); }
      });
    });
  },

  async toggleUserDetail(uid) {
    const panel = qs(`#au-detail-${uid}`);
    if (!panel) return;
    if (panel.style.display !== 'none') {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = '';
    panel.innerHTML = '<div class="au-detail-loading"><div class="spinner"></div></div>';
    try {
      const d = await this.api(`/api/admin/user/${uid}/detail`);
      const u = d.user;
      const booksHtml = d.books.map(b => {
        const bStorage = b.receiptSizeKB >= 1024 ? `${(b.receiptSizeKB/1024).toFixed(1)} MB` : `${b.receiptSizeKB} KB`;
        return `
          <div class="aud-book">
            <div class="aud-book-head"><span>${b.emoji} ${this.esc(b.name)}</span></div>
            <div class="aud-book-stats">
              <span>収入 ${b.incomeCount}件 (¥${b.incomeTotal.toLocaleString()})</span>
              <span>支出 ${b.expenseCount}件 (¥${b.expenseTotal.toLocaleString()})</span>
              <span>レシート ${b.receiptCount}枚 (${bStorage})</span>
            </div>
          </div>`;
      }).join('') || '<div class="aud-empty">帳簿なし</div>';

      const monthlyHtml = d.monthly.map(m => {
        const total = m.income + m.expense;
        const label = m.month.replace(/^(\d{4})-(\d{2})$/, (_, y, mo) => `${parseInt(mo)}月`);
        return `<div class="aud-month"><span class="aud-month-label">${label}</span><span class="aud-month-bar"><span class="aud-month-fill" style="width:${Math.min(total * 4, 100)}%"></span></span><span class="aud-month-num">${total}件</span></div>`;
      }).join('');

      const actsHtml = d.recentActivity.map(a => {
        const t = a.created_at ? a.created_at.slice(5, 16).replace('T', ' ') : '';
        return `<div class="aud-act"><span class="aud-act-time">${t}</span><span class="aud-act-text">${this.esc(a.details || a.action)}</span></div>`;
      }).join('') || '<div class="aud-empty">アクティビティなし</div>';

      const totalStorage = d.books.reduce((s, b) => s + b.receiptSizeKB, 0);
      const tsTxt = totalStorage >= 1024 ? `${(totalStorage/1024).toFixed(1)} MB` : `${totalStorage} KB`;

      panel.innerHTML = `
        <div class="aud-section">
          <div class="aud-title">使用容量</div>
          <div class="aud-storage-total">${tsTxt}</div>
        </div>
        <div class="aud-section">
          <div class="aud-title">帳簿別の内訳</div>
          ${booksHtml}
        </div>
        <div class="aud-section">
          <div class="aud-title">月別の入力数（6ヶ月）</div>
          ${monthlyHtml}
        </div>
        <div class="aud-section">
          <div class="aud-title">最近の操作</div>
          ${actsHtml}
        </div>`;
    } catch (err) {
      panel.innerHTML = `<div class="aud-empty">読み込みに失敗しました</div>`;
    }
  },

  renderStorageRanking(users) {
    const sorted = [...users].sort((a, b) => (b.receiptSizeKB||0) - (a.receiptSizeKB||0));
    const maxKB = sorted[0]?.receiptSizeKB || 1;
    const medals = ['🥇', '🥈', '🥉'];

    // 容量ランキング
    const storageHtml = sorted.map((u, i) => {
      const txt = u.receiptSizeKB >= 1024 ? `${(u.receiptSizeKB/1024).toFixed(1)} MB` : `${u.receiptSizeKB||0} KB`;
      const pct = maxKB ? Math.round((u.receiptSizeKB||0) / maxKB * 100) : 0;
      const medal = i < 3 ? medals[i] : `<span class="rank-num">${i+1}</span>`;
      return `
        <div class="rank-row">
          <span class="rank-medal">${medal}</span>
          <span class="rank-name">${this.esc(u.name)}</span>
          <span class="rank-bar"><span class="rank-fill" style="width:${Math.max(pct,3)}%"></span></span>
          <span class="rank-val">${txt}</span>
        </div>`;
    }).join('');

    // 利用頻度ランキング
    const sortedByRecords = [...users].sort((a, b) => (b.totalRecords||0) - (a.totalRecords||0));
    const maxRec = sortedByRecords[0]?.totalRecords || 1;
    const recordsHtml = sortedByRecords.map((u, i) => {
      const pct = maxRec ? Math.round((u.totalRecords||0) / maxRec * 100) : 0;
      const medal = i < 3 ? medals[i] : `<span class="rank-num">${i+1}</span>`;
      return `
        <div class="rank-row">
          <span class="rank-medal">${medal}</span>
          <span class="rank-name">${this.esc(u.name)}</span>
          <span class="rank-bar"><span class="rank-fill rank-fill-blue" style="width:${Math.max(pct,3)}%"></span></span>
          <span class="rank-val">${u.totalRecords||0}件</span>
        </div>`;
    }).join('');

    qs('#admin-ranking').innerHTML = `
      <div class="rank-section">
        <div class="rank-title">💾 容量の使用量</div>
        ${storageHtml}
      </div>
      <div class="rank-section">
        <div class="rank-title">📊 データ入力数</div>
        ${recordsHtml}
      </div>`;
  },

  calcUptime(startISO) {
    const diff = Date.now() - new Date(startISO).getTime();
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (hrs >= 24) { const days = Math.floor(hrs / 24); return `${days}日${hrs % 24}時間`; }
    return `${hrs}時間${mins}分`;
  },

  renderAdminChart(dailyActive) {
    if (this.adminChart) this.adminChart.destroy();
    const ctx = qs('#admin-daily-chart').getContext('2d');
    this.adminChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dailyActive.map(d => { const p = d.date.split('-'); return `${parseInt(p[1])}/${parseInt(p[2])}`; }),
        datasets: [{
          label: '日別利用者数',
          data: dailyActive.map(d => d.count),
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99,102,241,.1)',
          fill: true, tension: 0.4, borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#6366f1'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } }
      }
    });
  },

  openInquiryReply(inq) {
    if (!inq) return;
    qs('#admin-reply-title').textContent = `返信: ${inq.subject}`;
    qs('#admin-reply-detail').innerHTML = `
      <div class="admin-reply-from"><strong>${this.esc(inq.user_name)}</strong> (${this.esc(inq.user_email)})<br><span class="admin-reply-date">${inq.created_at?.slice(0, 16).replace('T', ' ') || ''}</span></div>
      <div class="admin-reply-msg">${this.esc(inq.message)}</div>
    `;
    qs('#reply-inq-id').value = inq.id;
    qs('#reply-message').value = inq.admin_reply || '';
    qs('#reply-status').value = inq.status === 'new' ? 'replied' : inq.status;
    this.openOverlay('admin-reply');
  },

  fmtNum(n) {
    if (n >= 10000000) return (n/10000000).toFixed(1) + '千万';
    if (n >= 10000) return Math.round(n/10000) + '万';
    return n.toLocaleString();
  },

  // ========================================
  // 設定
  // ========================================
  setupSettings() {
    this.renderProfileForm();
    qs('#btn-add-book').addEventListener('click', () => this.openOverlay('add-book'));
    qs('#btn-logout').addEventListener('click', () => this.logout());
    qs('#btn-backup').addEventListener('click', () => {
      if (this.currentBook) window.open(`/api/export?bookId=${this.currentBook.id}`, '_blank');
    });
    qs('#btn-csv-open').addEventListener('click', () => {
      this.openOverlay('csv');
      qs('#csv-file').value = '';
      qs('#csv-step-upload').style.display = '';
      qs('#csv-step-preview').style.display = 'none';
      qs('#csv-loading').style.display = 'none';
    });

    // レシートZIPエクスポート（設定画面）
    const thisYear = new Date().getFullYear();
    const receiptStart = qs('#receipt-start');
    const receiptEnd = qs('#receipt-end');
    if (receiptStart) receiptStart.value = `${thisYear}-01-01`;
    if (receiptEnd) receiptEnd.value = new Date().toISOString().slice(0, 10);
    qs('#btn-export-receipts')?.addEventListener('click', () => this.exportReceipts());

    // 帳簿追加
    // 個人/法人切り替えで期首月を表示制御
    const etSel = qs('#book-entity-type');
    const fmGroup = qs('#fiscal-month-group');
    if (etSel && fmGroup) {
      etSel.addEventListener('change', () => {
        fmGroup.style.display = etSel.value === 'corporate' ? '' : 'none';
      });
    }

    qs('#form-add-book').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = qs('#book-name').value.trim();
      const emojiEl = qs('#emoji-picker .ep.selected');
      const emoji = emojiEl ? emojiEl.dataset.e : '📒';
      const entity_type = qs('#book-entity-type')?.value || 'individual';
      const fiscal_start_month = entity_type === 'corporate' ? (parseInt(qs('#book-fiscal-month')?.value) || 4) : 1;
      try {
        await this.api('/api/books', { method: 'POST', body: JSON.stringify({ name, emoji, entity_type, fiscal_start_month }) });
        const me = await this.api('/api/auth/me');
        this.books = me.books;
        this.closeOverlay('add-book');
        qs('#form-add-book').reset();
        this.renderBookList();
        this.toast('帳簿を追加しました', 'success');
      } catch (err) { this.toast(err.message, 'error'); }
    });

    // Emoji picker
    qs('#emoji-picker').addEventListener('click', (e) => {
      const ep = e.target.closest('.ep');
      if (!ep) return;
      qs('#emoji-picker').querySelectorAll('.ep').forEach(x => x.classList.remove('selected'));
      ep.classList.add('selected');
    });

    // 問い合わせ
    qs('#btn-open-inquiry').addEventListener('click', () => this.openOverlay('inquiry'));
    qs('#close-inquiry').addEventListener('click', () => this.closeOverlay('inquiry'));
    qs('#form-inquiry').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await this.api('/api/inquiry', { method: 'POST', body: JSON.stringify({ subject: qs('#inq-subject').value, message: qs('#inq-message').value }) });
        this.closeOverlay('inquiry');
        qs('#form-inquiry').reset();
        this.toast('問い合わせを送信しました', 'success');
        this.loadMyInquiries();
      } catch (err) { this.toast(err.message, 'error'); }
    });

    // 管理者: 問い合わせ返信
    qs('#close-admin-reply').addEventListener('click', () => this.closeOverlay('admin-reply'));
    qs('#form-admin-reply').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await this.api(`/api/admin/inquiries/${qs('#reply-inq-id').value}`, { method: 'PUT', body: JSON.stringify({ status: qs('#reply-status').value, admin_reply: qs('#reply-message').value }) });
        this.closeOverlay('admin-reply');
        this.toast('返信しました', 'success');
        this.loadAdminDashboard();
      } catch (err) { this.toast(err.message, 'error'); }
    });

    // 管理者: エラーログクリア
    qs('#btn-clear-errors').addEventListener('click', async () => {
      if (!confirm('エラーログをすべてクリアしますか？')) return;
      try {
        await this.api('/api/admin/errors', { method: 'DELETE' });
        this.toast('ログをクリアしました', 'success');
        this.loadAdminDashboard();
      } catch (err) { this.toast(err.message, 'error'); }
    });

    // ユーザーメニュー
    qs('#user-menu-btn').addEventListener('click', () => {
      qs('#user-menu-name').textContent = this.user?.name || '';
      qs('#user-menu-email').textContent = this.user?.email || '';
      this.openOverlay('user-menu');
    });
    qs('#btn-logout2').addEventListener('click', () => { this.closeOverlay('user-menu'); this.logout(); });

    // 帳簿セレクタ
    qs('#book-selector-btn').addEventListener('click', () => this.openBookSelector());
  },

  renderBookList() {
    const wrap = qs('#book-list');
    wrap.innerHTML = this.books.map(b => {
      const isOwnerOrMgr = b.memberRole === 'owner' || b.memberRole === 'manager';
      const roleLabel = b.memberRole === 'owner' ? '' : b.memberRole === 'manager' ? '<span class="book-role-badge mgr">管理者</span>' : '<span class="book-role-badge mem">メンバー</span>';
      return `
      <div class="book-item${b.id === this.currentBook?.id ? ' active' : ''}" data-id="${b.id}">
        <span class="book-item-emoji">${b.emoji}</span>
        <span class="book-item-name">${this.esc(b.name)}${roleLabel}</span>
        <div class="book-item-actions">
          ${isOwnerOrMgr ? `<button class="book-item-btn" data-action="members" data-id="${b.id}" title="メンバー管理">👥</button>` : ''}
          ${b.memberRole === 'owner' ? `<button class="book-item-btn danger" data-action="delete" data-id="${b.id}" title="削除">✕</button>` : ''}
        </div>
      </div>`;
    }).join('');
    wrap.querySelectorAll('.book-item-btn[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('この帳簿を削除しますか？データも全て消えます。')) return;
        try {
          await this.api(`/api/books/${btn.dataset.id}`, { method: 'DELETE' });
          const me = await this.api('/api/auth/me');
          this.books = me.books;
          if (this.currentBook?.id == btn.dataset.id) {
            this.currentBook = this.books[0];
            this.updateTopbar();
            this.loadDashboard();
          }
          this.renderBookList();
          this.toast('帳簿を削除しました');
        } catch (err) { this.toast(err.message, 'error'); }
      });
    });
    wrap.querySelectorAll('.book-item-btn[data-action="members"]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.openMemberManager(btn.dataset.id); });
    });
  },

  async openMemberManager(bookId) {
    this._memberBookId = bookId;
    const book = this.books.find(b => b.id == bookId);
    qs('#members-title').textContent = `${book?.emoji || '📒'} ${book?.name || '帳簿'} のメンバー`;
    this.openOverlay('members');
    qs('#members-list').innerHTML = '<div class="overview-loading"><div class="spinner"></div></div>';
    try {
      const d = await this.api(`/api/books/${bookId}/members`);
      this._memberData = d;
      this.renderMemberList(d, bookId);
    } catch (err) { qs('#members-list').innerHTML = `<div class="aud-empty">${err.message}</div>`; }

    // 追加ボタン
    qs('#btn-add-member').onclick = async () => {
      const email = qs('#member-email').value.trim();
      if (!email) { this.toast('メールアドレスを入力してください', 'error'); return; }
      try {
        await this.api(`/api/books/${bookId}/members`, { method: 'POST', body: JSON.stringify({
          email,
          role: qs('#mp-role').value,
          can_input_expense: qs('#mp-expense-input').checked,
          can_input_income: qs('#mp-income-input').checked,
          can_view_income: qs('#mp-income-view').checked,
          can_view_all_expenses: qs('#mp-expense-view').checked
        })});
        this.toast('メンバーを追加しました', 'success');
        qs('#member-email').value = '';
        this.openMemberManager(bookId);
      } catch (err) { this.toast(err.message, 'error'); }
    };

    // モーダルクローズ
    qs('#close-members').onclick = () => this.closeOverlay('members');
  },

  renderMemberList(data, bookId) {
    const { owner, members } = data;
    const permLabel = (v) => v ? '✓' : '—';
    let html = `
      <div class="mem-item mem-owner">
        <div class="mem-avatar">${owner.avatar_url ? `<img src="${owner.avatar_url}">` : owner.name.charAt(0).toUpperCase()}</div>
        <div class="mem-info">
          <div class="mem-name">${this.esc(owner.name)} <span class="mem-badge owner">オーナー</span></div>
          <div class="mem-email">${this.esc(owner.email)}</div>
        </div>
      </div>`;

    if (members.length === 0) {
      html += '<div class="mem-empty">まだメンバーがいません</div>';
    } else {
      members.forEach(m => {
        const roleBadge = m.role === 'manager' ? '<span class="mem-badge mgr">管理者</span>' : '<span class="mem-badge mem">メンバー</span>';
        html += `
          <div class="mem-item">
            <div class="mem-avatar">${m.avatar_url ? `<img src="${m.avatar_url}">` : m.name.charAt(0).toUpperCase()}</div>
            <div class="mem-info">
              <div class="mem-name">${this.esc(m.name)} ${roleBadge}</div>
              <div class="mem-email">${this.esc(m.email)}</div>
              <div class="mem-perms">
                <span class="mem-perm ${m.can_input_expense ? 'on' : ''}">支出入力${permLabel(m.can_input_expense)}</span>
                <span class="mem-perm ${m.can_input_income ? 'on' : ''}">収入入力${permLabel(m.can_input_income)}</span>
                <span class="mem-perm ${m.can_view_income ? 'on' : ''}">収入閲覧${permLabel(m.can_view_income)}</span>
                <span class="mem-perm ${m.can_view_all_expenses ? 'on' : ''}">全支出閲覧${permLabel(m.can_view_all_expenses)}</span>
              </div>
            </div>
            <div class="mem-actions">
              <select class="au-select mem-role-sel" data-mid="${m.id}">
                <option value="member"${m.role==='member'?' selected':''}>メンバー</option>
                <option value="manager"${m.role==='manager'?' selected':''}>管理者</option>
              </select>
              <button class="mem-remove-btn" data-mid="${m.id}" title="削除">✕</button>
            </div>
          </div>`;
      });
    }
    qs('#members-list').innerHTML = html;

    // 権限変更
    qs('#members-list').querySelectorAll('.mem-role-sel').forEach(sel => {
      sel.addEventListener('change', async () => {
        try {
          await this.api(`/api/books/${bookId}/members/${sel.dataset.mid}`, { method: 'PUT', body: JSON.stringify({ role: sel.value }) });
          this.toast('権限を変更しました', 'success');
        } catch (err) { this.toast(err.message, 'error'); }
      });
    });

    // 削除
    qs('#members-list').querySelectorAll('.mem-remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('このメンバーを外しますか？')) return;
        try {
          await this.api(`/api/books/${bookId}/members/${btn.dataset.mid}`, { method: 'DELETE' });
          this.toast('メンバーを外しました', 'success');
          this.openMemberManager(bookId);
        } catch (err) { this.toast(err.message, 'error'); }
      });
    });
  },

  openBookSelector() {
    this.openOverlay('book-select');
    const list = qs('#book-select-list');
    list.innerHTML = this.books.map(b => `
      <div class="book-select-item${b.id===this.currentBook?.id?' active':''}" data-id="${b.id}">
        <span class="book-select-emoji">${b.emoji}</span>
        <span class="book-select-name">${this.esc(b.name)}</span>
      </div>
    `).join('');
    list.querySelectorAll('.book-select-item').forEach(el => {
      el.addEventListener('click', () => {
        this.currentBook = this.books.find(b => b.id == el.dataset.id);
        this.updateTopbar();
        this.closeOverlay('book-select');
        this.loadDashboard();
        this.toast(`${this.currentBook.emoji} ${this.currentBook.name} に切り替えました`);
      });
    });
  },

  // ========================================
  // CSV
  // ========================================
  csvRows: [],

  setupCSV() {
    qs('#csv-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      qs('#csv-loading').style.display = 'flex';
      const fd = new FormData();
      fd.append('csv', file);
      try {
        const res = await fetch(BASE + '/api/preview-csv', { method: 'POST', body: fd, credentials: 'same-origin' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        this.csvRows = data.rows;
        this.renderCsvPreview();
      } catch (err) { this.toast(err.message, 'error'); qs('#csv-loading').style.display = 'none'; }
    });

    qs('#csv-back').addEventListener('click', () => {
      qs('#csv-step-upload').style.display = '';
      qs('#csv-step-preview').style.display = 'none';
      qs('#csv-file').value = '';
    });

    qs('#csv-check-all').addEventListener('change', (e) => {
      qs('#csv-tbody').querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = e.target.checked; });
      this.updateCsvCount();
    });

    qs('#btn-csv-import').addEventListener('click', () => this.importCsv());
  },

  renderCsvPreview() {
    qs('#csv-step-upload').style.display = 'none';
    qs('#csv-loading').style.display = 'none';
    qs('#csv-step-preview').style.display = '';
    qs('#csv-count').textContent = `${this.csvRows.length}件のデータ`;

    const catOpts = this.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    qs('#csv-tbody').innerHTML = this.csvRows.map((r, i) => `
      <tr style="animation:tx-in .3s both;animation-delay:${i*0.03}s">
        <td><input type="checkbox" class="csv-row-check" data-idx="${i}" checked></td>
        <td>${r.date}</td>
        <td>¥${r.amount.toLocaleString()}</td>
        <td>${this.esc(r.description)}</td>
        <td><select class="csv-cat-sel" data-idx="${i}">${catOpts}</select></td>
      </tr>
    `).join('');

    // 推定カテゴリをセット
    this.csvRows.forEach((r, i) => {
      const sel = qs(`select[data-idx="${i}"]`);
      if (sel) sel.value = r.category || 'misc';
    });

    qs('#csv-tbody').querySelectorAll('.csv-row-check').forEach(cb => {
      cb.addEventListener('change', () => this.updateCsvCount());
    });
    this.updateCsvCount();
  },

  updateCsvCount() {
    const checked = qs('#csv-tbody').querySelectorAll('.csv-row-check:checked').length;
    qs('#csv-selected').textContent = `${checked}件選択中`;
  },

  async importCsv() {
    const rows = [];
    qs('#csv-tbody').querySelectorAll('.csv-row-check:checked').forEach(cb => {
      const i = parseInt(cb.dataset.idx);
      const sel = qs(`select[data-idx="${i}"]`);
      rows.push({ ...this.csvRows[i], category: sel ? sel.value : 'misc' });
    });
    if (!rows.length) { this.toast('行を選択してください', 'error'); return; }

    try {
      const res = await this.api('/api/import-csv', {
        method: 'POST',
        body: JSON.stringify({ bookId: this.currentBook.id, rows })
      });
      this.closeOverlay('csv');
      this.toast(`${res.imported}件登録しました！`, 'success');
      this.loadDashboard();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  // ========================================
  // 取引履歴
  // ========================================
  setupHistory() {
    const ySel = qs('#hist-year');
    const thisY = new Date().getFullYear();
    for (let y = thisY; y >= thisY - 3; y--) ySel.innerHTML += `<option value="${y}">${y}年</option>`;
    ySel.addEventListener('change', () => this.loadHistory());
    qs('#hist-month').addEventListener('change', () => this.loadHistory());
    qs('#hist-type').addEventListener('change', () => this.loadHistory());
    qs('#btn-back-home').addEventListener('click', () => this.navigate('home'));
  },

  async loadHistory() {
    if (!this.currentBook) return;
    const y = qs('#hist-year').value;
    const m = qs('#hist-month').value;
    const t = qs('#hist-type').value;
    const isOwner = this.currentBook.memberRole === 'owner' || this.currentBook.memberRole === 'manager';
    const pendingParam = isOwner ? '&include_pending=1' : '';
    try {
      let txs = [];
      if (!t || t === 'income') {
        const inc = await this.api(`/api/income?bookId=${this.currentBook.id}&year=${y}${m?'&month='+m:''}${pendingParam}`);
        txs = txs.concat(inc.map(i => ({ ...i, kind: 'income', category: i.type })));
      }
      if (!t || t === 'expense') {
        const exp = await this.api(`/api/expenses?bookId=${this.currentBook.id}&year=${y}${m?'&month='+m:''}${pendingParam}`);
        txs = txs.concat(exp.map(e => ({ ...e, kind: 'expense' })));
      }
      txs.sort((a,b) => b.date > a.date ? 1 : b.date < a.date ? -1 : 0);
      this.renderTransactions(txs, 'hist-transactions', 'hist-empty');
    } catch (err) { this.toast(err.message, 'error'); }
  },

  // ========================================
  // モーダル群
  // ========================================
  _incSelectedType: 'business',
  setupModals() {
    // 収入モーダル
    qs('#close-income').addEventListener('click', () => this.closeOverlay('income'));
    this._incSelectedType = 'business';
    this.renderHierarchicalCategories('inc-income-type-wrap', this.incomeGroups, 'business', (id) => { this._incSelectedType = id; });
    qs('#form-income').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await this.api('/api/income', {
          method: 'POST',
          body: JSON.stringify({
            bookId: this.currentBook.id,
            date: qs('#inc-date').value,
            amount: qs('#inc-amount').value,
            type: qs('#inc-type').value,
            income_type: this._incSelectedType,
            description: qs('#inc-desc').value,
            taxable: parseInt(qs('#inc-taxable')?.value ?? '1')
          })
        });
        this.closeOverlay('income');
        qs('#form-income').reset();
        this.toast('収入を記録しました', 'success');
        this.loadDashboard();
      } catch (err) { this.toast(err.message, 'error'); }
    });

    // 手動支出モーダル
    qs('#close-manual').addEventListener('click', () => this.closeOverlay('manual'));
    this.buildCatChips('me-cats');
    qs('#form-manual-expense').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this._meSelectedCat) { this.toast('科目を選択してください', 'error'); return; }
      try {
        await this.api('/api/expense', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookId: this.currentBook.id,
            date: qs('#me-date').value,
            amount: qs('#me-amount').value,
            category: this._meSelectedCat,
            description: qs('#me-desc').value
          })
        });
        this.closeOverlay('manual');
        qs('#form-manual-expense').reset();
        this._meSelectedCat = null;
        qs('#me-cats').querySelectorAll('.hcat-item').forEach(c => c.classList.remove('selected'));
        this.toast('支出を記録しました', 'success');
        this.loadDashboard();
      } catch (err) { this.toast(err.message, 'error'); }
    });

    // 編集モーダル
    qs('#close-edit').addEventListener('click', () => this.closeOverlay('edit'));
    this.buildCatSelect('edit-category');
    qs('#form-edit').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = qs('#edit-id').value;
      const kind = qs('#edit-kind').value;
      const url = kind === 'income' ? `/api/income/${id}` : `/api/expense/${id}`;
      const body = {
        date: qs('#edit-date').value,
        amount: qs('#edit-amount').value,
        description: qs('#edit-desc').value
      };
      if (kind === 'expense') body.category = qs('#edit-category').value;
      else { body.type = '振込'; body.income_type = this._editSelectedIncType || 'business'; }
      try {
        await this.api(url, { method: 'PUT', body: JSON.stringify(body) });
        this.closeOverlay('edit');
        this.toast('更新しました', 'success');
        this.loadDashboard();
        if (qs('#view-history').classList.contains('active')) this.loadHistory();
      } catch (err) { this.toast(err.message, 'error'); }
    });

    qs('#btn-edit-delete').addEventListener('click', async () => {
      if (!confirm('削除しますか？')) return;
      const id = qs('#edit-id').value;
      const kind = qs('#edit-kind').value;
      const url = kind === 'income' ? `/api/income/${id}` : `/api/expense/${id}`;
      try {
        await this.api(url, { method: 'DELETE' });
        this.closeOverlay('edit');
        this.toast('削除しました');
        this.loadDashboard();
        if (qs('#view-history').classList.contains('active')) this.loadHistory();
      } catch (err) { this.toast(err.message, 'error'); }
    });

    // 一覧モーダル
    qs('#close-tx-list').addEventListener('click', () => this.closeOverlay('tx-list'));

    // 帳簿追加クローズ
    qs('#close-add-book').addEventListener('click', () => this.closeOverlay('add-book'));
    qs('#close-book-select').addEventListener('click', () => this.closeOverlay('book-select'));
    qs('#close-csv').addEventListener('click', () => this.closeOverlay('csv'));
    qs('#close-user-menu').addEventListener('click', () => this.closeOverlay('user-menu'));

    // デフォルト日付
    const today = new Date().toISOString().slice(0, 10);
    if (qs('#inc-date')) qs('#inc-date').value = today;
    if (qs('#me-date')) qs('#me-date').value = today;
  },

  _meSelectedCat: null,
  buildCatChips(containerId) {
    this._meSelectedCat = null;
    this.renderHierarchicalCategories(containerId, this.expenseGroups, null, (id) => { this._meSelectedCat = id; });
  },

  buildCatSelect(selectId) {
    const sel = qs(`#${selectId}`);
    sel.innerHTML = this.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  },

  async openEditModal(id, kind) {
    try {
      // 詳細APIで1件取得（記入者・承認者情報付き）
      const url = kind === 'income' ? `/api/income/${id}` : `/api/expense/${id}`;
      let item;
      try {
        item = await this.api(url);
      } catch {
        // フォールバック: 一覧から取得
        if (kind === 'income') {
          const inc = await this.api(`/api/income?bookId=${this.currentBook.id}&include_pending=1`);
          item = inc.find(i => i.id == id);
        } else {
          const exp = await this.api(`/api/expenses?bookId=${this.currentBook.id}&include_pending=1`);
          item = exp.find(e => e.id == id);
        }
      }
      if (!item) { this.toast('データが見つかりません', 'error'); return; }

      qs('#edit-id').value = item.id;
      qs('#edit-kind').value = kind;
      qs('#edit-title').textContent = kind === 'income' ? '収入を編集' : '支出を編集';
      qs('#edit-date').value = item.date;
      qs('#edit-amount').value = item.amount;
      qs('#edit-desc').value = item.description || '';
      qs('#edit-cat-group').style.display = kind === 'expense' ? '' : 'none';
      qs('#edit-income-type-group').style.display = kind === 'income' ? '' : 'none';
      if (kind === 'expense') qs('#edit-category').value = item.category;
      if (kind === 'income') {
        this._editSelectedIncType = item.income_type || 'business';
        this.renderHierarchicalCategories('edit-income-type-wrap', this.incomeGroups, this._editSelectedIncType, (id) => { this._editSelectedIncType = id; });
      }

      // 詳細情報エリア表示
      const detailArea = qs('#edit-detail-area');
      const receiptPreview = qs('#edit-receipt-preview');
      const metaGrid = qs('#edit-meta-grid');

      detailArea.style.display = '';
      let metaHtml = '';

      // レシート画像
      if (kind === 'expense' && item.receipt_path) {
        receiptPreview.style.display = '';
        qs('#edit-receipt-img').src = BASE + item.receipt_path;
      } else {
        receiptPreview.style.display = 'none';
      }

      // 記入者情報
      if (item.creator_name) {
        metaHtml += `<div class="edit-meta-item"><span class="edit-meta-label">記入者</span><span class="edit-meta-val">👤 ${this.esc(item.creator_name)}${item.creator_email ? ' (' + this.esc(item.creator_email) + ')' : ''}</span></div>`;
      }

      // ステータス
      if (item.status) {
        const statusLabels = { approved: '✅ 承認済み', pending: '⏳ 承認待ち', rejected: '❌ 却下' };
        metaHtml += `<div class="edit-meta-item"><span class="edit-meta-label">ステータス</span><span class="edit-meta-val edit-meta-status-${item.status}">${statusLabels[item.status] || item.status}</span></div>`;
      }

      // 承認情報
      if (item.approved_at && item.approver_name) {
        metaHtml += `<div class="edit-meta-item"><span class="edit-meta-label">承認者</span><span class="edit-meta-val">🛡 ${this.esc(item.approver_name)} (${item.approved_at.slice(0, 16).replace('T', ' ')})</span></div>`;
      }

      // 入力方法
      if (kind === 'expense' && item.source) {
        const sourceLabels = { manual: '✏️ 手動入力', ocr: '📷 レシート読取', csv: '📄 CSV取込' };
        metaHtml += `<div class="edit-meta-item"><span class="edit-meta-label">入力方法</span><span class="edit-meta-val">${sourceLabels[item.source] || item.source}</span></div>`;
      }

      // 作成・更新日時
      if (item.created_at) {
        metaHtml += `<div class="edit-meta-item"><span class="edit-meta-label">作成</span><span class="edit-meta-val">${item.created_at.slice(0, 16).replace('T', ' ')}</span></div>`;
      }
      if (item.updated_at && item.updated_at !== item.created_at) {
        metaHtml += `<div class="edit-meta-item"><span class="edit-meta-label">更新</span><span class="edit-meta-val">${item.updated_at.slice(0, 16).replace('T', ' ')}</span></div>`;
      }

      metaGrid.innerHTML = metaHtml || '';

      this.openOverlay('edit');
    } catch (err) { this.toast(err.message, 'error'); }
  },

  // ========================================
  // オーバーレイ管理
  // ========================================
  openOverlay(name) {
    const el = qs(`#overlay-${name}`);
    if (el) {
      el.style.display = 'flex';
      // 背景クリックで閉じる (scanning/success以外)
      if (!['scanning', 'success'].includes(name)) {
        el._bgClose = (e) => { if (e.target === el) this.closeOverlay(name); };
        el.addEventListener('click', el._bgClose);
      }
    }
  },
  closeOverlay(name) {
    const el = qs(`#overlay-${name}`);
    if (el) {
      el.style.display = 'none';
      if (el._bgClose) { el.removeEventListener('click', el._bgClose); el._bgClose = null; }
    }
  },

  // ========================================
  // ユーティリティ
  // ========================================
  esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  },
  fmtDate(d) {
    if (!d) return '';
    const [y, m, dd] = d.split('-');
    return `${parseInt(m)}/${parseInt(dd)}`;
  }
};

// ショートカット
function qs(sel) { return document.querySelector(sel); }

// 起動
document.addEventListener('DOMContentLoaded', () => App.init());
