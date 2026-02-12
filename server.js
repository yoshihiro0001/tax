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

// === CSV インポート ===
router.post('/api/import-csv', upload.single('csv'), (req, res) => {
  try {
    const Papa = require('papaparse');
    const csvContent = fs.readFileSync(req.file.path, 'utf-8');
    const { data } = Papa.parse(csvContent, { header: true, skipEmptyLines: true });

    const stmt = db.prepare(
      'INSERT INTO expenses (date, amount, category, description, source) VALUES (?, ?, ?, ?, ?)'
    );

    const insertMany = db.transaction((rows) => {
      let count = 0;
      for (const row of rows) {
        const date = row['利用日'] || row['ご利用日'] || row['日付'] || row['Date'] || '';
        const amount = parseInt((row['金額'] || row['利用金額'] || row['Amount'] || '0').replace(/[^0-9-]/g, ''));
        const desc = row['利用店舗'] || row['ご利用先'] || row['摘要'] || row['Description'] || '';

        if (date && amount > 0) {
          stmt.run(date, Math.abs(amount), 'misc', desc, 'csv');
          count++;
        }
      }
      return count;
    });

    const count = insertMany(data);
    fs.unlinkSync(req.file.path);
    res.json({ success: true, imported: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
