# 技術スタック・実装方法

## 🎯 技術選定の理由

| 項目 | 選択 | 理由 |
|------|------|------|
| **Frontend** | HTML + Vanilla JS | ビルド不要、依存ゼロ、即デプロイ可能 |
| **CSS** | Tailwind CDN or Pico CSS | 軽量、レスポンシブ対応済み |
| **Backend** | Node.js + Express | サーバーにあるはず、シンプル |
| **DB** | SQLite | ファイル1つ、インストール不要 |
| **OCR** | Tesseract.js | ブラウザで完結、無料 |
| **CSV Parse** | PapaParse | 軽量、使いやすい |
| **グラフ** | Chart.js | 軽量、見た目良い |

---

## 📦 必要なパッケージ（最小限）

### Node.js版 package.json

```json
{
  "name": "tax-tool",
  "version": "1.0.0",
  "main": "server.js",
  "dependencies": {
    "express": "^4.18.2",
    "sqlite3": "^5.1.6",
    "multer": "^1.4.5-lts.1",
    "papaparse": "^5.4.1"
  }
}
```

インストール：
```bash
npm install
```

---

## 🗂️ ファイル構成

```
tax-tool/
├── server.js              # バックエンド（200行程度）
├── package.json
├── public/
│   ├── index.html         # メイン画面（1ページ完結）
│   ├── style.css          # スタイル
│   └── app.js             # フロントロジック（300-500行）
├── data/
│   ├── database.sqlite    # SQLiteファイル
│   └── backups/           # バックアップ格納
├── uploads/               # レシート画像
└── README.md
```

---

## 🖥️ バックエンド実装（Node.js + Express）

### server.js（完全版）

```javascript
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');

const app = express();
const PORT = 3001;

// データベース初期化
const db = new sqlite3.Database('./data/database.sqlite');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS income (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    amount INTEGER NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    amount INTEGER NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    receipt_path TEXT,
    source TEXT DEFAULT 'manual',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// ミドルウェア
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// ファイルアップロード設定
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// === API エンドポイント ===

// 収入追加
app.post('/api/income', (req, res) => {
  const { date, amount, type, description } = req.body;
  db.run(
    "INSERT INTO income (date, amount, type, description) VALUES (?, ?, ?, ?)",
    [date, amount, type, description],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, success: true });
    }
  );
});

// 経費追加
app.post('/api/expense', upload.single('receipt'), (req, res) => {
  const { date, amount, category, description, source } = req.body;
  const receiptPath = req.file ? `/uploads/${req.file.filename}` : null;
  
  db.run(
    "INSERT INTO expenses (date, amount, category, description, receipt_path, source) VALUES (?, ?, ?, ?, ?, ?)",
    [date, amount, category, description, receiptPath, source || 'manual'],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, success: true });
    }
  );
});

// 収入一覧
app.get('/api/income', (req, res) => {
  db.all("SELECT * FROM income ORDER BY date DESC", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 経費一覧
app.get('/api/expenses', (req, res) => {
  db.all("SELECT * FROM expenses ORDER BY date DESC", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 集計（年別・科目別）
app.get('/api/summary/:year', (req, res) => {
  const year = req.params.year;
  
  // 収入合計
  db.get(
    "SELECT SUM(amount) as total FROM income WHERE strftime('%Y', date) = ?",
    [year],
    (err, incomeRow) => {
      // 経費科目別
      db.all(
        "SELECT category, SUM(amount) as total FROM expenses WHERE strftime('%Y', date) = ? GROUP BY category",
        [year],
        (err, expenseRows) => {
          // 経費合計
          db.get(
            "SELECT SUM(amount) as total FROM expenses WHERE strftime('%Y', date) = ?",
            [year],
            (err, expenseTotal) => {
              res.json({
                year: year,
                income: incomeRow.total || 0,
                expenses: expenseTotal.total || 0,
                breakdown: expenseRows
              });
            }
          );
        }
      );
    }
  );
});

// AI用フォーマット出力
app.get('/api/ai-format/:year', (req, res) => {
  const year = req.params.year;
  
  db.get("SELECT SUM(amount) as total FROM income WHERE strftime('%Y', date) = ?", [year], (err, income) => {
    db.all("SELECT category, SUM(amount) as total FROM expenses WHERE strftime('%Y', date) = ? GROUP BY category", [year], (err, expenses) => {
      db.get("SELECT SUM(amount) as total FROM expenses WHERE strftime('%Y', date) = ?", [year], (err, expenseTotal) => {
        
        const incomeTotal = income.total || 0;
        const expenseSum = expenseTotal.total || 0;
        const blueDeduction = 650000;
        const taxableIncome = incomeTotal - expenseSum - blueDeduction;
        
        // テキスト形式で出力
        let text = `【${year}年分 データまとめ】\n\n`;
        text += `期間: ${year}/01/01 - ${year}/12/31\n`;
        text += `総収入: ${incomeTotal.toLocaleString()}円\n`;
        text += `総経費: ${expenseSum.toLocaleString()}円\n\n`;
        text += `内訳:\n`;
        
        expenses.forEach(item => {
          const categoryNames = {
            'outsourcing': '外注工賃',
            'travel': '旅費交通費',
            'communication': '通信費',
            'supplies': '消耗品費',
            'advertising': '広告宣伝費',
            'entertainment': '接待交際費',
            'depreciation': '減価償却費',
            'home_office': '家事按分',
            'fees': '支払手数料',
            'misc': '雑費'
          };
          text += `- ${categoryNames[item.category] || item.category}: ${item.total.toLocaleString()}円\n`;
        });
        
        text += `\n青色特別控除: ${blueDeduction.toLocaleString()}円想定\n`;
        text += `課税所得目安: ${taxableIncome.toLocaleString()}円\n\n`;
        text += `コメント/質問: [ここに自由記述]\n`;
        
        res.json({ text: text, data: { income: incomeTotal, expenses: expenseSum, breakdown: expenses } });
      });
    });
  });
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`✅ Tax Tool サーバー起動: http://localhost:${PORT}`);
});
```

---

## 🌐 フロントエンド実装

### public/index.html（シンプル版）

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>経費管理ツール</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@1/css/pico.min.css">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main class="container">
    <h1>💰 経費管理ツール</h1>
    
    <!-- 入力フォーム -->
    <section>
      <div style="display: flex; gap: 1rem; margin-bottom: 2rem;">
        <button id="btn-income" class="large">+ 収入</button>
        <button id="btn-expense" class="large secondary">+ 経費</button>
      </div>
      
      <!-- フォーム（動的に切り替え） -->
      <form id="form-main">
        <label>日付 <input type="date" id="input-date" required></label>
        <label>金額 <input type="number" id="input-amount" placeholder="0" required></label>
        
        <!-- 経費用のみ表示 -->
        <label id="label-category" style="display: none;">
          科目
          <select id="input-category">
            <option value="outsourcing">外注工賃</option>
            <option value="travel">旅費交通費</option>
            <option value="communication">通信費</option>
            <option value="supplies">消耗品費</option>
            <option value="advertising">広告宣伝費</option>
            <option value="entertainment">接待交際費</option>
            <option value="depreciation">減価償却費</option>
            <option value="home_office">家事按分</option>
            <option value="fees">支払手数料</option>
            <option value="misc">雑費</option>
          </select>
        </label>
        
        <label>摘要 <input type="text" id="input-description"></label>
        
        <!-- レシートアップロード（経費のみ） -->
        <label id="label-receipt" style="display: none;">
          レシート
          <input type="file" id="input-receipt" accept="image/*">
        </label>
        
        <button type="submit">保存</button>
      </form>
    </section>
    
    <!-- 集計表示 -->
    <section>
      <h2>集計</h2>
      <label>年
        <input type="number" id="year-select" value="2025" min="2020" max="2030">
      </label>
      <button id="btn-summary">集計を見る</button>
      <button id="btn-ai-format">AI用フォーマット出力</button>
      
      <div id="summary-result" style="margin-top: 1rem;"></div>
      <textarea id="ai-output" rows="15" style="display: none; font-family: monospace;"></textarea>
    </section>
  </main>
  
  <script src="app.js"></script>
</body>
</html>
```

### public/app.js（ロジック）

```javascript
let currentMode = 'expense'; // 'income' or 'expense'

// 今日の日付をデフォルト
document.getElementById('input-date').valueAsDate = new Date();

// モード切り替え
document.getElementById('btn-income').addEventListener('click', () => {
  currentMode = 'income';
  document.getElementById('label-category').style.display = 'none';
  document.getElementById('label-receipt').style.display = 'none';
});

document.getElementById('btn-expense').addEventListener('click', () => {
  currentMode = 'expense';
  document.getElementById('label-category').style.display = 'block';
  document.getElementById('label-receipt').style.display = 'block';
});

// フォーム送信
document.getElementById('form-main').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const date = document.getElementById('input-date').value;
  const amount = parseInt(document.getElementById('input-amount').value);
  const description = document.getElementById('input-description').value;
  
  if (currentMode === 'income') {
    // 収入保存
    await fetch('/api/income', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, amount, type: '振込', description })
    });
    alert('収入を保存しました');
  } else {
    // 経費保存
    const category = document.getElementById('input-category').value;
    const formData = new FormData();
    formData.append('date', date);
    formData.append('amount', amount);
    formData.append('category', category);
    formData.append('description', description);
    
    const receiptFile = document.getElementById('input-receipt').files[0];
    if (receiptFile) {
      formData.append('receipt', receiptFile);
    }
    
    await fetch('/api/expense', {
      method: 'POST',
      body: formData
    });
    alert('経費を保存しました');
  }
  
  // フォームリセット
  e.target.reset();
  document.getElementById('input-date').valueAsDate = new Date();
});

// 集計表示
document.getElementById('btn-summary').addEventListener('click', async () => {
  const year = document.getElementById('year-select').value;
  const res = await fetch(`/api/summary/${year}`);
  const data = await res.json();
  
  let html = `<h3>${year}年の集計</h3>`;
  html += `<p>総収入: <strong>${data.income.toLocaleString()}円</strong></p>`;
  html += `<p>総経費: <strong>${data.expenses.toLocaleString()}円</strong></p>`;
  html += `<p>粗利益: <strong>${(data.income - data.expenses).toLocaleString()}円</strong></p>`;
  html += `<h4>経費内訳</h4><ul>`;
  
  data.breakdown.forEach(item => {
    html += `<li>${item.category}: ${item.total.toLocaleString()}円</li>`;
  });
  html += `</ul>`;
  
  document.getElementById('summary-result').innerHTML = html;
});

// AI用フォーマット出力
document.getElementById('btn-ai-format').addEventListener('click', async () => {
  const year = document.getElementById('year-select').value;
  const res = await fetch(`/api/ai-format/${year}`);
  const data = await res.json();
  
  const textarea = document.getElementById('ai-output');
  textarea.style.display = 'block';
  textarea.value = data.text;
  textarea.select();
  
  // クリップボードにコピー
  navigator.clipboard.writeText(data.text);
  alert('AI用フォーマットをクリップボードにコピーしました！\nGrokに貼り付けてください。');
});
```

---

## 📱 PWA対応（ホーム画面追加）

### public/manifest.json

```json
{
  "name": "経費管理ツール",
  "short_name": "経費管理",
  "start_url": "/tax",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#3b82f6",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    }
  ]
}
```

index.htmlに追加：
```html
<link rel="manifest" href="manifest.json">
```

---

## 🔧 起動・テスト

```bash
# 開発環境起動
node server.js

# ブラウザでアクセス
open http://localhost:3001
```

---

**更新日**: 2026年2月12日  
**言語**: Node.js + Vanilla JS（依存最小限）
