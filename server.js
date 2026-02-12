const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const router = express.Router();
const PORT = process.env.PORT || 3001;

// ディレクトリ作成
['data', 'data/backups', 'uploads'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// データベース初期化
const db = new Database('./data/database.sqlite');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS income (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    amount INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT '振込',
    description TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    amount INTEGER NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    receipt_path TEXT,
    source TEXT DEFAULT 'manual',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  );
`);

// ファイルアップロード設定
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `receipt_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|heic/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(null, ext || mime);
  }
});

// === ルーターにミドルウェアとルート定義 ===
router.use(express.json());
router.use(express.static(path.join(__dirname, 'public')));
router.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// === 収入 API ===

// 収入追加
router.post('/api/income', (req, res) => {
  try {
    const { date, amount, type, description } = req.body;
    if (!date || !amount) return res.status(400).json({ error: '日付と金額は必須です' });

    const stmt = db.prepare(
      'INSERT INTO income (date, amount, type, description) VALUES (?, ?, ?, ?)'
    );
    const result = stmt.run(date, parseInt(amount), type || '振込', description || '');
    res.json({ id: result.lastInsertRowid, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 収入一覧
router.get('/api/income', (req, res) => {
  try {
    const { year, month } = req.query;
    let sql = 'SELECT * FROM income';
    const params = [];

    if (year) {
      sql += " WHERE strftime('%Y', date) = ?";
      params.push(year);
      if (month) {
        sql += " AND strftime('%m', date) = ?";
        params.push(month.padStart(2, '0'));
      }
    }
    sql += ' ORDER BY date DESC, id DESC';

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 収入更新
router.put('/api/income/:id', (req, res) => {
  try {
    const { date, amount, type, description } = req.body;
    const stmt = db.prepare(
      "UPDATE income SET date=?, amount=?, type=?, description=?, updated_at=datetime('now','localtime') WHERE id=?"
    );
    stmt.run(date, parseInt(amount), type, description, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 収入削除
router.delete('/api/income/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM income WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === 経費 API ===

// 経費追加
router.post('/api/expense', upload.single('receipt'), (req, res) => {
  try {
    const { date, amount, category, description, source } = req.body;
    if (!date || !amount || !category) {
      return res.status(400).json({ error: '日付、金額、科目は必須です' });
    }

    const receiptPath = req.file ? `/uploads/${req.file.filename}` : null;
    const stmt = db.prepare(
      'INSERT INTO expenses (date, amount, category, description, receipt_path, source) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const result = stmt.run(
      date, parseInt(amount), category, description || '', receiptPath, source || 'manual'
    );
    res.json({ id: result.lastInsertRowid, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 経費一覧
router.get('/api/expenses', (req, res) => {
  try {
    const { year, month, category } = req.query;
    let sql = 'SELECT * FROM expenses';
    const conditions = [];
    const params = [];

    if (year) {
      conditions.push("strftime('%Y', date) = ?");
      params.push(year);
    }
    if (month) {
      conditions.push("strftime('%m', date) = ?");
      params.push(month.padStart(2, '0'));
    }
    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY date DESC, id DESC';

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 経費更新
router.put('/api/expense/:id', (req, res) => {
  try {
    const { date, amount, category, description } = req.body;
    const stmt = db.prepare(
      "UPDATE expenses SET date=?, amount=?, category=?, description=?, updated_at=datetime('now','localtime') WHERE id=?"
    );
    stmt.run(date, parseInt(amount), category, description, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 経費削除
router.delete('/api/expense/:id', (req, res) => {
  try {
    const expense = db.prepare('SELECT receipt_path FROM expenses WHERE id = ?').get(req.params.id);
    if (expense && expense.receipt_path) {
      const filePath = path.join(__dirname, expense.receipt_path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === 集計 API ===

// 年間サマリー
router.get('/api/summary/:year', (req, res) => {
  try {
    const year = req.params.year;

    const incomeTotal = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM income WHERE strftime('%Y', date) = ?"
    ).get(year);

    const expenseTotal = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE strftime('%Y', date) = ?"
    ).get(year);

    const breakdown = db.prepare(
      "SELECT category, SUM(amount) as total, COUNT(*) as count FROM expenses WHERE strftime('%Y', date) = ? GROUP BY category ORDER BY total DESC"
    ).all(year);

    const monthlyIncome = db.prepare(
      "SELECT strftime('%m', date) as month, SUM(amount) as total FROM income WHERE strftime('%Y', date) = ? GROUP BY strftime('%m', date) ORDER BY month"
    ).all(year);

    const monthlyExpense = db.prepare(
      "SELECT strftime('%m', date) as month, SUM(amount) as total FROM expenses WHERE strftime('%Y', date) = ? GROUP BY strftime('%m', date) ORDER BY month"
    ).all(year);

    res.json({
      year,
      income: incomeTotal.total,
      expenses: expenseTotal.total,
      profit: incomeTotal.total - expenseTotal.total,
      breakdown,
      monthlyIncome,
      monthlyExpense
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ダッシュボード（今月・今年の概要）
router.get('/api/dashboard', (req, res) => {
  try {
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');

    const yearIncome = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM income WHERE strftime('%Y', date) = ?"
    ).get(year);
    const yearExpense = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE strftime('%Y', date) = ?"
    ).get(year);

    const monthIncome = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM income WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ?"
    ).get(year, month);
    const monthExpense = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ?"
    ).get(year, month);

    const recentIncome = db.prepare(
      "SELECT id, date, amount, type as category, description, 'income' as kind, created_at FROM income ORDER BY date DESC, id DESC LIMIT 10"
    ).all();
    const recentExpenses = db.prepare(
      "SELECT id, date, amount, category, description, 'expense' as kind, created_at FROM expenses ORDER BY date DESC, id DESC LIMIT 10"
    ).all();
    const recentTransactions = [...recentIncome, ...recentExpenses]
      .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0))
      .slice(0, 10);

    const categoryBreakdown = db.prepare(
      "SELECT category, SUM(amount) as total FROM expenses WHERE strftime('%Y', date) = ? GROUP BY category ORDER BY total DESC"
    ).all(year);

    const monthlyTrend = db.prepare(`
      SELECT m.month,
        COALESCE(i.total, 0) as income,
        COALESCE(e.total, 0) as expense
      FROM (
        SELECT '01' as month UNION SELECT '02' UNION SELECT '03' UNION SELECT '04'
        UNION SELECT '05' UNION SELECT '06' UNION SELECT '07' UNION SELECT '08'
        UNION SELECT '09' UNION SELECT '10' UNION SELECT '11' UNION SELECT '12'
      ) m
      LEFT JOIN (
        SELECT strftime('%m', date) as month, SUM(amount) as total
        FROM income WHERE strftime('%Y', date) = ? GROUP BY strftime('%m', date)
      ) i ON m.month = i.month
      LEFT JOIN (
        SELECT strftime('%m', date) as month, SUM(amount) as total
        FROM expenses WHERE strftime('%Y', date) = ? GROUP BY strftime('%m', date)
      ) e ON m.month = e.month
      ORDER BY m.month
    `).all(year, year);

    res.json({
      year: parseInt(year),
      month: parseInt(month),
      yearIncome: yearIncome.total,
      yearExpense: yearExpense.total,
      yearProfit: yearIncome.total - yearExpense.total,
      monthIncome: monthIncome.total,
      monthExpense: monthExpense.total,
      recentTransactions,
      categoryBreakdown,
      monthlyTrend
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === AI フォーマット出力 ===
router.get('/api/ai-format/:year', (req, res) => {
  try {
    const year = req.params.year;

    const income = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM income WHERE strftime('%Y', date) = ?"
    ).get(year);

    const expenses = db.prepare(
      "SELECT category, SUM(amount) as total FROM expenses WHERE strftime('%Y', date) = ? GROUP BY category ORDER BY total DESC"
    ).all(year);

    const expenseTotal = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE strftime('%Y', date) = ?"
    ).get(year);

    const categoryNames = {
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
    };

    const incomeTotal = income.total;
    const expenseSum = expenseTotal.total;
    const blueDeduction = 650000;
    const taxableIncome = incomeTotal - expenseSum - blueDeduction;

    let text = `【${year}年分 確定申告データまとめ】\n\n`;
    text += `期間: ${year}/01/01 - ${year}/12/31\n`;
    text += `総収入: ${incomeTotal.toLocaleString()}円\n`;
    text += `総経費: ${expenseSum.toLocaleString()}円\n\n`;
    text += `【経費内訳】\n`;

    expenses.forEach(item => {
      const name = categoryNames[item.category] || item.category;
      text += `  ${name}: ${item.total.toLocaleString()}円\n`;
    });

    text += `\n【控除・所得】\n`;
    text += `  青色申告特別控除: ${blueDeduction.toLocaleString()}円（65万円控除想定）\n`;
    text += `  課税所得目安: ${Math.max(0, taxableIncome).toLocaleString()}円\n\n`;
    text += `【質問・コメント】\n`;
    text += `  ここに質問を記入してください\n`;

    res.json({
      text,
      data: {
        income: incomeTotal,
        expenses: expenseSum,
        taxableIncome: Math.max(0, taxableIncome),
        breakdown: expenses
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === 科目自動推定ロジック ===
const categoryKeywords = {
  travel: ['交通', '電車', 'JR', 'Suica', 'PASMO', 'タクシー', 'バス', '新幹線', 'ANA', 'JAL', '航空', '高速', 'ETC', 'ガソリン', '駐車', '鉄道', 'きっぷ', '空港', 'エクスプレス', 'uber', 'Uber'],
  communication: ['通信', '電話', '携帯', 'ソフトバンク', 'au', 'docomo', 'NTT', 'インターネット', 'WiFi', 'AWS', 'さくら', 'サーバー', 'ドメイン', 'Xserver', 'ConoHa', 'Zoom', 'Slack', 'Google Cloud', 'Azure', 'Heroku', 'Vercel'],
  supplies: ['Amazon', 'アマゾン', 'ヨドバシ', 'ビックカメラ', '文具', '事務', 'コピー', '用紙', 'インク', 'トナー', '100均', 'ダイソー', 'セリア', 'ホームセンター', 'コーナン', 'カインズ', 'ニトリ', 'IKEA', '消耗品', 'USB', 'ケーブル', '電池', '文房具', 'LOFT', '東急ハンズ', 'ハンズ'],
  advertising: ['広告', 'Google Ads', 'Facebook', 'Instagram', 'Twitter', '宣伝', 'チラシ', '印刷', 'PR', 'マーケティング', 'SEO', 'Yahoo', 'LINE広告', 'TikTok'],
  entertainment: ['飲食', '居酒屋', 'レストラン', '食事', 'ランチ', 'ディナー', '会食', '懇親', '接待', 'カフェ', 'スターバックス', 'Starbucks', 'タリーズ', 'ドトール', 'マクドナルド', 'McDonald', 'ガスト', 'サイゼリヤ', 'すき家', '吉野家', '松屋', 'コンビニ', 'セブン', 'ファミリーマート', 'ローソン', '弁当', 'ウーバーイーツ', 'UberEats', '出前館'],
  outsourcing: ['外注', '業務委託', 'ランサーズ', 'クラウドワークス', 'ココナラ', 'Fiverr', 'Upwork', 'デザイン料', '開発費', '翻訳'],
  fees: ['振込手数料', '手数料', 'PayPal', 'Stripe', '決済', '銀行', 'ATM', '送金', 'カード年会費', '年会費'],
  home_office: ['電気', 'ガス', '水道', '家賃', '光熱'],
  depreciation: ['パソコン', 'PC', 'Mac', 'MacBook', 'iPhone', 'iPad', 'カメラ', 'ディスプレイ', 'モニター', 'プリンター']
};

function suggestCategory(description) {
  if (!description) return 'misc';
  const desc = description.toLowerCase();
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    for (const keyword of keywords) {
      if (desc.includes(keyword.toLowerCase())) {
        return category;
      }
    }
  }
  return 'misc';
}

// 日付フォーマット正規化
function normalizeDate(dateStr) {
  if (!dateStr) return '';
  // すでに YYYY-MM-DD 形式
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  // YYYY/MM/DD
  const slash = dateStr.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (slash) return `${slash[1]}-${slash[2].padStart(2,'0')}-${slash[3].padStart(2,'0')}`;
  // 和暦 R6 → 2024 etc.
  const wareki = dateStr.match(/[RＲ令](\d{1,2})[\.\/年](\d{1,2})[\.\/月](\d{1,2})/);
  if (wareki) {
    const year = 2018 + parseInt(wareki[1]);
    return `${year}-${wareki[2].padStart(2,'0')}-${wareki[3].padStart(2,'0')}`;
  }
  // MM/DD/YYYY or DD/MM/YYYY (try best)
  const mdy = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;
  // 2024年1月15日
  const jpDate = dateStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (jpDate) return `${jpDate[1]}-${jpDate[2].padStart(2,'0')}-${jpDate[3].padStart(2,'0')}`;
  return dateStr;
}

// === CSV インポート ===

// CSVプレビュー（科目自動推定付き）
router.post('/api/preview-csv', upload.single('csv'), (req, res) => {
  try {
    const Papa = require('papaparse');
    const csvContent = fs.readFileSync(req.file.path, 'utf-8');
    const { data, meta } = Papa.parse(csvContent, { header: true, skipEmptyLines: true });

    const rows = [];
    for (const row of data) {
      const rawDate = row['利用日'] || row['ご利用日'] || row['日付'] || row['Date'] || row['利用年月日'] || '';
      const rawAmount = row['金額'] || row['利用金額'] || row['Amount'] || row['ご利用金額'] || row['支払金額'] || '0';
      const desc = row['利用店舗'] || row['ご利用先'] || row['摘要'] || row['Description'] || row['ご利用先など'] || row['利用先'] || '';

      const date = normalizeDate(rawDate);
      const amount = Math.abs(parseInt(String(rawAmount).replace(/[^0-9\-]/g, '')) || 0);

      if (date && amount > 0) {
        rows.push({
          date,
          amount,
          description: desc.trim(),
          category: suggestCategory(desc)
        });
      }
    }

    // 一時ファイル削除
    fs.unlinkSync(req.file.path);

    res.json({ success: true, rows, headers: meta.fields || [] });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: err.message });
  }
});

// CSV一括登録（プレビュー確認後）
router.post('/api/import-csv', express.json({ limit: '10mb' }), (req, res) => {
  try {
    const { rows } = req.body;
    if (!rows || !Array.isArray(rows)) {
      return res.status(400).json({ error: '取引データが必要です' });
    }

    const stmt = db.prepare(
      'INSERT INTO expenses (date, amount, category, description, source) VALUES (?, ?, ?, ?, ?)'
    );

    const insertMany = db.transaction((items) => {
      let count = 0;
      for (const item of items) {
        if (item.date && item.amount > 0) {
          stmt.run(item.date, Math.abs(item.amount), item.category || 'misc', item.description || '', 'csv');
          count++;
        }
      }
      return count;
    });

    const count = insertMany(rows);
    res.json({ success: true, imported: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 科目推定API（フロントエンドからも利用可能）
router.post('/api/suggest-category', express.json(), (req, res) => {
  const { description } = req.body;
  res.json({ category: suggestCategory(description) });
});

// === バックアップ ===
router.get('/api/export', (req, res) => {
  try {
    const income = db.prepare('SELECT * FROM income ORDER BY date').all();
    const expenses = db.prepare('SELECT * FROM expenses ORDER BY date').all();

    const exportData = {
      exportDate: new Date().toISOString(),
      income,
      expenses,
      summary: {
        totalIncome: income.reduce((sum, r) => sum + r.amount, 0),
        totalExpenses: expenses.reduce((sum, r) => sum + r.amount, 0),
        incomeCount: income.length,
        expenseCount: expenses.length
      }
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=tax-backup-${new Date().toISOString().slice(0, 10)}.json`);
    res.json(exportData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === ルーターをマウント ===
// /tax パスと / の両方で動作させる（本番: /tax、ローカル: /）
app.use('/tax', router);
app.use('/', router);

// /tax へのアクセスを /tax/ にリダイレクト
app.get('/tax', (req, res) => {
  if (!req.originalUrl.endsWith('/') && !req.originalUrl.includes('.') && !req.originalUrl.includes('/api/')) {
    return res.redirect(301, '/tax/');
  }
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`\n  ┌──────────────────────────────────────┐`);
  console.log(`  │                                      │`);
  console.log(`  │   💰 経費管理ツール 起動完了          │`);
  console.log(`  │   http://localhost:${PORT}              │`);
  console.log(`  │                                      │`);
  console.log(`  └──────────────────────────────────────┘\n`);
});
