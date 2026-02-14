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

  // 科目自動推定用キーワードマッピング（フロントエンド側）
  categoryKeywords: {
    travel: ['交通', '電車', 'JR', 'Suica', 'PASMO', 'タクシー', 'バス', '新幹線', 'ANA', 'JAL', '航空', '高速', 'ETC', 'ガソリン', '駐車', '鉄道', 'きっぷ', '空港', 'エクスプレス', 'uber', 'Uber'],
    communication: ['通信', '電話', '携帯', 'ソフトバンク', 'au', 'docomo', 'NTT', 'インターネット', 'WiFi', 'AWS', 'さくら', 'サーバー', 'ドメイン', 'Xserver', 'ConoHa', 'Zoom', 'Slack'],
    supplies: ['Amazon', 'アマゾン', 'ヨドバシ', 'ビックカメラ', '文具', '事務', 'コピー', '用紙', 'インク', '100均', 'ダイソー', 'セリア', 'ホームセンター', 'ニトリ', 'IKEA', '消耗品', 'LOFT', 'ハンズ'],
    advertising: ['広告', 'Google Ads', 'Facebook', 'Instagram', 'Twitter', '宣伝', 'チラシ', '印刷', 'PR'],
    entertainment: ['飲食', '居酒屋', 'レストラン', '食事', 'ランチ', 'ディナー', '会食', '懇親', '接待', 'カフェ', 'スターバックス', 'タリーズ', 'ドトール', 'マクドナルド', 'ガスト', 'コンビニ', 'セブン', 'ファミリーマート', 'ローソン', '弁当'],
    outsourcing: ['外注', '業務委託', 'ランサーズ', 'クラウドワークス', 'ココナラ', 'デザイン料', '開発費'],
    fees: ['振込手数料', '手数料', 'PayPal', 'Stripe', '決済', '銀行', 'ATM', '送金', '年会費'],
    home_office: ['電気', 'ガス', '水道', '家賃', '光熱'],
    depreciation: ['パソコン', 'PC', 'Mac', 'MacBook', 'iPhone', 'iPad', 'カメラ', 'ディスプレイ', 'モニター', 'プリンター']
  },

  // 科目推定（フロントエンドで即座に推定）
  suggestCategory(description) {
    if (!description) return 'misc';
    const desc = description.toLowerCase();
    for (const [category, keywords] of Object.entries(this.categoryKeywords)) {
      for (const keyword of keywords) {
        if (desc.includes(keyword.toLowerCase())) {
          return category;
        }
      }
    }
    return 'misc';
  },

  // 経費フロー状態
  currentReceiptFile: null,
  currentReceiptDataUrl: null,
  currentExpenseStep: 'capture',

  // CSV取込プレビューデータを保持
  csvPreviewData: [],

  // 初期化
  init() {
    this.setupNavigation();
    this.setupForms();
    this.setupModals();
    this.setupMobile();
    this.setupExpenseFlow();
    this.setupManualReceipt();
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

    // 経費ビューに来たらキャプチャステップにリセット
    if (viewName === 'expense') {
      this.showExpenseStep('capture');
    }

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
        // 手動フォームのレシートプレビューをリセット
        const mp = document.getElementById('manual-receipt-preview');
        if (mp) { mp.style.display = 'none'; }
        const muc = document.querySelector('#manual-receipt-area .file-upload-content');
        if (muc) { muc.style.display = ''; }
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
      this.openCsvModal();
    });
    document.getElementById('csv-modal-close').addEventListener('click', () => {
      this.closeCsvModal();
    });
    document.getElementById('csv-modal-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        this.closeCsvModal();
      }
    });

    // CSVファイル選択 → プレビュー
    document.getElementById('csv-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await this.loadCsvPreview(file);
    });

    // CSV戻るボタン
    document.getElementById('csv-back-btn').addEventListener('click', () => {
      document.getElementById('csv-step-preview').style.display = 'none';
      document.getElementById('csv-step-upload').style.display = '';
      document.getElementById('csv-modal-title').textContent = 'CSVファイルを取り込む';
      document.getElementById('csv-file').value = '';
      this.csvPreviewData = [];
    });

    // CSV全選択チェックボックス
    document.getElementById('csv-check-all').addEventListener('change', (e) => {
      const checked = e.target.checked;
      document.querySelectorAll('.csv-row-check').forEach(cb => {
        cb.checked = checked;
        cb.closest('tr').classList.toggle('csv-row-unchecked', !checked);
      });
      this.updateCsvSelectedCount();
    });

    // CSV一括登録
    document.getElementById('btn-import-csv').addEventListener('click', async () => {
      await this.importCsvRows();
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

  // ===== 経費 Photo-First フロー =====

  setupExpenseFlow() {
    // カメラ撮影
    document.getElementById('expense-receipt-capture').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      this.currentReceiptFile = file;
      const reader = new FileReader();
      reader.onload = (ev) => {
        this.currentReceiptDataUrl = ev.target.result;
        this.startOcrFlow();
      };
      reader.readAsDataURL(file);
    });

    // 手動入力
    document.getElementById('btn-manual-input').addEventListener('click', () => this.showExpenseStep('manual'));
    document.getElementById('btn-back-to-capture').addEventListener('click', (e) => { e.preventDefault(); this.showExpenseStep('capture'); });
    document.getElementById('btn-retake').addEventListener('click', () => this.showExpenseStep('capture'));
    document.getElementById('btn-save-expense').addEventListener('click', () => this.saveFromConfirm());
    document.getElementById('btn-capture-another').addEventListener('click', () => this.showExpenseStep('capture'));
    document.getElementById('btn-to-dashboard').addEventListener('click', () => this.navigate('dashboard'));

    this.buildConfirmCategoryChips();
  },

  // 手動フォーム用レシート添付
  setupManualReceipt() {
    const input = document.getElementById('expense-receipt');
    if (!input) return;
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          document.getElementById('manual-receipt-preview-img').src = ev.target.result;
          document.getElementById('manual-receipt-preview').style.display = '';
          document.querySelector('#manual-receipt-area .file-upload-content').style.display = 'none';
        };
        reader.readAsDataURL(file);
      }
    });
    const rm = document.getElementById('btn-remove-manual-receipt');
    if (rm) rm.addEventListener('click', () => {
      input.value = '';
      document.getElementById('manual-receipt-preview').style.display = 'none';
      document.querySelector('#manual-receipt-area .file-upload-content').style.display = '';
    });
  },

  showExpenseStep(stepName) {
    this.currentExpenseStep = stepName;
    document.querySelectorAll('#view-expense .expense-step').forEach(el => el.classList.remove('active'));
    const target = document.getElementById('expense-' + stepName);
    if (target) target.classList.add('active');
    if (stepName === 'capture') {
      document.getElementById('expense-receipt-capture').value = '';
      this.currentReceiptFile = null;
      this.currentReceiptDataUrl = null;
    }
  },

  buildConfirmCategoryChips() {
    const grid = document.getElementById('confirm-category-grid');
    if (!grid) return;
    grid.innerHTML = Object.entries(this.categoryNames).map(([key, name]) =>
      `<div class="confirm-category-chip" data-cat="${key}">${this.categoryEmojis[key] || ''} ${name}</div>`
    ).join('');
    grid.addEventListener('click', (e) => {
      const chip = e.target.closest('.confirm-category-chip');
      if (!chip) return;
      grid.querySelectorAll('.confirm-category-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
    });
  },

  async startOcrFlow() {
    document.getElementById('scanning-receipt-img').src = this.currentReceiptDataUrl;
    this.showExpenseStep('scanning');
    const progressFill = document.getElementById('scanning-progress-fill');
    const statusText = document.getElementById('scanning-status-text');
    progressFill.style.width = '0%';
    statusText.textContent = '画像を最適化中...';

    try {
      const processed = await this.preprocessImage(this.currentReceiptFile);
      const result = await Tesseract.recognize(processed, 'jpn+eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            progressFill.style.width = Math.round(m.progress * 100) + '%';
            statusText.textContent = `テキスト認識中... ${Math.round(m.progress * 100)}%`;
          } else if (m.status === 'loading language traineddata') {
            statusText.textContent = '言語データ読み込み中...';
            progressFill.style.width = '15%';
          } else if (m.status === 'initializing api') {
            statusText.textContent = 'エンジン初期化中...';
            progressFill.style.width = '10%';
          }
        }
      });
      const ocrText = result.data.text;
      console.log('OCR Text:', ocrText);
      const extracted = this.parseReceiptText(ocrText);
      console.log('Extracted:', extracted);
      this.showConfirmScreen(extracted, ocrText);
    } catch (err) {
      console.error('OCR Error:', err);
      this.showToast('読み取りに失敗しました', 'error');
      this.showExpenseStep('manual');
    }
  },

  preprocessImage(imageFile) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const maxDim = 2000;
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          const r = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * r); h = Math.round(h * r);
        }
        canvas.width = w; canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
        const id = ctx.getImageData(0, 0, w, h);
        const d = id.data;
        for (let i = 0; i < d.length; i += 4) {
          let g = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
          g = ((g - 128) * 1.6) + 128;
          g = Math.max(0, Math.min(255, g));
          g = g > 140 ? 255 : 0;
          d[i] = d[i+1] = d[i+2] = g;
        }
        ctx.putImageData(id, 0, 0);
        canvas.toBlob((blob) => resolve(blob), 'image/png');
      };
      img.src = URL.createObjectURL(imageFile);
    });
  },

  parseReceiptText(text) {
    const result = { date: null, amount: null, storeName: null };
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // 金額: 合計キーワード行を優先
    const totalKw = /合計|小計|税込|お支払|総計|請求|お会計|お買上|TOTAL|Total|total/;
    for (const line of lines) {
      if (!totalKw.test(line)) continue;
      const amounts = [];
      let m;
      const p1 = /[¥￥\\]\s*([\d,]+)/g;
      while ((m = p1.exec(line)) !== null) { const v = parseInt(m[1].replace(/,/g, '')); if (v > 0 && v < 10000000) amounts.push(v); }
      const p2 = /([\d,]{2,})\s*円/g;
      while ((m = p2.exec(line)) !== null) { const v = parseInt(m[1].replace(/,/g, '')); if (v > 0 && v < 10000000) amounts.push(v); }
      const p3 = /(?:合計|小計|税込|お支払|総計|お買上)[\s:：]*(\d[\d,]*)/;
      m = line.match(p3);
      if (m) { const v = parseInt(m[1].replace(/,/g, '')); if (v > 0 && v < 10000000) amounts.push(v); }
      if (amounts.length > 0) { result.amount = Math.max(...amounts); break; }
    }
    if (!result.amount) {
      let maxAmt = 0;
      for (const line of lines) {
        let m;
        const p = /[¥￥\\]\s*([\d,]+)/g;
        while ((m = p.exec(line)) !== null) { const v = parseInt(m[1].replace(/,/g, '')); if (v > maxAmt && v < 10000000 && v >= 10) maxAmt = v; }
        const p2 = /([\d,]{3,})\s*円/g;
        while ((m = p2.exec(line)) !== null) { const v = parseInt(m[1].replace(/,/g, '')); if (v > maxAmt && v < 10000000 && v >= 10) maxAmt = v; }
      }
      if (maxAmt > 0) result.amount = maxAmt;
    }

    // 日付
    const dp = [
      { re: /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/, t: 'jp' },
      { re: /(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/, t: 'std' },
      { re: /[RＲ令和]\s*(\d{1,2})[\.\/年\s]\s*(\d{1,2})[\.\/月\s]\s*(\d{1,2})/, t: 'wa' },
    ];
    for (const { re, t } of dp) {
      for (const line of lines) {
        const m = line.match(re);
        if (!m) continue;
        let y, mo, d;
        if (t === 'wa') { y = 2018 + parseInt(m[1]); mo = m[2]; d = m[3]; }
        else { y = parseInt(m[1]); mo = m[2]; d = m[3]; }
        if (y >= 2000 && y <= 2099 && parseInt(mo) >= 1 && parseInt(mo) <= 12 && parseInt(d) >= 1 && parseInt(d) <= 31) {
          result.date = `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          break;
        }
      }
      if (result.date) break;
    }

    // 店舗名
    const skip = /^[\d\s\-\/\.\:¥￥円%=\*#\+\(\)（）]+$|^TEL|^電話|^〒|^\d{3}-|^http|^www|^レシート|^領収|^━|^─|^-{3}/i;
    const storeKw = /店|株式会社|有限会社|ストア|マート|STORE|SHOP|Co\.|Inc/i;
    for (let i = 0; i < Math.min(lines.length, 8); i++) {
      if (lines[i].length >= 2 && lines[i].length <= 50 && storeKw.test(lines[i]) && !skip.test(lines[i])) {
        result.storeName = lines[i].replace(/[\s　]+/g, ' ').trim(); break;
      }
    }
    if (!result.storeName) {
      for (let i = 0; i < Math.min(lines.length, 5); i++) {
        if (lines[i].length >= 2 && lines[i].length <= 40 && !skip.test(lines[i]) && !/^\d{4}[\/\-]/.test(lines[i])) {
          result.storeName = lines[i].replace(/[\s　]+/g, ' ').trim(); break;
        }
      }
    }
    return result;
  },

  showConfirmScreen(extracted, ocrText) {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('confirm-date').value = extracted.date || today;
    document.getElementById('confirm-amount').value = extracted.amount || '';
    document.getElementById('confirm-description').value = extracted.storeName || '';
    document.getElementById('confirm-receipt-img').src = this.currentReceiptDataUrl;
    const cat = this.suggestCategory(extracted.storeName || ocrText || '');
    document.querySelectorAll('#confirm-category-grid .confirm-category-chip').forEach(c =>
      c.classList.toggle('selected', c.dataset.cat === cat)
    );
    this.showExpenseStep('confirm');
  },

  async saveFromConfirm() {
    const date = document.getElementById('confirm-date').value;
    const amount = document.getElementById('confirm-amount').value;
    const description = document.getElementById('confirm-description').value;
    const selChip = document.querySelector('#confirm-category-grid .confirm-category-chip.selected');
    const category = selChip ? selChip.dataset.cat : 'misc';
    if (!date || !amount) { this.showToast('日付と金額は必須です', 'error'); return; }

    const fd = new FormData();
    fd.append('date', date); fd.append('amount', amount);
    fd.append('category', category); fd.append('description', description);
    fd.append('source', 'ocr');
    if (this.currentReceiptFile) fd.append('receipt', this.currentReceiptFile);

    const btn = document.getElementById('btn-save-expense');
    const orig = btn.innerHTML;
    btn.innerHTML = '<span class="scanning-dot" style="display:inline-block"></span> 保存中...';
    btn.disabled = true;

    try {
      const res = await fetch(BASE + '/api/expense', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('保存に失敗しました');
      btn.innerHTML = orig; btn.disabled = false;
      this.showSuccessScreen(amount, description, category);
    } catch (err) {
      btn.innerHTML = orig; btn.disabled = false;
      this.showToast(err.message, 'error');
    }
  },

  showSuccessScreen(amount, description, category) {
    const cn = this.categoryNames[category] || category;
    const ce = this.categoryEmojis[category] || '';
    document.getElementById('success-summary').textContent =
      `¥${parseInt(amount).toLocaleString()} · ${description || cn} · ${ce} ${cn}`;
    this.showExpenseStep('success');
    this.createConfetti();
    this.loadDashboard();
  },

  createConfetti() {
    const c = document.getElementById('success-particles');
    c.innerHTML = '';
    const colors = ['#6366f1','#8b5cf6','#10b981','#f59e0b','#ec4899','#06b6d4','#f43f5e'];
    for (let i = 0; i < 30; i++) {
      const p = document.createElement('div');
      p.className = 'confetti';
      p.style.cssText = `left:${40+Math.random()*20}%;top:50%;background:${colors[Math.floor(Math.random()*colors.length)]};--dx:${(Math.random()-0.5)*200}px;--dy:${-80-Math.random()*160}px;--rot:${Math.random()*720-360}deg;--dur:${0.8+Math.random()*0.8}s;--delay:${Math.random()*0.3}s;width:${4+Math.random()*6}px;height:${4+Math.random()*6}px;border-radius:${Math.random()>0.5?'50%':'2px'};`;
      c.appendChild(p);
    }
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
  },

  // === CSV取込機能 ===

  openCsvModal() {
    document.getElementById('csv-step-upload').style.display = '';
    document.getElementById('csv-step-preview').style.display = 'none';
    document.getElementById('csv-loading').style.display = 'none';
    document.getElementById('csv-modal-title').textContent = 'CSVファイルを取り込む';
    document.getElementById('csv-file').value = '';
    this.csvPreviewData = [];
    document.getElementById('csv-modal-overlay').classList.add('active');
  },

  closeCsvModal() {
    document.getElementById('csv-modal-overlay').classList.remove('active');
  },

  async loadCsvPreview(file) {
    const loading = document.getElementById('csv-loading');
    loading.style.display = 'flex';

    const formData = new FormData();
    formData.append('csv', file);

    try {
      const res = await fetch(BASE + '/api/preview-csv', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'CSV解析に失敗しました');

      this.csvPreviewData = data.rows;
      loading.style.display = 'none';

      if (data.rows.length === 0) {
        this.showToast('有効なデータが見つかりませんでした', 'error');
        return;
      }

      this.renderCsvPreview(data.rows);
    } catch (err) {
      loading.style.display = 'none';
      this.showToast(err.message, 'error');
    }
  },

  renderCsvPreview(rows) {
    document.getElementById('csv-step-upload').style.display = 'none';
    document.getElementById('csv-step-preview').style.display = '';
    document.getElementById('csv-modal-title').textContent = 'CSV取込プレビュー';
    document.getElementById('csv-preview-count').textContent = `${rows.length}件の取引が見つかりました`;
    document.getElementById('csv-check-all').checked = true;

    const categoryOptions = Object.entries(this.categoryNames)
      .map(([val, name]) => `<option value="${val}">${this.categoryEmojis[val] || ''} ${name}</option>`)
      .join('');

    const tbody = document.getElementById('csv-preview-body');
    tbody.innerHTML = rows.map((row, idx) => `
      <tr data-idx="${idx}" style="--row-idx:${idx};animation:csv-row-in 0.35s ease both;animation-delay:calc(var(--row-idx)*0.03s)">
        <td style="text-align:center;"><input type="checkbox" class="csv-row-check" data-idx="${idx}" checked></td>
        <td class="csv-date">${this.escapeHtml(row.date)}</td>
        <td class="csv-amount">¥${Math.abs(row.amount).toLocaleString()}</td>
        <td class="csv-desc" title="${this.escapeHtml(row.description)}">${this.escapeHtml(row.description)}</td>
        <td>
          <select class="csv-category-select" data-idx="${idx}">
            ${categoryOptions}
          </select>
        </td>
      </tr>
    `).join('');

    // 推定カテゴリをセット
    rows.forEach((row, idx) => {
      const select = tbody.querySelector(`select[data-idx="${idx}"]`);
      if (select) select.value = row.category;
    });

    // チェックボックスのイベント
    tbody.querySelectorAll('.csv-row-check').forEach(cb => {
      cb.addEventListener('change', (e) => {
        e.target.closest('tr').classList.toggle('csv-row-unchecked', !e.target.checked);
        this.updateCsvSelectedCount();
      });
    });

    this.updateCsvSelectedCount();
  },

  updateCsvSelectedCount() {
    const checked = document.querySelectorAll('.csv-row-check:checked').length;
    const total = document.querySelectorAll('.csv-row-check').length;
    document.getElementById('csv-selected-count').textContent = `${checked}/${total}件 選択中`;
    document.getElementById('btn-import-csv').disabled = checked === 0;
  },

  async importCsvRows() {
    const checkedRows = [];
    document.querySelectorAll('.csv-row-check:checked').forEach(cb => {
      const idx = parseInt(cb.dataset.idx);
      const row = { ...this.csvPreviewData[idx] };
      // ユーザーが変更したカテゴリを反映
      const select = document.querySelector(`.csv-category-select[data-idx="${idx}"]`);
      if (select) row.category = select.value;
      checkedRows.push(row);
    });

    if (checkedRows.length === 0) {
      this.showToast('取り込む項目を選択してください', 'error');
      return;
    }

    try {
      const res = await fetch(BASE + '/api/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: checkedRows })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '取込に失敗しました');

      // 成功演出をモーダル内で表示
      document.getElementById('csv-step-preview').innerHTML = `
        <div class="csv-success-overlay">
          <div class="success-check-wrap">
            <svg class="success-checkmark" viewBox="0 0 52 52">
              <circle class="success-circle" cx="26" cy="26" r="25" fill="none"/>
              <path class="success-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
            </svg>
          </div>
          <h3>${data.imported}件の経費を取り込みました</h3>
          <p>勘定科目は自動推定されています</p>
        </div>
      `;
      this.showToast(`${data.imported}件の経費を取り込みました`, 'success');
      this.csvPreviewData = [];
      this.loadDashboard();
      setTimeout(() => this.closeCsvModal(), 2200);
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  }
};

// アプリ起動
document.addEventListener('DOMContentLoaded', () => App.init());
