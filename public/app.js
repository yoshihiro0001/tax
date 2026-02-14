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

  categories: [
    { id: 'travel', name: '旅費交通費', icon: '🚃' },
    { id: 'communication', name: '通信費', icon: '📱' },
    { id: 'supplies', name: '消耗品費', icon: '📦' },
    { id: 'advertising', name: '広告宣伝費', icon: '📢' },
    { id: 'entertainment', name: '接待交際費', icon: '🍽' },
    { id: 'outsourcing', name: '外注工賃', icon: '🤝' },
    { id: 'fees', name: '支払手数料', icon: '🏦' },
    { id: 'home_office', name: '家事按分', icon: '🏠' },
    { id: 'depreciation', name: '減価償却費', icon: '💻' },
    { id: 'misc', name: '雑費', icon: '📌' }
  ],

  categoryName(id) {
    const c = this.categories.find(c => c.id === id);
    return c ? c.name : id;
  },
  categoryIcon(id) {
    const c = this.categories.find(c => c.id === id);
    return c ? c.icon : '📌';
  },

  // ========================================
  // 初期化
  // ========================================
  async init() {
    try {
      const res = await this.api('/api/auth/me');
      this.user = res.user;
      this.books = res.books;
      this.currentBook = this.books[0] || null;
      this.showApp();
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
    if (view === 'settings') this.renderBookList();
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
  setupHome() {
    qs('#receipt-input').addEventListener('change', (e) => {
      if (e.target.files[0]) this.startOcr(e.target.files[0]);
    });
    qs('#btn-add-income').addEventListener('click', () => this.openOverlay('income'));
    qs('#btn-add-manual').addEventListener('click', () => this.openOverlay('manual'));
    qs('#btn-view-all').addEventListener('click', () => {
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      qs('#view-history').classList.add('active');
      document.querySelectorAll('.bnav-item').forEach(b => b.classList.remove('active'));
      this.loadHistory();
    });
  },

  async loadDashboard() {
    if (!this.currentBook) return;
    try {
      const d = await this.api(`/api/dashboard?bookId=${this.currentBook.id}`);
      qs('#home-expense').textContent = `¥${d.monthExpense.toLocaleString()}`;
      qs('#home-income').textContent = `¥${d.monthIncome.toLocaleString()}`;
      this.renderTransactions(d.recentTransactions, 'home-transactions', 'home-empty');
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
      return `<div class="tx-item" style="--i:${i}" data-id="${t.id}" data-kind="${t.kind}">
        <div class="tx-icon ${cls}">${icon}</div>
        <div class="tx-info"><div class="tx-desc">${this.esc(desc)}</div><div class="tx-date">${this.fmtDate(t.date)}</div></div>
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
    grid.innerHTML = this.categories.map(c =>
      `<button type="button" class="cf-chip${c.id===suggested?' active':''}" data-cat="${c.id}">${c.icon} ${c.name}</button>`
    ).join('');
    grid.querySelectorAll('.cf-chip').forEach(ch => {
      ch.addEventListener('click', () => {
        grid.querySelectorAll('.cf-chip').forEach(x => x.classList.remove('active'));
        ch.classList.add('active');
      });
    });

    qs('#btn-cf-retake').onclick = () => {
      this.closeOverlay('confirm');
      qs('#receipt-input').click();
    };
    qs('#btn-cf-save').onclick = () => this.saveFromConfirm();
  },

  suggestCategory(desc) {
    if (!desc) return 'misc';
    const d = desc.toLowerCase();
    const map = {
      travel: ['交通','電車','JR','suica','タクシー','バス','新幹線','高速','ETC','ガソリン','駐車'],
      communication: ['通信','携帯','ソフトバンク','au','docomo','AWS','サーバー','Zoom'],
      supplies: ['Amazon','アマゾン','ヨドバシ','文具','コピー','100均','ダイソー','消耗品'],
      advertising: ['広告','Google','宣伝','チラシ'],
      entertainment: ['飲食','居酒屋','レストラン','食事','ランチ','カフェ','スタバ','マクドナルド','コンビニ','セブン','ローソン','ファミマ','弁当'],
      outsourcing: ['外注','業務委託','ランサーズ','クラウドワークス'],
      fees: ['手数料','PayPal','Stripe','振込','ATM'],
      home_office: ['電気','ガス','水道','家賃'],
      depreciation: ['パソコン','PC','Mac','iPhone','iPad','カメラ','モニター']
    };
    for (const [cat, kws] of Object.entries(map)) {
      for (const kw of kws) { if (d.includes(kw.toLowerCase())) return cat; }
    }
    return 'misc';
  },

  async saveFromConfirm() {
    const catEl = qs('#cf-cats .cf-chip.active');
    if (!catEl) { this.toast('科目を選択してください', 'error'); return; }
    const btn = qs('#btn-cf-save');
    btn.disabled = true; btn.textContent = '保存中...';

    const fd = new FormData();
    fd.append('bookId', this.currentBook.id);
    fd.append('date', qs('#cf-date').value);
    fd.append('amount', qs('#cf-amount').value);
    fd.append('category', catEl.dataset.cat);
    fd.append('description', qs('#cf-desc').value);
    fd.append('source', 'ocr');
    if (this.receiptFile) fd.append('receipt', this.receiptFile);

    try {
      await fetch(BASE + '/api/expense', { method: 'POST', body: fd, credentials: 'same-origin' });
      this.closeOverlay('confirm');
      this.showSuccess(qs('#cf-amount').value, qs('#cf-desc').value, this.categoryName(catEl.dataset.cat));
      this.loadDashboard();
    } catch (err) { this.toast(err.message, 'error'); }
    btn.disabled = false; btn.textContent = '保存する';
  },

  // ========================================
  // 成功画面
  // ========================================
  showSuccess(amount, desc, catName) {
    this.openOverlay('success');
    qs('#success-summary').textContent = `${desc || catName} ¥${parseInt(amount).toLocaleString()}`;
    this.createConfetti();

    qs('#btn-ss-another').onclick = () => {
      this.closeOverlay('success');
      setTimeout(() => qs('#receipt-input').click(), 200);
    };
    qs('#btn-ss-home').onclick = () => {
      this.closeOverlay('success');
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
  },

  async loadReport() {
    if (!this.currentBook) return;
    const y = qs('#report-year').value;
    try {
      const d = await this.api(`/api/summary/${y}?bookId=${this.currentBook.id}`);
      qs('#rpt-income').textContent = `¥${d.income.toLocaleString()}`;
      qs('#rpt-expense').textContent = `¥${d.expenses.toLocaleString()}`;
      qs('#rpt-taxable').textContent = `¥${Math.max(0, d.profit - 650000).toLocaleString()}`;

      const bdWrap = qs('#rpt-breakdown');
      const maxBd = d.breakdown.length ? d.breakdown[0].total : 1;
      bdWrap.innerHTML = d.breakdown.map(b => `
        <div class="bd-item"><div class="bd-head"><span class="bd-name">${this.categoryIcon(b.category)} ${this.categoryName(b.category)}</span><span class="bd-val">¥${b.total.toLocaleString()} (${b.count}件)</span></div>
        <div class="bd-bar"><div class="bd-fill" style="width:${(b.total/maxBd*100).toFixed(1)}%"></div></div></div>
      `).join('');

      this.renderReportChart(d);
    } catch (err) { this.toast(err.message, 'error'); }
  },

  renderReportChart(d) {
    const months = d.monthlyExpense.map(m => parseInt(m.month) + '月');
    const expData = Array(12).fill(0);
    const incData = Array(12).fill(0);
    d.monthlyExpense.forEach(m => { expData[parseInt(m.month)-1] = m.total; });
    d.monthlyIncome.forEach(m => { incData[parseInt(m.month)-1] = m.total; });

    if (this.reportChart) this.reportChart.destroy();
    const ctx = qs('#chart-report').getContext('2d');
    this.reportChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
        datasets: [
          { label: '収入', data: incData, backgroundColor: 'rgba(34,197,94,.4)', borderRadius: 4 },
          { label: '経費', data: expData, backgroundColor: 'rgba(239,68,68,.4)', borderRadius: 4 }
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

  // ========================================
  // 設定
  // ========================================
  setupSettings() {
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

    // 帳簿追加
    qs('#form-add-book').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = qs('#book-name').value.trim();
      const emojiEl = qs('#emoji-picker .ep.selected');
      const emoji = emojiEl ? emojiEl.dataset.e : '📒';
      try {
        await this.api('/api/books', { method: 'POST', body: JSON.stringify({ name, emoji }) });
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
    wrap.innerHTML = this.books.map(b => `
      <div class="book-item${b.id === this.currentBook?.id ? ' active' : ''}" data-id="${b.id}">
        <span class="book-item-emoji">${b.emoji}</span>
        <span class="book-item-name">${this.esc(b.name)}</span>
        <div class="book-item-actions">
          <button class="book-item-btn danger" data-action="delete" data-id="${b.id}" title="削除">✕</button>
        </div>
      </div>
    `).join('');
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
    try {
      let txs = [];
      if (!t || t === 'income') {
        const inc = await this.api(`/api/income?bookId=${this.currentBook.id}&year=${y}${m?'&month='+m:''}`);
        txs = txs.concat(inc.map(i => ({ ...i, kind: 'income', category: i.type })));
      }
      if (!t || t === 'expense') {
        const exp = await this.api(`/api/expenses?bookId=${this.currentBook.id}&year=${y}${m?'&month='+m:''}`);
        txs = txs.concat(exp.map(e => ({ ...e, kind: 'expense' })));
      }
      txs.sort((a,b) => b.date > a.date ? 1 : b.date < a.date ? -1 : 0);
      this.renderTransactions(txs, 'hist-transactions', 'hist-empty');
    } catch (err) { this.toast(err.message, 'error'); }
  },

  // ========================================
  // モーダル群
  // ========================================
  setupModals() {
    // 収入モーダル
    qs('#close-income').addEventListener('click', () => this.closeOverlay('income'));
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
            description: qs('#inc-desc').value
          })
        });
        this.closeOverlay('income');
        qs('#form-income').reset();
        this.toast('収入を記録しました', 'success');
        this.loadDashboard();
      } catch (err) { this.toast(err.message, 'error'); }
    });

    // 手動経費モーダル
    qs('#close-manual').addEventListener('click', () => this.closeOverlay('manual'));
    this.buildCatChips('me-cats');
    qs('#form-manual-expense').addEventListener('submit', async (e) => {
      e.preventDefault();
      const catEl = qs('#me-cats .cat-chip.active');
      if (!catEl) { this.toast('科目を選択してください', 'error'); return; }
      try {
        await this.api('/api/expense', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookId: this.currentBook.id,
            date: qs('#me-date').value,
            amount: qs('#me-amount').value,
            category: catEl.dataset.cat,
            description: qs('#me-desc').value
          })
        });
        this.closeOverlay('manual');
        qs('#form-manual-expense').reset();
        qs('#me-cats').querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
        this.toast('経費を記録しました', 'success');
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
      else body.type = '振込';
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

  buildCatChips(containerId) {
    const grid = qs(`#${containerId}`);
    grid.innerHTML = this.categories.map(c =>
      `<button type="button" class="cat-chip" data-cat="${c.id}">${c.icon} ${c.name}</button>`
    ).join('');
    grid.querySelectorAll('.cat-chip').forEach(ch => {
      ch.addEventListener('click', () => {
        grid.querySelectorAll('.cat-chip').forEach(x => x.classList.remove('active'));
        ch.classList.add('active');
      });
    });
  },

  buildCatSelect(selectId) {
    const sel = qs(`#${selectId}`);
    sel.innerHTML = this.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  },

  async openEditModal(id, kind) {
    try {
      let item;
      if (kind === 'income') {
        const inc = await this.api(`/api/income?bookId=${this.currentBook.id}`);
        item = inc.find(i => i.id == id);
      } else {
        const exp = await this.api(`/api/expenses?bookId=${this.currentBook.id}`);
        item = exp.find(e => e.id == id);
      }
      if (!item) { this.toast('データが見つかりません', 'error'); return; }

      qs('#edit-id').value = item.id;
      qs('#edit-kind').value = kind;
      qs('#edit-title').textContent = kind === 'income' ? '収入を編集' : '経費を編集';
      qs('#edit-date').value = item.date;
      qs('#edit-amount').value = item.amount;
      qs('#edit-desc').value = item.description || '';
      qs('#edit-cat-group').style.display = kind === 'expense' ? '' : 'none';
      if (kind === 'expense') qs('#edit-category').value = item.category;
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
