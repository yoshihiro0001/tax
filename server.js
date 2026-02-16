const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const https = require('https');

const app = express();
const router = express.Router();
const PORT = process.env.PORT || 3001;

// === 設定読み込み ===
let GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
let ADMIN_EMAILS = [];
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
  if (cfg.GOOGLE_CLIENT_ID) GOOGLE_CLIENT_ID = cfg.GOOGLE_CLIENT_ID;
  if (cfg.ADMIN_EMAILS) ADMIN_EMAILS = cfg.ADMIN_EMAILS;
} catch (e) { /* config.json 未作成時は無視 */ }

function isAdminEmail(email) { return ADMIN_EMAILS.includes(email); }

// ディレクトリ作成
['data', 'data/backups', 'uploads'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// DB初期化
const db = new Database('./data/database.sqlite');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// === マイグレーション: 旧スキーマ対応 ===
try {
  // 1) income/expenses: book_idが無い場合は再作成
  const incCols = db.prepare("PRAGMA table_info(income)").all();
  if (incCols.length > 0 && !incCols.find(c => c.name === 'book_id')) {
    console.log('⚡ income/expenses 旧スキーマ検出、再構築...');
    db.exec('DROP TABLE IF EXISTS income; DROP TABLE IF EXISTS expenses;');
  }
  // 2) users: auth_providerが無い場合は再作成 (Google認証対応)
  const userCols = db.prepare("PRAGMA table_info(users)").all();
  if (userCols.length > 0 && !userCols.find(c => c.name === 'auth_provider')) {
    console.log('⚡ users 旧スキーマ検出、再構築...');
    db.exec('DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS users;');
  }
} catch (e) { /* テーブルが存在しない場合は無視 */ }

// 3) 既存テーブルにカラムがなければ追加
try { db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'"); } catch (e) { /* 既にある */ }
try { db.exec("ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'free'"); } catch (e) { /* 既にある */ }

// === テーブル作成 ===
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT,
    avatar_url TEXT,
    auth_provider TEXT DEFAULT 'local',
    role TEXT DEFAULT 'user',
    plan TEXT DEFAULT 'free',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    emoji TEXT DEFAULT '📒',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS income (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    amount INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT '振込',
    description TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    amount INTEGER NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    receipt_path TEXT,
    source TEXT DEFAULT 'manual',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
  );
`);

// === 運用管理テーブル ===
db.exec(`
  CREATE TABLE IF NOT EXISTS error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT DEFAULT 'error',
    message TEXT NOT NULL,
    endpoint TEXT,
    user_id INTEGER,
    stack TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'new',
    admin_reply TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
`);

// === マイグレーション: 既存テーブルにカラム追加 ===
const migrations = [
  "ALTER TABLE users ADD COLUMN avatar_url TEXT",
  "ALTER TABLE users ADD COLUMN auth_provider TEXT DEFAULT 'local'",
];
for (const sql of migrations) {
  try { db.exec(sql); } catch (e) { /* カラムが既に存在する場合は無視 */ }
}

// エラーログ記録ヘルパー
function logError(message, endpoint, userId, stack) {
  try { db.prepare('INSERT INTO error_logs (level, message, endpoint, user_id, stack) VALUES (?,?,?,?,?)').run('error', message, endpoint || '', userId || null, stack || ''); } catch {}
}
function logActivity(userId, action, details) {
  try { db.prepare('INSERT INTO activity_logs (user_id, action, details) VALUES (?,?,?)').run(userId || null, action, details || ''); } catch {}
}

// サーバー起動時刻
const SERVER_START = new Date().toISOString();

// ファイルアップロード設定
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => cb(null, `receipt_${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage, limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /jpeg|jpg|png|gif|webp|heic|csv/.test(path.extname(file.originalname).toLowerCase());
    cb(null, ok);
  }
});

// === ミドルウェア ===
router.use(express.json({ limit: '10mb' }));
router.use(cookieParser());
router.use(express.static(path.join(__dirname, 'public')));
router.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 認証ミドルウェア
function auth(req, res, next) {
  const token = req.cookies.session;
  if (!token) return res.status(401).json({ error: '未認証' });
  const session = db.prepare('SELECT user_id FROM sessions WHERE token = ? AND expires_at > datetime(\'now\',\'localtime\')').get(token);
  if (!session) return res.status(401).json({ error: 'セッション期限切れ' });
  req.userId = session.user_id;
  next();
}

// 帳簿アクセス確認
function bookAccess(req) {
  const bookId = parseInt(req.query.bookId || req.body.bookId);
  if (!bookId) return null;
  const book = db.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?').get(bookId, req.userId);
  return book || null;
}

// === 科目自動推定 ===
const categoryKeywords = {
  travel: ['交通','電車','JR','Suica','PASMO','タクシー','バス','新幹線','ANA','JAL','航空','高速','ETC','ガソリン','駐車','鉄道','Uber'],
  communication: ['通信','電話','携帯','ソフトバンク','au','docomo','NTT','WiFi','AWS','サーバー','ドメイン','Zoom','Slack','Vercel','Heroku'],
  supplies: ['Amazon','アマゾン','ヨドバシ','ビックカメラ','文具','事務','コピー','用紙','インク','100均','ダイソー','ニトリ','IKEA','消耗品','LOFT','ハンズ'],
  advertising: ['広告','Google Ads','Facebook','Instagram','Twitter','宣伝','チラシ','印刷','PR','SEO'],
  entertainment: ['飲食','居酒屋','レストラン','食事','ランチ','ディナー','会食','接待','カフェ','スターバックス','タリーズ','ドトール','マクドナルド','ガスト','コンビニ','セブン','ファミリーマート','ローソン','弁当'],
  outsourcing: ['外注','業務委託','ランサーズ','クラウドワークス','ココナラ','デザイン料','開発費'],
  fees: ['振込手数料','手数料','PayPal','Stripe','決済','銀行','ATM','送金','年会費'],
  home_office: ['電気','ガス','水道','家賃','光熱'],
  depreciation: ['パソコン','PC','Mac','MacBook','iPhone','iPad','カメラ','ディスプレイ','モニター','プリンター']
};

function suggestCategory(desc) {
  if (!desc) return 'misc';
  const d = desc.toLowerCase();
  for (const [cat, kws] of Object.entries(categoryKeywords)) {
    for (const kw of kws) { if (d.includes(kw.toLowerCase())) return cat; }
  }
  return 'misc';
}

function normalizeDate(s) {
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m = s.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m = s.match(/[RＲ令](\d{1,2})[\.\/年](\d{1,2})[\.\/月](\d{1,2})/);
  if (m) return `${2018+parseInt(m[1])}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  return s;
}

// ========================================
// 認証 API
// ========================================

router.post('/api/auth/register', async (req, res) => {
  try {
    const { email, name, password } = req.body;
    if (!email || !name || !password) return res.status(400).json({ error: '全項目を入力してください' });
    if (password.length < 6) return res.status(400).json({ error: 'パスワードは6文字以上' });

    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (exists) return res.status(400).json({ error: 'このメールアドレスは登録済みです' });

    const hash = await bcrypt.hash(password, 10);
    const role = isAdminEmail(email) ? 'admin' : 'user';
    const result = db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)').run(email, name, hash, role);
    const userId = result.lastInsertRowid;

    // デフォルト帳簿を作成
    db.prepare('INSERT INTO books (user_id, name, emoji) VALUES (?, ?, ?)').run(userId, '個人', '👤');

    // セッション作成
    const token = crypto.randomUUID();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);

    const isSecure = req.get('X-Forwarded-Proto') === 'https' || req.secure;
    res.cookie('session', token, { httpOnly: true, maxAge: 30*24*60*60*1000, sameSite: 'lax', path: '/', secure: isSecure });
    logActivity(userId, 'register', `新規登録: ${email}`);
    res.json({ success: true, user: { id: userId, email, name } });
  } catch (err) {
    logError(err.message, '/api/auth/register', null, err.stack);
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'メールとパスワードを入力' });

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return res.status(401).json({ error: 'メールまたはパスワードが正しくありません' });
    if (!user.password_hash || user.auth_provider === 'google') return res.status(401).json({ error: 'このアカウントはGoogleログインをご利用ください' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'メールまたはパスワードが正しくありません' });

    const token = crypto.randomUUID();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, expires);

    const isSecure = req.get('X-Forwarded-Proto') === 'https' || req.secure;
    res.cookie('session', token, { httpOnly: true, maxAge: 30*24*60*60*1000, sameSite: 'lax', path: '/', secure: isSecure });
    logActivity(user.id, 'login', `メールログイン: ${user.email}`);
    res.json({ success: true, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    logError(err.message, '/api/auth/login', null, err.stack);
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/auth/logout', (req, res) => {
  const token = req.cookies.session;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie('session', { path: '/' });
  res.json({ success: true });
});

// Google Token検証
function verifyGoogleToken(idToken) {
  return new Promise((resolve, reject) => {
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          if (info.error) reject(new Error(info.error_description || '無効なトークン'));
          else resolve(info);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

router.post('/api/auth/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'トークンがありません' });
    if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google認証が設定されていません' });

    const info = await verifyGoogleToken(credential);
    if (info.aud !== GOOGLE_CLIENT_ID) return res.status(401).json({ error: '無効なクライアントID' });
    if (info.email_verified !== 'true') return res.status(401).json({ error: 'メール未認証' });

    const email = info.email;
    const name = info.name || info.given_name || email.split('@')[0];
    const avatarUrl = info.picture || null;

    // 既存ユーザーを検索、なければ作成
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      const role = isAdminEmail(email) ? 'admin' : 'user';
      const r = db.prepare('INSERT INTO users (email, name, avatar_url, auth_provider, role) VALUES (?,?,?,?,?)').run(email, name, avatarUrl, 'google', role);
      const userId = r.lastInsertRowid;
      db.prepare('INSERT INTO books (user_id, name, emoji) VALUES (?, ?, ?)').run(userId, '個人', '👤');
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    } else {
      // アバター・role更新
      const role = isAdminEmail(email) ? 'admin' : user.role;
      db.prepare('UPDATE users SET avatar_url=COALESCE(?,avatar_url), role=? WHERE id=?').run(avatarUrl, role, user.id);
      user.role = role;
    }

    const token = crypto.randomUUID();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, expires);

    const isSecure = req.get('X-Forwarded-Proto') === 'https' || req.secure;
    res.cookie('session', token, { httpOnly: true, maxAge: 30*24*60*60*1000, sameSite: 'lax', path: '/', secure: isSecure });
    logActivity(user.id, 'login', `Googleログイン: ${user.email}`);
    res.json({ success: true, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    logError(err.message, '/api/auth/google', null, err.stack);
    res.status(500).json({ error: err.message });
  }
});

// 公開設定 (Googleクライアント IDなど)
router.get('/api/config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID || null });
});

router.get('/api/auth/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, email, name, avatar_url, auth_provider, role FROM users WHERE id = ?').get(req.userId);
  const books = db.prepare('SELECT * FROM books WHERE user_id = ? ORDER BY created_at').all(req.userId);
  res.json({ user, books });
});

// ========================================
// 帳簿 API
// ========================================

router.get('/api/books', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM books WHERE user_id = ? ORDER BY created_at').all(req.userId));
});

router.post('/api/books', auth, (req, res) => {
  const { name, emoji } = req.body;
  if (!name) return res.status(400).json({ error: '帳簿名を入力してください' });
  const r = db.prepare('INSERT INTO books (user_id, name, emoji) VALUES (?, ?, ?)').run(req.userId, name, emoji || '📒');
  res.json({ id: r.lastInsertRowid, success: true });
});

router.put('/api/books/:id', auth, (req, res) => {
  const { name, emoji } = req.body;
  const book = db.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!book) return res.status(404).json({ error: '帳簿が見つかりません' });
  db.prepare('UPDATE books SET name=?, emoji=? WHERE id=?').run(name || book.name, emoji || book.emoji, book.id);
  res.json({ success: true });
});

router.delete('/api/books/:id', auth, (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!book) return res.status(404).json({ error: '帳簿が見つかりません' });
  const count = db.prepare('SELECT COUNT(*) as c FROM books WHERE user_id = ?').get(req.userId);
  if (count.c <= 1) return res.status(400).json({ error: '最後の帳簿は削除できません' });
  db.prepare('DELETE FROM books WHERE id = ?').run(book.id);
  res.json({ success: true });
});

// ========================================
// 収入 API (帳簿スコープ)
// ========================================

router.post('/api/income', auth, (req, res) => {
  try {
    const { bookId, date, amount, type, description } = req.body;
    const book = bookAccess(req);
    if (!book) return res.status(403).json({ error: '帳簿アクセス権がありません' });
    if (!date || !amount) return res.status(400).json({ error: '日付と金額は必須' });
    const r = db.prepare('INSERT INTO income (book_id, date, amount, type, description) VALUES (?,?,?,?,?)').run(book.id, date, parseInt(amount), type || '振込', description || '');
    logActivity(req.userId, 'add_income', `収入追加: ¥${amount}`);
    res.json({ id: r.lastInsertRowid, success: true });
  } catch (err) { logError(err.message, '/api/income', req.userId, err.stack); res.status(500).json({ error: err.message }); }
});

router.get('/api/income', auth, (req, res) => {
  try {
    const book = bookAccess(req);
    if (!book) return res.status(403).json({ error: '帳簿アクセス権がありません' });
    const { year, month } = req.query;
    let sql = 'SELECT * FROM income WHERE book_id = ?';
    const params = [book.id];
    if (year) { sql += " AND strftime('%Y',date) = ?"; params.push(year); }
    if (month) { sql += " AND strftime('%m',date) = ?"; params.push(month.padStart(2,'0')); }
    sql += ' ORDER BY date DESC, id DESC';
    res.json(db.prepare(sql).all(...params));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/api/income/:id', auth, (req, res) => {
  try {
    const { date, amount, type, description } = req.body;
    const inc = db.prepare('SELECT i.* FROM income i JOIN books b ON i.book_id=b.id WHERE i.id=? AND b.user_id=?').get(req.params.id, req.userId);
    if (!inc) return res.status(404).json({ error: '見つかりません' });
    db.prepare("UPDATE income SET date=?,amount=?,type=?,description=?,updated_at=datetime('now','localtime') WHERE id=?").run(date, parseInt(amount), type, description, inc.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/api/income/:id', auth, (req, res) => {
  try {
    const inc = db.prepare('SELECT i.* FROM income i JOIN books b ON i.book_id=b.id WHERE i.id=? AND b.user_id=?').get(req.params.id, req.userId);
    if (!inc) return res.status(404).json({ error: '見つかりません' });
    db.prepare('DELETE FROM income WHERE id=?').run(inc.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================================
// 経費 API (帳簿スコープ)
// ========================================

router.post('/api/expense', auth, upload.single('receipt'), (req, res) => {
  try {
    const { bookId, date, amount, category, description, source } = req.body;
    // bookIdがbodyにあるのでbookAccessの代わりに直接チェック
    const book = db.prepare('SELECT * FROM books WHERE id=? AND user_id=?').get(parseInt(bookId), req.userId);
    if (!book) return res.status(403).json({ error: '帳簿アクセス権がありません' });
    if (!date || !amount || !category) return res.status(400).json({ error: '日付、金額、科目は必須' });
    const receiptPath = req.file ? `/uploads/${req.file.filename}` : null;
    const r = db.prepare('INSERT INTO expenses (book_id,date,amount,category,description,receipt_path,source) VALUES (?,?,?,?,?,?,?)').run(book.id, date, parseInt(amount), category, description || '', receiptPath, source || 'manual');
    logActivity(req.userId, 'add_expense', `経費追加: ¥${amount} (${source || 'manual'})`);
    res.json({ id: r.lastInsertRowid, success: true });
  } catch (err) { logError(err.message, '/api/expense', req.userId, err.stack); res.status(500).json({ error: err.message }); }
});

router.get('/api/expenses', auth, (req, res) => {
  try {
    const book = bookAccess(req);
    if (!book) return res.status(403).json({ error: '帳簿アクセス権がありません' });
    const { year, month, category } = req.query;
    let sql = 'SELECT * FROM expenses WHERE book_id = ?';
    const params = [book.id];
    if (year) { sql += " AND strftime('%Y',date) = ?"; params.push(year); }
    if (month) { sql += " AND strftime('%m',date) = ?"; params.push(month.padStart(2,'0')); }
    if (category) { sql += " AND category = ?"; params.push(category); }
    sql += ' ORDER BY date DESC, id DESC';
    res.json(db.prepare(sql).all(...params));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/api/expense/:id', auth, (req, res) => {
  try {
    const { date, amount, category, description } = req.body;
    const exp = db.prepare('SELECT e.* FROM expenses e JOIN books b ON e.book_id=b.id WHERE e.id=? AND b.user_id=?').get(req.params.id, req.userId);
    if (!exp) return res.status(404).json({ error: '見つかりません' });
    db.prepare("UPDATE expenses SET date=?,amount=?,category=?,description=?,updated_at=datetime('now','localtime') WHERE id=?").run(date, parseInt(amount), category, description, exp.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/api/expense/:id', auth, (req, res) => {
  try {
    const exp = db.prepare('SELECT e.* FROM expenses e JOIN books b ON e.book_id=b.id WHERE e.id=? AND b.user_id=?').get(req.params.id, req.userId);
    if (!exp) return res.status(404).json({ error: '見つかりません' });
    if (exp.receipt_path) { const fp = path.join(__dirname, exp.receipt_path); if (fs.existsSync(fp)) fs.unlinkSync(fp); }
    db.prepare('DELETE FROM expenses WHERE id=?').run(exp.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================================
// ダッシュボード・集計 API
// ========================================

router.get('/api/dashboard', auth, (req, res) => {
  try {
    const book = bookAccess(req);
    if (!book) return res.status(403).json({ error: '帳簿アクセス権がありません' });
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth()+1).toString().padStart(2,'0');

    const mi = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM income WHERE book_id=? AND strftime('%Y',date)=? AND strftime('%m',date)=?").get(book.id,year,month);
    const me = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM expenses WHERE book_id=? AND strftime('%Y',date)=? AND strftime('%m',date)=?").get(book.id,year,month);
    const yi = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM income WHERE book_id=? AND strftime('%Y',date)=?").get(book.id,year);
    const ye = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM expenses WHERE book_id=? AND strftime('%Y',date)=?").get(book.id,year);

    const ri = db.prepare("SELECT id,date,amount,type as category,description,'income' as kind FROM income WHERE book_id=? ORDER BY date DESC,id DESC LIMIT 10").all(book.id);
    const re2 = db.prepare("SELECT id,date,amount,category,description,'expense' as kind FROM expenses WHERE book_id=? ORDER BY date DESC,id DESC LIMIT 10").all(book.id);
    const recent = [...ri,...re2].sort((a,b)=>b.date>a.date?1:b.date<a.date?-1:0).slice(0,10);

    const catBreak = db.prepare("SELECT category,SUM(amount) as total FROM expenses WHERE book_id=? AND strftime('%Y',date)=? GROUP BY category ORDER BY total DESC").all(book.id,year);

    const trend = db.prepare(`
      SELECT m.month,COALESCE(i.total,0) as income,COALESCE(e.total,0) as expense FROM (
        SELECT '01' as month UNION SELECT '02' UNION SELECT '03' UNION SELECT '04'
        UNION SELECT '05' UNION SELECT '06' UNION SELECT '07' UNION SELECT '08'
        UNION SELECT '09' UNION SELECT '10' UNION SELECT '11' UNION SELECT '12'
      ) m LEFT JOIN (SELECT strftime('%m',date) as month,SUM(amount) as total FROM income WHERE book_id=? AND strftime('%Y',date)=? GROUP BY strftime('%m',date)) i ON m.month=i.month
      LEFT JOIN (SELECT strftime('%m',date) as month,SUM(amount) as total FROM expenses WHERE book_id=? AND strftime('%Y',date)=? GROUP BY strftime('%m',date)) e ON m.month=e.month ORDER BY m.month
    `).all(book.id,year,book.id,year);

    res.json({ monthIncome:mi.t, monthExpense:me.t, yearIncome:yi.t, yearExpense:ye.t, yearProfit:yi.t-ye.t, recentTransactions:recent, categoryBreakdown:catBreak, monthlyTrend:trend });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/summary/:year', auth, (req, res) => {
  try {
    const book = bookAccess(req);
    if (!book) return res.status(403).json({ error: '帳簿アクセス権がありません' });
    const year = req.params.year;
    const inc = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM income WHERE book_id=? AND strftime('%Y',date)=?").get(book.id,year);
    const exp = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE book_id=? AND strftime('%Y',date)=?").get(book.id,year);
    const breakdown = db.prepare("SELECT category,SUM(amount) as total,COUNT(*) as count FROM expenses WHERE book_id=? AND strftime('%Y',date)=? GROUP BY category ORDER BY total DESC").all(book.id,year);
    const mi = db.prepare("SELECT strftime('%m',date) as month,SUM(amount) as total FROM income WHERE book_id=? AND strftime('%Y',date)=? GROUP BY strftime('%m',date)").all(book.id,year);
    const me2 = db.prepare("SELECT strftime('%m',date) as month,SUM(amount) as total FROM expenses WHERE book_id=? AND strftime('%Y',date)=? GROUP BY strftime('%m',date)").all(book.id,year);
    res.json({ year, income:inc.total, expenses:exp.total, profit:inc.total-exp.total, breakdown, monthlyIncome:mi, monthlyExpense:me2 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI出力
router.get('/api/ai-format/:year', auth, (req, res) => {
  try {
    const book = bookAccess(req);
    if (!book) return res.status(403).json({ error: '帳簿アクセス権がありません' });
    const year = req.params.year;
    const inc = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM income WHERE book_id=? AND strftime('%Y',date)=?").get(book.id,year);
    const exps = db.prepare("SELECT category,SUM(amount) as total FROM expenses WHERE book_id=? AND strftime('%Y',date)=? GROUP BY category ORDER BY total DESC").all(book.id,year);
    const expT = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE book_id=? AND strftime('%Y',date)=?").get(book.id,year);
    const cn = { outsourcing:'外注工賃',travel:'旅費交通費',communication:'通信費',supplies:'消耗品費',advertising:'広告宣伝費',entertainment:'接待交際費',depreciation:'減価償却費',home_office:'家事按分',fees:'支払手数料',misc:'雑費' };
    const bd = 650000;
    let t = `【${year}年分 確定申告データ】\n\n期間: ${year}/01/01 - ${year}/12/31\n総収入: ${inc.total.toLocaleString()}円\n総経費: ${expT.total.toLocaleString()}円\n\n【経費内訳】\n`;
    exps.forEach(i => { t += `  ${cn[i.category]||i.category}: ${i.total.toLocaleString()}円\n`; });
    t += `\n【控除・所得】\n  青色申告特別控除: ${bd.toLocaleString()}円\n  課税所得目安: ${Math.max(0,inc.total-expT.total-bd).toLocaleString()}円\n`;
    res.json({ text: t });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// CSV プレビュー
router.post('/api/preview-csv', auth, upload.single('csv'), (req, res) => {
  try {
    const Papa = require('papaparse');
    const content = fs.readFileSync(req.file.path, 'utf-8');
    const { data } = Papa.parse(content, { header: true, skipEmptyLines: true });
    const rows = [];
    for (const row of data) {
      const rawDate = row['利用日']||row['ご利用日']||row['日付']||row['Date']||row['利用年月日']||'';
      const rawAmt = row['金額']||row['利用金額']||row['Amount']||row['ご利用金額']||row['支払金額']||'0';
      const desc = row['利用店舗']||row['ご利用先']||row['摘要']||row['Description']||row['ご利用先など']||row['利用先']||'';
      const date = normalizeDate(rawDate);
      const amount = Math.abs(parseInt(String(rawAmt).replace(/[^0-9\-]/g,''))||0);
      if (date && amount > 0) rows.push({ date, amount, description: desc.trim(), category: suggestCategory(desc) });
    }
    fs.unlinkSync(req.file.path);
    res.json({ success: true, rows });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: err.message });
  }
});

// CSV 一括登録
router.post('/api/import-csv', auth, (req, res) => {
  try {
    const { bookId, rows } = req.body;
    const book = db.prepare('SELECT * FROM books WHERE id=? AND user_id=?').get(parseInt(bookId), req.userId);
    if (!book) return res.status(403).json({ error: '帳簿アクセス権がありません' });
    const stmt = db.prepare('INSERT INTO expenses (book_id,date,amount,category,description,source) VALUES (?,?,?,?,?,?)');
    const tx = db.transaction((items) => {
      let c = 0;
      for (const i of items) { if (i.date && i.amount > 0) { stmt.run(book.id, i.date, Math.abs(i.amount), i.category||'misc', i.description||'', 'csv'); c++; } }
      return c;
    });
    const count = tx(rows);
    logActivity(req.userId, 'csv_import', `CSV取込: ${count}件`);
    res.json({ success: true, imported: count });
  } catch (err) { logError(err.message, '/api/import-csv', req.userId, err.stack); res.status(500).json({ error: err.message }); }
});

// バックアップ
router.get('/api/export', auth, (req, res) => {
  try {
    const book = bookAccess(req);
    if (!book) return res.status(403).json({ error: '帳簿アクセス権がありません' });
    const inc = db.prepare('SELECT * FROM income WHERE book_id=? ORDER BY date').all(book.id);
    const exp = db.prepare('SELECT * FROM expenses WHERE book_id=? ORDER BY date').all(book.id);
    res.setHeader('Content-Type','application/json');
    res.setHeader('Content-Disposition',`attachment; filename=keihi-backup-${book.name}-${new Date().toISOString().slice(0,10)}.json`);
    res.json({ exportDate: new Date().toISOString(), book: book.name, income: inc, expenses: exp });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 管理者ミドルウェア
function adminOnly(req, res, next) {
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.userId);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: '管理者権限が必要です' });
  next();
}

// ========================================
// 管理者 API — 運用ダッシュボード
// ========================================

// メイン運用ダッシュボード
router.get('/api/admin/dashboard', auth, adminOnly, (req, res) => {
  try {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const weekAgo = new Date(now - 7*24*60*60*1000).toISOString().slice(0,10);

    // --- システム状況 ---
    const activeSessions = db.prepare("SELECT COUNT(*) as c FROM sessions WHERE expires_at > datetime('now','localtime')").get().c;
    let dbSizeKB = 0;
    try { dbSizeKB = Math.round(fs.statSync('./data/database.sqlite').size / 1024); } catch {}
    let receiptFiles = 0, receiptSizeKB = 0;
    try {
      const files = fs.readdirSync('./uploads');
      receiptFiles = files.length;
      files.forEach(f => { try { receiptSizeKB += fs.statSync(`./uploads/${f}`).size; } catch {} });
      receiptSizeKB = Math.round(receiptSizeKB / 1024);
    } catch {}
    const errors24h = db.prepare("SELECT COUNT(*) as c FROM error_logs WHERE created_at >= datetime('now','localtime','-1 day')").get().c;
    const errorsTotal = db.prepare("SELECT COUNT(*) as c FROM error_logs").get().c;

    // --- ユーザーメトリクス ---
    const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const newUsersToday = db.prepare("SELECT COUNT(*) as c FROM users WHERE date(created_at) = ?").get(today).c;
    const newUsersWeek = db.prepare("SELECT COUNT(*) as c FROM users WHERE date(created_at) >= ?").get(weekAgo).c;
    const activeUsersToday = db.prepare("SELECT COUNT(DISTINCT user_id) as c FROM activity_logs WHERE date(created_at) = ?").get(today).c;
    const activeUsersWeek = db.prepare("SELECT COUNT(DISTINCT user_id) as c FROM activity_logs WHERE date(created_at) >= ?").get(weekAgo).c;
    const planCounts = { free: 0, pro: 0, business: 0 };
    db.prepare("SELECT plan, COUNT(*) as c FROM users GROUP BY plan").all().forEach(r => { planCounts[r.plan || 'free'] = r.c; });

    // --- 利用状況 ---
    const txToday = db.prepare("SELECT COUNT(*) as c FROM activity_logs WHERE date(created_at) = ? AND action IN ('add_income','add_expense')").get(today).c;
    const txWeek = db.prepare("SELECT COUNT(*) as c FROM activity_logs WHERE date(created_at) >= ? AND action IN ('add_income','add_expense')").get(weekAgo).c;
    const ocrToday = db.prepare("SELECT COUNT(*) as c FROM activity_logs WHERE date(created_at) = ? AND details LIKE '%ocr%'").get(today).c;
    const csvToday = db.prepare("SELECT COUNT(*) as c FROM activity_logs WHERE date(created_at) = ? AND action = 'csv_import'").get(today).c;
    const totalRecords = db.prepare('SELECT COUNT(*) as c FROM income').get().c + db.prepare('SELECT COUNT(*) as c FROM expenses').get().c;

    // --- 最近のエラー (最新20件) ---
    const recentErrors = db.prepare("SELECT e.*, u.email as user_email FROM error_logs e LEFT JOIN users u ON e.user_id = u.id ORDER BY e.created_at DESC LIMIT 20").all();

    // --- 問い合わせ ---
    const newInquiries = db.prepare("SELECT COUNT(*) as c FROM inquiries WHERE status = 'new'").get().c;
    const recentInquiries = db.prepare("SELECT i.*, u.name as user_name, u.email as user_email FROM inquiries i JOIN users u ON i.user_id = u.id ORDER BY i.created_at DESC LIMIT 20").all();

    // --- 最近のアクティビティ (最新30件) ---
    const recentActivity = db.prepare("SELECT a.*, u.name as user_name, u.email as user_email FROM activity_logs a LEFT JOIN users u ON a.user_id = u.id ORDER BY a.created_at DESC LIMIT 30").all();

    // --- ユーザー一覧（ストレージ情報付き） ---
    const users = db.prepare("SELECT id, email, name, avatar_url, auth_provider, role, plan, created_at FROM users ORDER BY created_at DESC").all().map(u => {
      const lastAct = db.prepare('SELECT created_at FROM activity_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(u.id);
      const records = db.prepare("SELECT (SELECT COUNT(*) FROM income i JOIN books b ON i.book_id=b.id WHERE b.user_id=?) + (SELECT COUNT(*) FROM expenses e JOIN books b ON e.book_id=b.id WHERE b.user_id=?) as c").get(u.id, u.id);
      const bookCount = db.prepare("SELECT COUNT(*) as c FROM books WHERE user_id=?").get(u.id).c;
      const receipts = db.prepare("SELECT e.receipt_path FROM expenses e JOIN books b ON e.book_id=b.id WHERE b.user_id=? AND e.receipt_path IS NOT NULL AND e.receipt_path != ''").all(u.id);
      let receiptSizeKB = 0;
      receipts.forEach(r => { try { receiptSizeKB += fs.statSync(r.receipt_path.startsWith('/') ? r.receipt_path : `./${r.receipt_path}`).size; } catch {} });
      receiptSizeKB = Math.round(receiptSizeKB / 1024);
      return { ...u, lastActivity: lastAct?.created_at || null, totalRecords: records.c, bookCount, receiptCount: receipts.length, receiptSizeKB };
    });

    // --- 日別アクティブユーザー推移 (過去14日) ---
    const dailyActive = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now - i*24*60*60*1000).toISOString().slice(0,10);
      const c = db.prepare("SELECT COUNT(DISTINCT user_id) as c FROM activity_logs WHERE date(created_at) = ?").get(d).c;
      dailyActive.push({ date: d, count: c });
    }

    res.json({
      system: { serverStart: SERVER_START, activeSessions, dbSizeKB, receiptFiles, receiptSizeKB, errors24h, errorsTotal },
      userMetrics: { totalUsers, newUsersToday, newUsersWeek, activeUsersToday, activeUsersWeek, planCounts },
      usage: { txToday, txWeek, ocrToday, csvToday, totalRecords },
      recentErrors,
      inquiries: { newCount: newInquiries, items: recentInquiries },
      recentActivity,
      users,
      dailyActive
    });
  } catch (err) { logError(err.message, '/api/admin/dashboard', req.userId, err.stack); res.status(500).json({ error: err.message }); }
});

// ユーザー個別詳細（帳簿別内訳・月別推移）
router.get('/api/admin/user/:id/detail', auth, adminOnly, (req, res) => {
  try {
    const uid = parseInt(req.params.id);
    const user = db.prepare("SELECT id, email, name, avatar_url, role, plan, created_at FROM users WHERE id=?").get(uid);
    if (!user) return res.status(404).json({ error: 'ユーザーが見つかりません' });

    const books = db.prepare('SELECT id, name, emoji FROM books WHERE user_id=?').all(uid);
    const booksDetail = books.map(b => {
      const ic = db.prepare('SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as t FROM income WHERE book_id=?').get(b.id);
      const ec = db.prepare('SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as t FROM expenses WHERE book_id=?').get(b.id);
      const receipts = db.prepare("SELECT receipt_path FROM expenses WHERE book_id=? AND receipt_path IS NOT NULL AND receipt_path != ''").all(b.id);
      let receiptSizeKB = 0;
      receipts.forEach(r => { try { receiptSizeKB += fs.statSync(r.receipt_path.startsWith('/') ? r.receipt_path : `./${r.receipt_path}`).size; } catch {} });
      receiptSizeKB = Math.round(receiptSizeKB / 1024);
      return { ...b, incomeCount: ic.c, incomeTotal: ic.t, expenseCount: ec.c, expenseTotal: ec.t, receiptCount: receipts.length, receiptSizeKB };
    });

    // 月別入力推移（過去6ヶ月）
    const monthly = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const bookIds = books.map(b => b.id);
      let incC = 0, expC = 0;
      for (const bid of bookIds) {
        incC += db.prepare("SELECT COUNT(*) as c FROM income WHERE book_id=? AND date LIKE ?").get(bid, ym + '%').c;
        expC += db.prepare("SELECT COUNT(*) as c FROM expenses WHERE book_id=? AND date LIKE ?").get(bid, ym + '%').c;
      }
      monthly.push({ month: ym, income: incC, expense: expC });
    }

    // 最近のアクティビティ
    const recentActs = db.prepare("SELECT action, details, created_at FROM activity_logs WHERE user_id=? ORDER BY created_at DESC LIMIT 10").all(uid);

    res.json({ user, books: booksDetail, monthly, recentActivity: recentActs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// エラーログ詳細
router.get('/api/admin/errors', auth, adminOnly, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;
    const total = db.prepare('SELECT COUNT(*) as c FROM error_logs').get().c;
    const items = db.prepare("SELECT e.*, u.email as user_email FROM error_logs e LEFT JOIN users u ON e.user_id = u.id ORDER BY e.created_at DESC LIMIT ? OFFSET ?").all(limit, offset);
    res.json({ items, total, page, pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// エラーログクリア
router.delete('/api/admin/errors', auth, adminOnly, (req, res) => {
  try {
    db.prepare('DELETE FROM error_logs').run();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 問い合わせ管理
router.get('/api/admin/inquiries', auth, adminOnly, (req, res) => {
  try {
    const items = db.prepare("SELECT i.*, u.name as user_name, u.email as user_email FROM inquiries i JOIN users u ON i.user_id = u.id ORDER BY CASE WHEN i.status='new' THEN 0 WHEN i.status='in_progress' THEN 1 ELSE 2 END, i.created_at DESC").all();
    res.json({ items });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 問い合わせに返信
router.put('/api/admin/inquiries/:id', auth, adminOnly, (req, res) => {
  try {
    const { status, admin_reply } = req.body;
    const inq = db.prepare('SELECT id FROM inquiries WHERE id = ?').get(req.params.id);
    if (!inq) return res.status(404).json({ error: '問い合わせが見つかりません' });
    db.prepare("UPDATE inquiries SET status=?, admin_reply=?, updated_at=datetime('now','localtime') WHERE id=?").run(status || 'replied', admin_reply || '', inq.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ユーザーのrole/plan変更
router.put('/api/admin/user/:id', auth, adminOnly, (req, res) => {
  try {
    const { role, plan } = req.body;
    const target = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);
    if (!target) return res.status(404).json({ error: 'ユーザーが見つかりません' });
    if (role && ['admin', 'user'].includes(role)) db.prepare('UPDATE users SET role=? WHERE id=?').run(role, target.id);
    if (plan && ['free', 'pro', 'business'].includes(plan)) db.prepare('UPDATE users SET plan=? WHERE id=?').run(plan, target.id);
    logActivity(req.userId, 'admin_action', `ユーザー${target.id}の${role?'権限':'プラン'}を変更`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ユーザー問い合わせ送信
router.post('/api/inquiry', auth, (req, res) => {
  try {
    const { subject, message } = req.body;
    if (!subject || !message) return res.status(400).json({ error: '件名とメッセージを入力してください' });
    db.prepare('INSERT INTO inquiries (user_id, subject, message) VALUES (?,?,?)').run(req.userId, subject, message);
    logActivity(req.userId, 'inquiry', `問い合わせ: ${subject}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ユーザー自分の問い合わせ一覧
router.get('/api/my/inquiries', auth, (req, res) => {
  try {
    const items = db.prepare('SELECT * FROM inquiries WHERE user_id = ? ORDER BY created_at DESC').all(req.userId);
    res.json({ items });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ユーザー用の自分のデータ概要
router.get('/api/my/overview', auth, (req, res) => {
  try {
    const myBooks = db.prepare('SELECT * FROM books WHERE user_id = ? ORDER BY created_at').all(req.userId);
    const booksData = myBooks.map(b => {
      const ic = db.prepare('SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as t FROM income WHERE book_id=?').get(b.id);
      const ec = db.prepare('SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as t FROM expenses WHERE book_id=?').get(b.id);
      const rc = db.prepare("SELECT COUNT(*) as c FROM expenses WHERE book_id=? AND receipt_path IS NOT NULL AND receipt_path != ''").get(b.id);
      return { id: b.id, name: b.name, emoji: b.emoji, incomeCount: ic.c, incomeTotal: ic.t, expenseCount: ec.c, expenseTotal: ec.t, receiptCount: rc.c };
    });
    res.json({ books: booksData });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// === ルーターマウント ===
app.use('/tax', router);
app.use('/', router);
app.get('/tax', (req, res) => { if (!req.originalUrl.endsWith('/') && !req.originalUrl.includes('.') && !req.originalUrl.includes('/api/')) return res.redirect(301, '/tax/'); });

app.listen(PORT, () => {
  console.log(`\n  💰 Keihi v2 起動完了 → http://localhost:${PORT}\n`);
});
