/* ============================================
   Keihi - 経費管理ツール
   Frontend Application Logic
   ============================================ */

// ベースパス自動検出（/tax 配下なら /tax、ローカルなら空文字）
const BASE = location.pathname.startsWith('/tax') ? '/tax' : '';

const App = {
  currentView: 'dashboard',
  charts: {},
  categoryNames: {
    outsourcing: '外注工賃',
    travel: '旅費交通費',
    communication: '通信費',
    supplies: '消耗品費',
    advertising: '広告宣伝費',
    entertainment: '接待交際費',
    depreciation: '減価償却費',
    home_office: '家事按分',
    fees: '支払手数料',
    misc: '雑費'
  },
  categoryEmojis: {
    outsourcing: '👨‍💻',
    travel: '🚃',
    communication: '📱',
    supplies: '🖊️',
    advertising: '📢',
    entertainment: '🍽️',
    depreciation: '💻',
    home_office: '🏠',
    fees: '🏦',
    misc: '📦'
  },
  categoryColors: {
    outsourcing: '#6366f1',
    travel: '#8b5cf6',
    communication: '#06b6d4',
    supplies: '#10b981',
    advertising: '#f59e0b',
    entertainment: '#ef4444',
    depreciation: '#ec4899',
    home_office: '#14b8a6',
    fees: '#64748b',
    misc: '#a855f7'
  },

  // 初期化
  init() {
    this.setupNavigation();
    this.setupForms();
    this.setupModals();
    this.setupMobile();
    this.setupFileUpload();
    this.setupFilters();
    this.initDateDefaults();
    this.initYearSelectors();
    this.loadDashboard();
  },

  // ナビゲーション
  setupNavigation() {
    // サイドバーナビ
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        this.navigate(item.dataset.view);
      });
    });

    // モバイルナビ
    document.querySelectorAll('.mobile-nav-item[data-view]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        this.navigate(item.dataset.view);
      });
    });
  },

  navigate(viewName) {
    this.currentView = viewName;

    // ビュー切り替え
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`view-${viewName}`);
    if (target) target.classList.add('active');

    // ナビアクティブ切り替え
    document.querySelectorAll('.nav-item[data-view]').forEach(n => {
      n.classList.toggle('active', n.dataset.view === viewName);
    });
    document.querySelectorAll('.mobile-nav-item[data-view]').forEach(n => {
      n.classList.toggle('active', n.dataset.view === viewName);
    });

    // モバイルサイドバー閉じる
    this.closeSidebar();

    // ビュー別データ読み込み
    switch (viewName) {
      case 'dashboard': this.loadDashboard(); break;
      case 'history': this.loadHistory(); break;
      case 'report': this.loadReport(); break;
    }

    // スクロールトップ
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  // フォーム設定
  setupForms() {
    // 収入フォーム
    document.getElementById('form-income').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = {
        date: document.getElementById('income-date').value,
        amount: document.getElementById('income-amount').value,
        type: document.getElementById('income-type').value,
        description: document.getElementById('income-description').value
      };

      try {
        const res = await fetch(BASE + '/api/income', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error('保存に失敗しました');
        this.showToast('収入を保存しました', 'success');
        e.target.reset();
        this.initDateDefaults();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    // 経費フォーム
    document.getElementById('form-expense').addEventListener('submit', async (e) => {
      e.preventDefault();
      const category = document.querySelector('input[name="category"]:checked');
      if (!category) {
        this.showToast('科目を選択してください', 'error');
        return;
      }

      const formData = new FormData();
      formData.append('date', document.getElementById('expense-date').value);
      formData.append('amount', document.getElementById('expense-amount').value);
      formData.append('category', category.value);
      formData.append('description', document.getElementById('expense-description').value);

      const receipt = document.getElementById('expense-receipt').files[0];
      if (receipt) formData.append('receipt', receipt);

      try {
        const res = await fetch(BASE + '/api/expense', {
          method: 'POST',
          body: formData
        });
        if (!res.ok) throw new Error('保存に失敗しました');
        this.showToast('経費を保存しました', 'success');
        e.target.reset();
        this.initDateDefaults();
        this.resetReceiptPreview();
        // デフォルトカテゴリーをリセット
        document.querySelector('input[name="category"][value="misc"]').checked = true;
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    // 編集フォーム
    document.getElementById('form-edit').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('edit-id').value;
      const kind = document.getElementById('edit-kind').value;
      const data = {
        date: document.getElementById('edit-date').value,
        amount: document.getElementById('edit-amount').value,
        description: document.getElementById('edit-description').value
      };

      if (kind === 'expense') {
        data.category = document.getElementById('edit-category').value;
      }

      const endpoint = kind === 'income' ? `${BASE}/api/income/${id}` : `${BASE}/api/expense/${id}`;

      try {
        const res = await fetch(endpoint, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error('更新に失敗しました');
        this.showToast('取引を更新しました', 'success');
        this.closeModal();
        this.loadHistory();
        this.loadDashboard();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });
  },

  // モーダル設定
  setupModals() {
    // 編集モーダル
    document.getElementById('modal-close').addEventListener('click', () => this.closeModal());
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeModal();
    });

    // 削除ボタン
    document.getElementById('btn-delete-transaction').addEventListener('click', async () => {
      if (!confirm('この取引を削除してよろしいですか？')) return;
      const id = document.getElementById('edit-id').value;
      const kind = document.getElementById('edit-kind').value;
      const endpoint = kind === 'income' ? `${BASE}/api/income/${id}` : `${BASE}/api/expense/${id}`;

      try {
        await fetch(endpoint, { method: 'DELETE' });
        this.showToast('取引を削除しました', 'success');
        this.closeModal();
        this.loadHistory();
        this.loadDashboard();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    // CSVモーダル
    document.getElementById('btn-csv-import').addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('csv-modal-overlay').classList.add('active');
    });
    document.getElementById('csv-modal-close').addEventListener('click', () => {
      document.getElementById('csv-modal-overlay').classList.remove('active');
    });
    document.getElementById('csv-modal-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        document.getElementById('csv-modal-overlay').classList.remove('active');
      }
    });

    // CSVインポート
    document.getElementById('csv-file').addEventListener('change', (e) => {
      document.getElementById('btn-import-csv').disabled = !e.target.files.length;
    });

    document.getElementById('btn-import-csv').addEventListener('click', async () => {
      const file = document.getElementById('csv-file').files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('csv', file);

      try {
        const res = await fetch(BASE + '/api/import-csv', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'インポートに失敗しました');
        this.showToast(`${data.imported}件の取引をインポートしました`, 'success');
        document.getElementById('csv-modal-overlay').classList.remove('active');
        document.getElementById('csv-file').value = '';
        this.loadDashboard();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    // AI出力
    document.getElementById('btn-generate-ai').addEventListener('click', async () => {
      const year = document.getElementById('ai-year').value;
      try {
        const res = await fetch(`${BASE}/api/ai-format/${year}`);
        const data = await res.json();
        document.getElementById('ai-output').value = data.text;
        document.getElementById('btn-copy-ai').style.display = '';
      } catch (err) {
        this.showToast('データ生成に失敗しました', 'error');
      }
    });

    document.getElementById('btn-copy-ai').addEventListener('click', async () => {
      const text = document.getElementById('ai-output').value;
      try {
        await navigator.clipboard.writeText(text);
        this.showToast('クリップボードにコピーしました', 'success');
      } catch {
        // フォールバック
        document.getElementById('ai-output').select();
        document.execCommand('copy');
        this.showToast('クリップボードにコピーしました', 'success');
      }
    });
  },

  // モバイル設定
  setupMobile() {
    document.getElementById('menu-toggle').addEventListener('click', () => {
      this.toggleSidebar();
    });

    document.getElementById('sidebar-overlay').addEventListener('click', () => {
      this.closeSidebar();
    });
  },

  toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
  },

  closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('active');
  },

  // ファイルアップロード
  setupFileUpload() {
    const receiptInput = document.getElementById('expense-receipt');
    const preview = document.getElementById('receipt-preview');
    const previewImg = document.getElementById('receipt-preview-img');
    const uploadContent = document.querySelector('#receipt-upload-area .file-upload-content');

    receiptInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          previewImg.src = ev.target.result;
          preview.style.display = '';
          uploadContent.style.display = 'none';
        };
        reader.readAsDataURL(file);
      }
    });

    document.getElementById('btn-remove-receipt').addEventListener('click', () => {
      this.resetReceiptPreview();
    });
  },

  resetReceiptPreview() {
    document.getElementById('expense-receipt').value = '';
    document.getElementById('receipt-preview').style.display = 'none';
    document.querySelector('#receipt-upload-area .file-upload-content').style.display = '';
  },

  // フィルター設定
  setupFilters() {
    ['history-year', 'history-month', 'history-type'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => this.loadHistory());
    });

    document.getElementById('report-year').addEventListener('change', () => this.loadReport());
  },

  // 日付デフォルト
  initDateDefaults() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('income-date').value = today;
    document.getElementById('expense-date').value = today;
  },

  // 年セレクター初期化
  initYearSelectors() {
    const currentYear = new Date().getFullYear();
    const selectors = ['history-year', 'report-year', 'ai-year'];

    selectors.forEach(id => {
      const select = document.getElementById(id);
      select.innerHTML = '';
      for (let y = currentYear; y >= currentYear - 5; y--) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = `${y}年`;
        select.appendChild(opt);
      }
    });

    // ダッシュボード日付
    const now = new Date();
    const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
    document.getElementById('dashboard-date').textContent =
      `${currentYear}年${months[now.getMonth()]}${now.getDate()}日`;
  },

  // === データ読み込み ===

  async loadDashboard() {
    try {
      const res = await fetch(BASE + '/api/dashboard');
      const data = await res.json();

      // 統計更新
      document.getElementById('stat-month-income').textContent = this.formatCurrency(data.monthIncome);
      document.getElementById('stat-month-expense').textContent = this.formatCurrency(data.monthExpense);
      document.getElementById('stat-year-income').textContent = this.formatCurrency(data.yearIncome);
      document.getElementById('stat-year-profit').textContent = this.formatCurrency(data.yearProfit);

      // 最近の取引
      this.renderTransactions(data.recentTransactions, 'recent-transactions');

      // チャート
      this.renderMonthlyChart(data.monthlyTrend);
      this.renderCategoryChart(data.categoryBreakdown);

    } catch (err) {
      console.error('Dashboard load error:', err);
    }
  },

  async loadHistory() {
    const year = document.getElementById('history-year').value;
    const month = document.getElementById('history-month').value;
    const type = document.getElementById('history-type').value;

    try {
      let transactions = [];

      if (!type || type === 'income') {
        const params = new URLSearchParams({ year });
        if (month) params.set('month', month);
        const res = await fetch(`${BASE}/api/income?${params}`);
        const data = await res.json();
        transactions.push(...data.map(item => ({ ...item, kind: 'income' })));
      }

      if (!type || type === 'expense') {
        const params = new URLSearchParams({ year });
        if (month) params.set('month', month);
        const res = await fetch(`${BASE}/api/expenses?${params}`);
        const data = await res.json();
        transactions.push(...data.map(item => ({ ...item, kind: 'expense' })));
      }

      // 日付でソート
      transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

      this.renderTransactions(transactions, 'history-transactions', true);

      // 空表示
      document.getElementById('history-empty').style.display =
        transactions.length === 0 ? '' : 'none';

    } catch (err) {
      console.error('History load error:', err);
    }
  },

  async loadReport() {
    const year = document.getElementById('report-year').value;

    try {
      const res = await fetch(`${BASE}/api/summary/${year}`);
      const data = await res.json();

      document.getElementById('report-total-income').textContent = this.formatCurrency(data.income);
      document.getElementById('report-total-expense').textContent = this.formatCurrency(data.expenses);

      const taxable = data.income - data.expenses - 650000;
      document.getElementById('report-taxable').textContent = this.formatCurrency(Math.max(0, taxable));

      // 内訳
      this.renderBreakdown(data.breakdown, data.expenses);

      // チャート
      this.renderReportChart(data.monthlyIncome, data.monthlyExpense);

    } catch (err) {
      console.error('Report load error:', err);
    }
  },

  // === レンダリング ===

  renderTransactions(items, containerId, clickable = true) {
    const container = document.getElementById(containerId);
    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="empty-icon">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
            <polyline points="13 2 13 9 20 9"/>
          </svg>
          <p>取引データがありません</p>
        </div>
      `;
      return;
    }

    container.innerHTML = items.map(item => {
      const isIncome = item.kind === 'income';
      const emoji = isIncome ? '💰' : (this.categoryEmojis[item.category] || '📦');
      const categoryName = isIncome
        ? (item.type || item.category || '収入')
        : (this.categoryNames[item.category] || item.category || '経費');
      const desc = item.description || categoryName;
      const dateStr = this.formatDate(item.date);

      return `
        <div class="transaction-item" ${clickable ? `onclick="App.openEditModal(${item.id}, '${item.kind}')"` : ''}
             data-id="${item.id}" data-kind="${item.kind}">
          <div class="transaction-icon ${item.kind}">${emoji}</div>
          <div class="transaction-info">
            <div class="transaction-desc">${this.escapeHtml(desc)}</div>
            <div class="transaction-meta">${dateStr} · ${categoryName}</div>
          </div>
          <div class="transaction-amount ${item.kind}">
            ${isIncome ? '+' : '-'}${this.formatCurrency(item.amount)}
          </div>
        </div>
      `;
    }).join('');
  },

  renderBreakdown(items, total) {
    const container = document.getElementById('report-breakdown');
    if (!items || items.length === 0) {
      container.innerHTML = '<p class="text-muted" style="padding:20px;text-align:center;">データがありません</p>';
      return;
    }

    const maxAmount = Math.max(...items.map(i => i.total));

    container.innerHTML = items.map(item => {
      const name = this.categoryNames[item.category] || item.category;
      const emoji = this.categoryEmojis[item.category] || '📦';
      const percent = total > 0 ? ((item.total / total) * 100).toFixed(1) : 0;
      const barWidth = maxAmount > 0 ? ((item.total / maxAmount) * 100) : 0;

      return `
        <div class="breakdown-item">
          <div class="breakdown-emoji">${emoji}</div>
          <div class="breakdown-info">
            <div class="breakdown-name">${name}</div>
            <div class="breakdown-bar">
              <div class="breakdown-bar-fill" style="width: ${barWidth}%"></div>
            </div>
          </div>
          <div>
            <div class="breakdown-amount">${this.formatCurrency(item.total)}</div>
            <div class="breakdown-count">${percent}% · ${item.count}件</div>
          </div>
        </div>
      `;
    }).join('');
  },

  // === チャート ===

  renderMonthlyChart(data) {
    const ctx = document.getElementById('chart-monthly');
    if (!ctx) return;

    if (this.charts.monthly) this.charts.monthly.destroy();

    const labels = data.map(d => `${parseInt(d.month)}月`);
    const incomeData = data.map(d => d.income);
    const expenseData = data.map(d => d.expense);

    this.charts.monthly = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '収入',
            data: incomeData,
            backgroundColor: 'rgba(16, 185, 129, 0.7)',
            borderColor: 'rgba(16, 185, 129, 1)',
            borderWidth: 1,
            borderRadius: 6,
            barPercentage: 0.6,
            categoryPercentage: 0.7
          },
          {
            label: '経費',
            data: expenseData,
            backgroundColor: 'rgba(244, 63, 94, 0.7)',
            borderColor: 'rgba(244, 63, 94, 1)',
            borderWidth: 1,
            borderRadius: 6,
            barPercentage: 0.6,
            categoryPercentage: 0.7
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              usePointStyle: true,
              pointStyle: 'circle',
              padding: 16,
              font: { size: 12, family: "'Inter', 'Noto Sans JP', sans-serif" }
            }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            titleFont: { size: 13 },
            bodyFont: { size: 13 },
            padding: 12,
            cornerRadius: 8,
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ¥${ctx.raw.toLocaleString()}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 11 } }
          },
          y: {
            grid: { color: 'rgba(0,0,0,0.04)' },
            ticks: {
              font: { size: 11 },
              callback: (v) => v >= 10000 ? `${v / 10000}万` : v.toLocaleString()
            }
          }
        }
      }
    });
  },

  renderCategoryChart(data) {
    const ctx = document.getElementById('chart-category');
    if (!ctx) return;

    if (this.charts.category) this.charts.category.destroy();

    if (!data || data.length === 0) {
      this.charts.category = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['データなし'],
          datasets: [{ data: [1], backgroundColor: ['#e2e8f0'] }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } }
        }
      });
      return;
    }

    const labels = data.map(d => this.categoryNames[d.category] || d.category);
    const values = data.map(d => d.total);
    const colors = data.map(d => this.categoryColors[d.category] || '#94a3b8');

    this.charts.category = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderWidth: 0,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              usePointStyle: true,
              pointStyle: 'circle',
              padding: 12,
              font: { size: 11, family: "'Inter', 'Noto Sans JP', sans-serif" }
            }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            padding: 12,
            cornerRadius: 8,
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ¥${ctx.raw.toLocaleString()}`
            }
          }
        }
      }
    });
  },

  renderReportChart(monthlyIncome, monthlyExpense) {
    const ctx = document.getElementById('chart-report-monthly');
    if (!ctx) return;

    if (this.charts.report) this.charts.report.destroy();

    const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

    const incomeMap = {};
    const expenseMap = {};
    (monthlyIncome || []).forEach(d => { incomeMap[d.month] = d.total; });
    (monthlyExpense || []).forEach(d => { expenseMap[d.month] = d.total; });

    const incomeData = [];
    const expenseData = [];
    for (let m = 1; m <= 12; m++) {
      const key = m.toString().padStart(2, '0');
      incomeData.push(incomeMap[key] || 0);
      expenseData.push(expenseMap[key] || 0);
    }

    this.charts.report = new Chart(ctx, {
      type: 'line',
      data: {
        labels: months,
        datasets: [
          {
            label: '収入',
            data: incomeData,
            borderColor: 'rgba(16, 185, 129, 1)',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            pointHoverRadius: 6,
            borderWidth: 2.5
          },
          {
            label: '経費',
            data: expenseData,
            borderColor: 'rgba(244, 63, 94, 1)',
            backgroundColor: 'rgba(244, 63, 94, 0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            pointHoverRadius: 6,
            borderWidth: 2.5
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              usePointStyle: true,
              pointStyle: 'circle',
              padding: 16,
              font: { size: 12, family: "'Inter', 'Noto Sans JP', sans-serif" }
            }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            padding: 12,
            cornerRadius: 8,
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ¥${ctx.raw.toLocaleString()}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 11 } }
          },
          y: {
            grid: { color: 'rgba(0,0,0,0.04)' },
            ticks: {
              font: { size: 11 },
              callback: (v) => v >= 10000 ? `${v / 10000}万` : v.toLocaleString()
            }
          }
        }
      }
    });
  },

  // === モーダル ===

  async openEditModal(id, kind) {
    try {
      let item;
      if (kind === 'income') {
        const res = await fetch(BASE + '/api/income');
        const data = await res.json();
        item = data.find(d => d.id === id);
      } else {
        const res = await fetch(BASE + '/api/expenses');
        const data = await res.json();
        item = data.find(d => d.id === id);
      }

      if (!item) {
        this.showToast('取引が見つかりません', 'error');
        return;
      }

      document.getElementById('edit-id').value = item.id;
      document.getElementById('edit-kind').value = kind;
      document.getElementById('edit-date').value = item.date;
      document.getElementById('edit-amount').value = item.amount;
      document.getElementById('edit-description').value = item.description || '';

      const categoryGroup = document.getElementById('edit-category-group');
      if (kind === 'expense') {
        categoryGroup.style.display = '';
        document.getElementById('edit-category').value = item.category;
      } else {
        categoryGroup.style.display = 'none';
      }

      document.getElementById('modal-title').textContent =
        kind === 'income' ? '収入を編集' : '経費を編集';

      document.getElementById('modal-overlay').classList.add('active');
    } catch (err) {
      this.showToast('データの取得に失敗しました', 'error');
    }
  },

  closeModal() {
    document.getElementById('modal-overlay').classList.remove('active');
  },

  // === ユーティリティ ===

  formatCurrency(amount) {
    if (amount === null || amount === undefined) return '¥0';
    return '¥' + Math.abs(amount).toLocaleString();
  },

  formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
      error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };

    toast.innerHTML = `${icons[type] || icons.info}<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
};

// アプリ起動
document.addEventListener('DOMContentLoaded', () => App.init());
