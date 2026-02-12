# データベース設定（シンプル構成）

## 🗄️ データベースの選択

個人用ツールなので、**シンプルで軽量**なデータベースを使用します。

### 推奨：SQLite（ファイル1つで完結）

**メリット:**
- ✅ インストール不要
- ✅ ファイル1つで管理が簡単
- ✅ バックアップが容易（ファイルコピーだけ）
- ✅ 十分な性能（個人用には過剰なくらい）

**ファイル配置:**
```
/var/www/tax-tool/data/database.sqlite
```

---

## 📋 データベース構造

### テーブル設計（最小限3テーブル）

#### 1. `income` テーブル（収入）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | INTEGER PRIMARY KEY | 自動採番 |
| date | DATE | 入金日 |
| amount | INTEGER | 金額（円） |
| type | TEXT | 種類（振込/現金/その他） |
| description | TEXT | 摘要 |
| created_at | DATETIME | 登録日時 |

#### 2. `expenses` テーブル（経費）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | INTEGER PRIMARY KEY | 自動採番 |
| date | DATE | 支払日 |
| amount | INTEGER | 金額（円） |
| category | TEXT | 勘定科目（10種固定） |
| description | TEXT | 摘要 |
| receipt_path | TEXT | レシート画像パス（任意） |
| source | TEXT | 入力元（manual/ocr/csv） |
| created_at | DATETIME | 登録日時 |

#### 3. `settings` テーブル（設定）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| key | TEXT PRIMARY KEY | 設定キー |
| value | TEXT | 設定値（JSON可） |
| updated_at | DATETIME | 更新日時 |

---

## 🔧 SQLite セットアップ

### Node.js版（sqlite3パッケージ使用）

#### インストール
```bash
npm install sqlite3
```

#### 初期化コード（server.js）

```javascript
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/database.sqlite');

// テーブル作成
db.serialize(() => {
  // 収入テーブル
  db.run(`CREATE TABLE IF NOT EXISTS income (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    amount INTEGER NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 経費テーブル
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

  // 設定テーブル
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});
```

### Python版（sqlite3標準ライブラリ）

#### 初期化コード（app.py）

```python
import sqlite3
from datetime import datetime

def init_db():
    conn = sqlite3.connect('data/database.sqlite')
    c = conn.cursor()
    
    # 収入テーブル
    c.execute('''CREATE TABLE IF NOT EXISTS income (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date DATE NOT NULL,
        amount INTEGER NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )''')
    
    # 経費テーブル
    c.execute('''CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date DATE NOT NULL,
        amount INTEGER NOT NULL,
        category TEXT NOT NULL,
        description TEXT,
        receipt_path TEXT,
        source TEXT DEFAULT 'manual',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )''')
    
    # 設定テーブル
    c.execute('''CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )''')
    
    conn.commit()
    conn.close()

# アプリ起動時に実行
init_db()
```

---

## 📊 勘定科目（10種固定）

データベースに保存する `category` 値：

| 科目コード | 日本語名 | 説明 |
|-----------|---------|------|
| `outsourcing` | 外注工賃 | 甥っ子報酬など |
| `travel` | 旅費交通費 | ホテル調査移動費 |
| `communication` | 通信費 | スマホ・ネット代 |
| `supplies` | 消耗品費 | PC周辺・文具 |
| `advertising` | 広告宣伝費 | ツール・サービス代 |
| `entertainment` | 接待交際費 | 打ち合わせ飲食 |
| `depreciation` | 減価償却費 | PC等（2年前購入） |
| `home_office` | 家事按分 | 家賃・光熱費一部 |
| `fees` | 支払手数料 | 振込手数料等 |
| `misc` | 雑費 | その他 |

### フロントエンドのドロップダウン用配列（JavaScript）

```javascript
const categories = [
  { value: 'outsourcing', label: '外注工賃' },
  { value: 'travel', label: '旅費交通費' },
  { value: 'communication', label: '通信費' },
  { value: 'supplies', label: '消耗品費' },
  { value: 'advertising', label: '広告宣伝費' },
  { value: 'entertainment', label: '接待交際費' },
  { value: 'depreciation', label: '減価償却費' },
  { value: 'home_office', label: '家事按分' },
  { value: 'fees', label: '支払手数料' },
  { value: 'misc', label: '雑費' }
];
```

---

## 🔍 基本的なクエリ例

### データ挿入（経費）

```javascript
// Node.js
const stmt = db.prepare("INSERT INTO expenses (date, amount, category, description) VALUES (?, ?, ?, ?)");
stmt.run('2025-02-12', 5000, 'travel', '渋谷→新宿 タクシー');
stmt.finalize();
```

```python
# Python
conn = sqlite3.connect('data/database.sqlite')
c = conn.cursor()
c.execute("INSERT INTO expenses (date, amount, category, description) VALUES (?, ?, ?, ?)",
          ('2025-02-12', 5000, 'travel', '渋谷→新宿 タクシー'))
conn.commit()
conn.close()
```

### 月別集計

```sql
SELECT 
  strftime('%Y-%m', date) as month,
  SUM(amount) as total
FROM expenses
WHERE date BETWEEN '2025-01-01' AND '2025-12-31'
GROUP BY strftime('%Y-%m', date)
ORDER BY month;
```

### 科目別集計

```sql
SELECT 
  category,
  SUM(amount) as total,
  COUNT(*) as count
FROM expenses
WHERE date BETWEEN '2025-01-01' AND '2025-12-31'
GROUP BY category
ORDER BY total DESC;
```

---

## 💾 バックアップ方法

### 方法1: SQLiteファイルをコピー

```bash
# 手動バックアップ
cp data/database.sqlite data/backups/backup_$(date +%Y%m%d).sqlite

# 自動バックアップ（cronで週1実行）
0 3 * * 0 cp /var/www/tax-tool/data/database.sqlite /var/www/tax-tool/data/backups/backup_$(date +\%Y\%m\%d).sqlite
```

### 方法2: JSONエクスポート

アプリ内に「エクスポート」ボタンを実装：

```javascript
// 全データをJSON化
app.get('/api/export', (req, res) => {
  db.all("SELECT * FROM income", (err, income) => {
    db.all("SELECT * FROM expenses", (err, expenses) => {
      res.json({
        income: income,
        expenses: expenses,
        exported_at: new Date().toISOString()
      });
    });
  });
});
```

ブラウザで `https://fashionhoteljoy.com/tax/api/export` にアクセス → JSON保存

---

## 🔄 データインポート（CSV）

### クレカ明細CSVパース例

```javascript
const Papa = require('papaparse');

// CSVアップロード処理
app.post('/api/import-csv', upload.single('csvfile'), (req, res) => {
  const csvData = req.file.buffer.toString('utf8');
  
  Papa.parse(csvData, {
    header: true,
    complete: (results) => {
      results.data.forEach(row => {
        // CSVの列名に合わせて調整
        const date = row['利用日'];      // 例
        const amount = row['金額'];
        const description = row['利用店舗'];
        
        db.run(
          "INSERT INTO expenses (date, amount, category, description, source) VALUES (?, ?, ?, ?, 'csv')",
          [date, amount, 'misc', description]  // 科目は'misc'でデフォルト
        );
      });
      res.json({ success: true, count: results.data.length });
    }
  });
});
```

---

## 🚨 注意事項

### 書き込み権限

```bash
# dataディレクトリに書き込み権限付与
chmod 755 /var/www/tax-tool/data
chmod 644 /var/www/tax-tool/data/database.sqlite
```

### 同時書き込み

SQLiteは個人用なので問題ないが、念のため：
- 複数タブで同時編集しない
- バックアップ中は操作しない

---

## 📈 Alternative: JSONファイル（超シンプル版）

SQLiteすら不要な場合、JSONファイルで保存も可能：

```javascript
const fs = require('fs');

// データ読み込み
const data = JSON.parse(fs.readFileSync('./data/data.json', 'utf8'));

// データ追加
data.expenses.push({
  date: '2025-02-12',
  amount: 5000,
  category: 'travel',
  description: 'タクシー'
});

// 保存
fs.writeFileSync('./data/data.json', JSON.stringify(data, null, 2));
```

**メリット:** 依存ゼロ、超シンプル  
**デメリット:** 集計クエリが手動、データ量が多いと遅い

---

**更新日**: 2026年2月12日  
**推奨**: SQLite使用（シンプル＋高性能）
