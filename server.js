const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const https = require('https');
const sharp = require('sharp');
const archiver = require('archiver');

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
try { db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'"); } catch (e) {}
try { db.exec("ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'free'"); } catch (e) {}
try { db.exec("ALTER TABLE expenses ADD COLUMN created_by INTEGER"); } catch (e) {}
try { db.exec("ALTER TABLE income ADD COLUMN income_type TEXT DEFAULT 'business'"); } catch (e) {}
try { db.exec("ALTER TABLE depreciations ADD COLUMN sold_date TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE depreciations ADD COLUMN sold_amount INTEGER DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE expenses ADD COLUMN status TEXT DEFAULT 'approved'"); } catch (e) {}
try { db.exec("ALTER TABLE expenses ADD COLUMN approved_at TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE expenses ADD COLUMN approved_by INTEGER"); } catch (e) {}
try { db.exec("ALTER TABLE income ADD COLUMN status TEXT DEFAULT 'approved'"); } catch (e) {}
try { db.exec("ALTER TABLE income ADD COLUMN approved_at TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE income ADD COLUMN approved_by INTEGER"); } catch (e) {}
try { db.exec("ALTER TABLE income ADD COLUMN created_by INTEGER"); } catch (e) {}
try { db.exec("ALTER TABLE income ADD COLUMN taxable INTEGER DEFAULT 1"); } catch (e) {}

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
    income_type TEXT DEFAULT 'business',
    description TEXT,
    created_by INTEGER,
    status TEXT DEFAULT 'approved',
    approved_at TEXT,
    approved_by INTEGER,
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
    created_by INTEGER,
    status TEXT DEFAULT 'approved',
    approved_at TEXT,
    approved_by INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS book_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    can_view_income INTEGER DEFAULT 0,
    can_view_all_expenses INTEGER DEFAULT 0,
    can_input_expense INTEGER DEFAULT 1,
    can_input_income INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(book_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS deductions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL,
    year TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT,
    amount INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS depreciations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    purchase_date TEXT NOT NULL,
    purchase_amount INTEGER NOT NULL,
    useful_life INTEGER NOT NULL DEFAULT 4,
    method TEXT DEFAULT 'straight',
    sold_date TEXT,
    sold_amount INTEGER DEFAULT 0,
    memo TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
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

// === マイグレーション ===
const migrations = [
  "ALTER TABLE users ADD COLUMN avatar_url TEXT",
  "ALTER TABLE users ADD COLUMN auth_provider TEXT DEFAULT 'local'",
  "ALTER TABLE books ADD COLUMN entity_type TEXT DEFAULT 'individual'",
  "ALTER TABLE books ADD COLUMN fiscal_start_month INTEGER DEFAULT 1",
];
for (const sql of migrations) {
  try { db.exec(sql); } catch (e) {}
}

// カテゴリ統合マイグレーション（冪等: 何度実行しても安全）
db.exec(`
  UPDATE expenses SET category = 'general' WHERE category IN ('travel','communication','supplies','advertising','fees','misc');
  UPDATE expenses SET category = 'labor' WHERE category = 'outsourcing';
  UPDATE expenses SET category = 'rent' WHERE category = 'home_office';
  UPDATE expenses SET category = 'asset' WHERE category = 'depreciation';
  UPDATE expenses SET category = 'tax_deductible' WHERE category = 'tax_cost';
  UPDATE expenses SET category = 'tax_non_deductible' WHERE category = 'tax_profit';
`);

// === インデックス ===
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_income_book_date ON income(book_id, date);
  CREATE INDEX IF NOT EXISTS idx_income_book_status ON income(book_id, status);
  CREATE INDEX IF NOT EXISTS idx_expenses_book_date ON expenses(book_id, date);
  CREATE INDEX IF NOT EXISTS idx_expenses_book_status ON expenses(book_id, status);
  CREATE INDEX IF NOT EXISTS idx_expenses_book_cat ON expenses(book_id, category);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_activity_user_date ON activity_logs(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_book_members_book ON book_members(book_id, user_id);
`);

// === セッションクリーンアップ ===
function cleanExpiredSessions() {
  try { db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now','localtime')").run(); } catch {}
}
cleanExpiredSessions();
setInterval(cleanExpiredSessions, 24 * 60 * 60 * 1000);

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

// 帳簿アクセス確認（オーナー or メンバー）
function bookAccess(req) {
  const bookId = parseInt(req.query.bookId || req.body.bookId);
  if (!bookId) return null;
  // オーナーなら全権限
  const own = db.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?').get(bookId, req.userId);
  if (own) return { ...own, memberRole: 'owner', can_view_income: 1, can_view_all_expenses: 1, can_input_expense: 1, can_input_income: 1 };
  // メンバーなら権限付き
  const mem = db.prepare('SELECT bm.*, b.name, b.emoji, b.entity_type, b.fiscal_start_month FROM book_members bm JOIN books b ON bm.book_id = b.id WHERE bm.book_id = ? AND bm.user_id = ?').get(bookId, req.userId);
  if (mem) return { id: mem.book_id, user_id: null, name: mem.name, emoji: mem.emoji, entity_type: mem.entity_type, fiscal_start_month: mem.fiscal_start_month, memberRole: mem.role, can_view_income: mem.can_view_income, can_view_all_expenses: mem.can_view_all_expenses, can_input_expense: mem.can_input_expense, can_input_income: mem.can_input_income };
  return null;
}

// === 科目自動推定（統合カテゴリ） ===
const categoryKeywords = {
  medical: ['病院','医院','クリニック','歯科','薬局','薬店','ドラッグ','調剤','診療','処方','眼科','皮膚科','内科','外科','整骨','接骨','治療','健診','人間ドック','医療'],
  insurance: ['保険','生命保険','損害保険','健康保険','国民健康','年金','共済','社会保険'],
  welfare: ['福利厚生','社員旅行','慰安旅行','忘年会','新年会','歓迎会','社内懇親','社内イベント','ウェルフェア'],
  entertainment: ['飲食','居酒屋','レストラン','食事','ランチ','ディナー','会食','接待','カフェ','スターバックス','タリーズ','ドトール','マクドナルド','ガスト','弁当'],
  labor: ['外注','業務委託','ランサーズ','クラウドワークス','ココナラ','デザイン料','開発費','給与','報酬','人件費'],
  rent: ['電気','ガス','水道','家賃','光熱','賃料','地代','管理費'],
  asset: ['パソコン','PC','Mac','MacBook','iPhone','iPad','カメラ','ディスプレイ','モニター','プリンター','車両'],
  tax_deductible: ['消費税','印紙税','事業税','固定資産税','自動車税','登録免許税','不動産取得税','印紙','収入印紙','軽自動車税','都市計画税'],
  tax_non_deductible: ['所得税','住民税','法人税','予定納税','源泉所得税','延滞税','加算税','確定申告'],
  general: ['交通','電車','JR','Suica','PASMO','タクシー','バス','新幹線','航空','高速','ETC','ガソリン','駐車','通信','電話','携帯','WiFi','AWS','サーバー','ドメイン','Amazon','アマゾン','ヨドバシ','ビックカメラ','文具','事務','コピー','消耗品','広告','宣伝','チラシ','印刷','PR','手数料','PayPal','Stripe','決済','銀行','ATM','年会費','コンビニ','セブン','ファミリーマート','ローソン','振込'],
};

// 非経費カテゴリ（支出合計に含めない）
const TAX_PROFIT_CATEGORY = 'tax_non_deductible';
const EXPENSE_EXCLUDE_FILTER = `AND category != '${TAX_PROFIT_CATEGORY}'`;

function suggestCategoryWithAmount(desc, amount) {
  const cat = suggestCategory(desc);
  if (cat !== 'general') return cat;
  if (amount && amount >= 100000) return 'asset';
  return 'general';
}

function suggestCategory(desc) {
  if (!desc) return 'general';
  const d = desc.toLowerCase();
  for (const [cat, kws] of Object.entries(categoryKeywords)) {
    for (const kw of kws) { if (d.includes(kw.toLowerCase())) return cat; }
  }
  return 'general';
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
    if (!user.password_hash) return res.status(401).json({ error: 'このアカウントはGoogleログインをご利用ください' });

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
  const ownBooks = db.prepare("SELECT *, 'owner' as memberRole FROM books WHERE user_id = ? ORDER BY created_at").all(req.userId);
  const sharedBooks = db.prepare("SELECT b.id, b.name, b.emoji, b.created_at, bm.role as memberRole, bm.can_view_income, bm.can_view_all_expenses, bm.can_input_expense, bm.can_input_income FROM book_members bm JOIN books b ON bm.book_id = b.id WHERE bm.user_id = ? ORDER BY b.created_at").all(req.userId);
  const books = [...ownBooks, ...sharedBooks];
  res.json({ user, books });
});

// ========================================
// 帳簿 API
// ========================================

router.get('/api/books', auth, (req, res) => {
  const own = db.prepare("SELECT *, 'owner' as memberRole FROM books WHERE user_id = ? ORDER BY created_at").all(req.userId);
  const shared = db.prepare("SELECT b.id, b.name, b.emoji, b.created_at, bm.role as memberRole, bm.can_view_income, bm.can_view_all_expenses, bm.can_input_expense, bm.can_input_income FROM book_members bm JOIN books b ON bm.book_id = b.id WHERE bm.user_id = ? ORDER BY b.created_at").all(req.userId);
  res.json([...own, ...shared]);
});

router.post('/api/books', auth, (req, res) => {
  const { name, emoji, entity_type, fiscal_start_month } = req.body;
  if (!name) return res.status(400).json({ error: '帳簿名を入力してください' });
  const et = entity_type === 'corporate' ? 'corporate' : 'individual';
  const fm = et === 'corporate' ? (parseInt(fiscal_start_month) || 4) : 1;
  const r = db.prepare('INSERT INTO books (user_id, name, emoji, entity_type, fiscal_start_month) VALUES (?, ?, ?, ?, ?)').run(req.userId, name, emoji || '📒', et, fm);
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
// メンバー管理 API
// ========================================

// メンバー一覧
router.get('/api/books/:id/members', auth, (req, res) => {
  try {
    const book = db.prepare('SELECT * FROM books WHERE id=?').get(req.params.id);
    if (!book) return res.status(404).json({ error: '帳簿が見つかりません' });
    // オーナーか管理者メンバーのみ
    const isOwner = book.user_id === req.userId;
    const isMgr = db.prepare("SELECT * FROM book_members WHERE book_id=? AND user_id=? AND role='manager'").get(book.id, req.userId);
    if (!isOwner && !isMgr) return res.status(403).json({ error: '権限がありません' });
    const owner = db.prepare('SELECT id, name, email, avatar_url FROM users WHERE id=?').get(book.user_id);
    const members = db.prepare('SELECT bm.*, u.name, u.email, u.avatar_url FROM book_members bm JOIN users u ON bm.user_id = u.id WHERE bm.book_id=? ORDER BY bm.created_at').all(book.id);
    res.json({ owner: { ...owner, role: 'owner' }, members });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// メンバー追加（メールで招待）
router.post('/api/books/:id/members', auth, (req, res) => {
  try {
    const book = db.prepare('SELECT * FROM books WHERE id=?').get(req.params.id);
    if (!book) return res.status(404).json({ error: '帳簿が見つかりません' });
    const isOwner = book.user_id === req.userId;
    const isMgr = db.prepare("SELECT * FROM book_members WHERE book_id=? AND user_id=? AND role='manager'").get(book.id, req.userId);
    if (!isOwner && !isMgr) return res.status(403).json({ error: '権限がありません' });

    const { email, role, can_view_income, can_view_all_expenses, can_input_expense, can_input_income } = req.body;
    if (!email) return res.status(400).json({ error: 'メールアドレスを入力してください' });
    const target = db.prepare('SELECT id FROM users WHERE email=?').get(email);
    if (!target) return res.status(404).json({ error: 'このメールアドレスのユーザーが見つかりません。先にアカウント登録が必要です。' });
    if (target.id === book.user_id) return res.status(400).json({ error: 'オーナー自身は追加できません' });
    const exists = db.prepare('SELECT id FROM book_members WHERE book_id=? AND user_id=?').get(book.id, target.id);
    if (exists) return res.status(400).json({ error: '既にメンバーです' });

    db.prepare('INSERT INTO book_members (book_id, user_id, role, can_view_income, can_view_all_expenses, can_input_expense, can_input_income) VALUES (?,?,?,?,?,?,?)').run(
      book.id, target.id, role || 'member',
      can_view_income ? 1 : 0, can_view_all_expenses ? 1 : 0,
      can_input_expense !== false ? 1 : 0, can_input_income ? 1 : 0
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// メンバー権限変更
router.put('/api/books/:id/members/:memberId', auth, (req, res) => {
  try {
    const book = db.prepare('SELECT * FROM books WHERE id=?').get(req.params.id);
    if (!book) return res.status(404).json({ error: '帳簿が見つかりません' });
    const isOwner = book.user_id === req.userId;
    const isMgr = db.prepare("SELECT * FROM book_members WHERE book_id=? AND user_id=? AND role='manager'").get(book.id, req.userId);
    if (!isOwner && !isMgr) return res.status(403).json({ error: '権限がありません' });

    const { role, can_view_income, can_view_all_expenses, can_input_expense, can_input_income } = req.body;
    const mem = db.prepare('SELECT * FROM book_members WHERE id=? AND book_id=?').get(req.params.memberId, book.id);
    if (!mem) return res.status(404).json({ error: 'メンバーが見つかりません' });

    const updates = [];
    const params = [];
    if (role !== undefined && ['manager','member'].includes(role)) { updates.push('role=?'); params.push(role); }
    if (can_view_income !== undefined) { updates.push('can_view_income=?'); params.push(can_view_income ? 1 : 0); }
    if (can_view_all_expenses !== undefined) { updates.push('can_view_all_expenses=?'); params.push(can_view_all_expenses ? 1 : 0); }
    if (can_input_expense !== undefined) { updates.push('can_input_expense=?'); params.push(can_input_expense ? 1 : 0); }
    if (can_input_income !== undefined) { updates.push('can_input_income=?'); params.push(can_input_income ? 1 : 0); }
    if (updates.length) { params.push(mem.id); db.prepare(`UPDATE book_members SET ${updates.join(',')} WHERE id=?`).run(...params); }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// メンバー削除
router.delete('/api/books/:id/members/:memberId', auth, (req, res) => {
  try {
    const book = db.prepare('SELECT * FROM books WHERE id=?').get(req.params.id);
    if (!book) return res.status(404).json({ error: '帳簿が見つかりません' });
    const isOwner = book.user_id === req.userId;
    const isMgr = db.prepare("SELECT * FROM book_members WHERE book_id=? AND user_id=? AND role='manager'").get(book.id, req.userId);
    if (!isOwner && !isMgr) return res.status(403).json({ error: '権限がありません' });
    db.prepare('DELETE FROM book_members WHERE id=? AND book_id=?').run(req.params.memberId, book.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================================
// 収入 API (帳簿スコープ)
// ========================================

router.post('/api/income', auth, (req, res) => {
  try {
    const { bookId, date, amount, type, income_type, description, taxable } = req.body;
    const book = bookAccess(req);
    if (!book) return res.status(403).json({ error: '帳簿アクセス権がありません' });
    if (!book.can_input_income) return res.status(403).json({ error: '収入の入力権限がありません' });
    if (!date || !amount) return res.status(400).json({ error: '日付と金額は必須' });
    const isOwner = book.memberRole === 'owner';
    const status = isOwner ? 'approved' : 'pending';
    const approvedAt = isOwner ? new Date().toISOString() : null;
    const approvedBy = isOwner ? req.userId : null;
    const taxableVal = (taxable === 0 || taxable === '0' || taxable === false) ? 0 : 1;
    const r = db.prepare('INSERT INTO income (book_id, date, amount, type, income_type, description, taxable, created_by, status, approved_at, approved_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(book.id, date, parseInt(amount), type || '振込', income_type || 'business', description || '', taxableVal, req.userId, status, approvedAt, approvedBy);
    logActivity(req.userId, 'add_income', `収入追加: ¥${amount}${!isOwner ? ' (承認待ち)' : ''}`);
    res.json({ id: r.lastInsertRowid, success: true, status });
  } catch (err) { logError(err.message, '/api/income', req.userId, err.stack); res.status(500).json({ error: err.message }); }
});

router.get('/api/income', auth, (req, res) => {
  try {
    const book = bookAccess(req);
    if (!book) return res.status(403).json({ error: '帳簿アクセス権がありません' });
    if (!book.can_view_income) return res.json([]);
    const { year, month, income_type, include_pending } = req.query;
    let sql = "SELECT i.*, u.name as creator_name FROM income i LEFT JOIN users u ON i.created_by = u.id WHERE i.book_id = ?";
    const params = [book.id];
    if (!include_pending) { sql += " AND (i.status = 'approved' OR i.status IS NULL)"; }
    if (year) { sql += " AND strftime('%Y',i.date) = ?"; params.push(year); }
    if (month) { sql += " AND strftime('%m',i.date) = ?"; params.push(month.padStart(2,'0')); }
    if (income_type) { sql += " AND COALESCE(i.income_type,'business') = ?"; params.push(income_type); }
    sql += ' ORDER BY i.date DESC, i.id DESC';
    res.json(db.prepare(sql).all(...params));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/api/income/:id', auth, (req, res) => {
  try {
    const { date, amount, type, income_type, description, taxable } = req.body;
    // オーナーか、自分が作成したものだけ編集可能
    const inc = db.prepare('SELECT i.*, b.user_id as book_owner FROM income i JOIN books b ON i.book_id=b.id WHERE i.id=?').get(req.params.id);
    if (!inc) return res.status(404).json({ error: '見つかりません' });
    if (inc.book_owner !== req.userId && inc.created_by !== req.userId) return res.status(403).json({ error: '編集権限がありません' });
    const updates = [];
    const params = [];
    if (date !== undefined) { updates.push('date=?'); params.push(date); }
    if (amount !== undefined) { updates.push('amount=?'); params.push(parseInt(amount)); }
    if (type !== undefined) { updates.push('type=?'); params.push(type); }
    if (income_type !== undefined) { updates.push('income_type=?'); params.push(income_type); }
    if (description !== undefined) { updates.push('description=?'); params.push(description); }
    if (taxable !== undefined) { updates.push('taxable=?'); params.push((taxable === 0 || taxable === '0') ? 0 : 1); }
    updates.push("updated_at=datetime('now','localtime')");
    params.push(inc.id);
    db.prepare(`UPDATE income SET ${updates.join(',')} WHERE id=?`).run(...params);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/api/income/:id', auth, (req, res) => {
  try {
    const inc = db.prepare('SELECT i.*, b.user_id as book_owner FROM income i JOIN books b ON i.book_id=b.id WHERE i.id=?').get(req.params.id);
    if (!inc) return res.status(404).json({ error: '見つかりません' });
    if (inc.book_owner !== req.userId && inc.created_by !== req.userId) return res.status(403).json({ error: '削除権限がありません' });
    db.prepare('DELETE FROM income WHERE id=?').run(inc.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 収入の詳細（1件取得）
router.get('/api/income/:id', auth, (req, res) => {
  try {
    const inc = db.prepare("SELECT i.*, u.name as creator_name, u.email as creator_email, a.name as approver_name FROM income i LEFT JOIN users u ON i.created_by = u.id LEFT JOIN users a ON i.approved_by = a.id WHERE i.id=?").get(req.params.id);
    if (!inc) return res.status(404).json({ error: '見つかりません' });
    const book = bookAccess({ ...req, query: { bookId: inc.book_id }, body: {} });
    if (!book) return res.status(403).json({ error: 'アクセス権がありません' });
    res.json(inc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================================
// 経費 API (帳簿スコープ)
// ========================================

// レシート画像圧縮: 最大1200px, JPEG quality75, EXIF削除
async function compressReceipt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!/\.(jpe?g|png|gif|webp|heic)$/i.test(ext)) return filePath;
  const outName = path.basename(filePath, ext) + '.jpg';
  const outPath = path.join(path.dirname(filePath), outName);
  try {
    await sharp(filePath)
      .rotate()
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toFile(outPath);
    if (outPath !== filePath) fs.unlinkSync(filePath);
    return outPath;
  } catch (e) {
    return filePath;
  }
}

router.post('/api/expense', auth, upload.single('receipt'), async (req, res) => {
  try {
    const { bookId, date, amount, category, description, source } = req.body;
    const book = bookAccess(req);
    if (!book) return res.status(403).json({ error: '帳簿アクセス権がありません' });
    if (!book.can_input_expense) return res.status(403).json({ error: '経費の入力権限がありません' });
    if (!date || !amount || !category) return res.status(400).json({ error: '日付、金額、科目は必須' });
    let receiptPath = null;
    if (req.file) {
      const compressed = await compressReceipt(req.file.path);
      receiptPath = `/uploads/${path.basename(compressed)}`;
    }
    const isOwner = book.memberRole === 'owner';
    const status = isOwner ? 'approved' : 'pending';
    const approvedAt = isOwner ? new Date().toISOString() : null;
    const approvedBy = isOwner ? req.userId : null;
    const r = db.prepare('INSERT INTO expenses (book_id,date,amount,category,description,receipt_path,source,created_by,status,approved_at,approved_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(book.id, date, parseInt(amount), category, description || '', receiptPath, source || 'manual', req.userId, status, approvedAt, approvedBy);
    logActivity(req.userId, 'add_expense', `経費追加: ¥${amount} (${source || 'manual'})${!isOwner ? ' [承認待ち]' : ''}`);
    res.json({ id: r.lastInsertRowid, success: true, status });
  } catch (err) { logError(err.message, '/api/expense', req.userId, err.stack); res.status(500).json({ error: err.message }); }
});

router.get('/api/expenses', auth, (req, res) => {
  try {
    const book = bookAccess(req);
    if (!book) return res.status(403).json({ error: '帳簿アクセス権がありません' });
    const { year, month, category, include_pending } = req.query;
    let sql = "SELECT e.*, u.name as creator_name FROM expenses e LEFT JOIN users u ON e.created_by = u.id WHERE e.book_id = ?";
    const params = [book.id];
    if (!include_pending) { sql += " AND (e.status = 'approved' OR e.status IS NULL)"; }
    if (!book.can_view_all_expenses) { sql += ' AND (e.created_by = ? OR e.created_by IS NULL)'; params.push(req.userId); }
    if (year) { sql += " AND strftime('%Y',e.date) = ?"; params.push(year); }
    if (month) { sql += " AND strftime('%m',e.date) = ?"; params.push(month.padStart(2,'0')); }
    if (category) { sql += " AND e.category = ?"; params.push(category); }
    sql += ' ORDER BY e.date DESC, e.id DESC';
    res.json(db.prepare(sql).all(...params));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/api/expense/:id', auth, (req, res) => {
  try {
    const { date, amount, category, description } = req.body;
    const exp = db.prepare('SELECT e.*, b.user_id as book_owner FROM expenses e JOIN books b ON e.book_id=b.id WHERE e.id=?').get(req.params.id);
    if (!exp) return res.status(404).json({ error: '見つかりません' });
    if (exp.book_owner !== req.userId && exp.created_by !== req.userId) return res.status(403).json({ error: '編集権限がありません' });
    const updates = [];
    const params = [];
    if (date !== undefined) { updates.push('date=?'); params.push(date); }
    if (amount !== undefined) { updates.push('amount=?'); params.push(parseInt(amount)); }
    if (category !== undefined) { updates.push('category=?'); params.push(category); }
    if (description !== undefined) { updates.push('description=?'); params.push(description); }
    updates.push("updated_at=datetime('now','localtime')");
    params.push(exp.id);
    db.prepare(`UPDATE expenses SET ${updates.join(',')} WHERE id=?`).run(...params);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/api/expense/:id', auth, (req, res) => {
  try {
    const exp = db.prepare('SELECT e.*, b.user_id as book_owner FROM expenses e JOIN books b ON e.book_id=b.id WHERE e.id=?').get(req.params.id);
    if (!exp) return res.status(404).json({ error: '見つかりません' });
    if (exp.book_owner !== req.userId && exp.created_by !== req.userId) return res.status(403).json({ error: '削除権限がありません' });
    if (exp.receipt_path) { const fp = path.join(__dirname, exp.receipt_path); if (fs.existsSync(fp)) fs.unlinkSync(fp); }
    db.prepare('DELETE FROM expenses WHERE id=?').run(exp.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 経費の詳細（1件取得）
router.get('/api/expense/:id', auth, (req, res) => {
  try {
    const exp = db.prepare("SELECT e.*, u.name as creator_name, u.email as creator_email, a.name as approver_name FROM expenses e LEFT JOIN users u ON e.created_by = u.id LEFT JOIN users a ON e.approved_by = a.id WHERE e.id=?").get(req.params.id);
    if (!exp) return res.status(404).json({ error: '見つかりません' });
    const book = bookAccess({ ...req, query: { bookId: exp.book_id }, body: {} });
    if (!book) return res.status(403).json({ error: 'アクセス権がありません' });
    res.json(exp);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 承認待ちデータ取得（オーナー/管理者用）
router.get('/api/pending', auth, (req, res) => {
  try {
    const book = bookAccess(req);
    if (!book) return res.status(403).json({ error: '帳簿アクセス権がありません' });
    if (book.memberRole !== 'owner' && book.memberRole !== 'manager') return res.status(403).json({ error: '権限がありません' });
    const expenses = db.prepare("SELECT e.*, u.name as creator_name, u.email as creator_email FROM expenses e LEFT JOIN users u ON e.created_by = u.id WHERE e.book_id = ? AND e.status = 'pending' ORDER BY e.created_at DESC").all(book.id);
    const income = db.prepare("SELECT i.*, u.name as creator_name, u.email as creator_email FROM income i LEFT JOIN users u ON i.created_by = u.id WHERE i.book_id = ? AND i.status = 'pending' ORDER BY i.created_at DESC").all(book.id);
    res.json({ expenses, income, totalPending: expenses.length + income.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 承認
router.put('/api/approve/:type/:id', auth, (req, res) => {
  try {
    const { type, id } = req.params;
    if (!['expense', 'income'].includes(type)) return res.status(400).json({ error: '無効なタイプ' });
    const table = type === 'expense' ? 'expenses' : 'income';
    const item = db.prepare(`SELECT t.*, b.user_id as book_owner FROM ${table} t JOIN books b ON t.book_id=b.id WHERE t.id=?`).get(id);
    if (!item) return res.status(404).json({ error: '見つかりません' });
    if (item.book_owner !== req.userId) {
      const isMgr = db.prepare("SELECT * FROM book_members WHERE book_id=? AND user_id=? AND role='manager'").get(item.book_id, req.userId);
      if (!isMgr) return res.status(403).json({ error: '承認権限がありません' });
    }
    db.prepare(`UPDATE ${table} SET status='approved', approved_at=datetime('now','localtime'), approved_by=? WHERE id=?`).run(req.userId, item.id);
    logActivity(req.userId, 'approve', `${type === 'expense' ? '経費' : '収入'}を承認: #${item.id} ¥${item.amount}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 一括承認
router.put('/api/approve-all', auth, (req, res) => {
  try {
    const { bookId } = req.body;
    const book = db.prepare('SELECT * FROM books WHERE id=? AND user_id=?').get(parseInt(bookId), req.userId);
    if (!book) {
      const isMgr = db.prepare("SELECT * FROM book_members WHERE book_id=? AND user_id=? AND role='manager'").get(parseInt(bookId), req.userId);
      if (!isMgr) return res.status(403).json({ error: '承認権限がありません' });
    }
    const now = "datetime('now','localtime')";
    const expCount = db.prepare(`UPDATE expenses SET status='approved', approved_at=${now}, approved_by=? WHERE book_id=? AND status='pending'`).run(req.userId, parseInt(bookId)).changes;
    const incCount = db.prepare(`UPDATE income SET status='approved', approved_at=${now}, approved_by=? WHERE book_id=? AND status='pending'`).run(req.userId, parseInt(bookId)).changes;
    logActivity(req.userId, 'approve_all', `一括承認: 経費${expCount}件, 収入${incCount}件`);
    res.json({ success: true, approved: expCount + incCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 却下（削除）
router.delete('/api/reject/:type/:id', auth, (req, res) => {
  try {
    const { type, id } = req.params;
    if (!['expense', 'income'].includes(type)) return res.status(400).json({ error: '無効なタイプ' });
    const table = type === 'expense' ? 'expenses' : 'income';
    const item = db.prepare(`SELECT t.*, b.user_id as book_owner FROM ${table} t JOIN books b ON t.book_id=b.id WHERE t.id=?`).get(id);
    if (!item) return res.status(404).json({ error: '見つかりません' });
    if (item.book_owner !== req.userId) {
      const isMgr = db.prepare("SELECT * FROM book_members WHERE book_id=? AND user_id=? AND role='manager'").get(item.book_id, req.userId);
      if (!isMgr) return res.status(403).json({ error: '却下権限がありません' });
    }
    if (type === 'expense' && item.receipt_path) {
      const fp = path.join(__dirname, item.receipt_path);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    db.prepare(`DELETE FROM ${table} WHERE id=?`).run(item.id);
    logActivity(req.userId, 'reject', `${type === 'expense' ? '経費' : '収入'}を却下: #${item.id} ¥${item.amount}`);
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

    const mi = book.can_view_income ? db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM income WHERE book_id=? AND (status='approved' OR status IS NULL) AND strftime('%Y',date)=? AND strftime('%m',date)=?").get(book.id,year,month) : {t:0};
    const me = db.prepare(`SELECT COALESCE(SUM(amount),0) as t FROM expenses WHERE book_id=? AND (status='approved' OR status IS NULL) AND strftime('%Y',date)=? AND strftime('%m',date)=? ${EXPENSE_EXCLUDE_FILTER}`).get(book.id,year,month);
    const yi = book.can_view_income ? db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM income WHERE book_id=? AND (status='approved' OR status IS NULL) AND strftime('%Y',date)=?").get(book.id,year) : {t:0};
    const ye = db.prepare(`SELECT COALESCE(SUM(amount),0) as t FROM expenses WHERE book_id=? AND (status='approved' OR status IS NULL) AND strftime('%Y',date)=? ${EXPENSE_EXCLUDE_FILTER}`).get(book.id,year);

    const ri = book.can_view_income ? db.prepare("SELECT id,date,amount,type as category,description,'income' as kind,status,created_by FROM income WHERE book_id=? AND (status='approved' OR status IS NULL) ORDER BY date DESC,id DESC LIMIT 10").all(book.id) : [];
    let expSql = "SELECT id,date,amount,category,description,'expense' as kind,status,created_by FROM expenses WHERE book_id=? AND (status='approved' OR status IS NULL)";
    const expParams = [book.id];
    if (!book.can_view_all_expenses) { expSql += ' AND (created_by = ? OR created_by IS NULL)'; expParams.push(req.userId); }
    expSql += ' ORDER BY date DESC,id DESC LIMIT 10';
    const re2 = db.prepare(expSql).all(...expParams);
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

    // 承認待ちカウント（オーナー/管理者のみ）
    let pendingCount = 0;
    if (book.memberRole === 'owner' || book.memberRole === 'manager') {
      const pe = db.prepare("SELECT COUNT(*) as c FROM expenses WHERE book_id=? AND status='pending'").get(book.id).c;
      const pi = db.prepare("SELECT COUNT(*) as c FROM income WHERE book_id=? AND status='pending'").get(book.id).c;
      pendingCount = pe + pi;
    }

    res.json({ monthIncome:mi.t, monthExpense:me.t, yearIncome:yi.t, yearExpense:ye.t, yearProfit:yi.t-ye.t, recentTransactions:recent, categoryBreakdown:catBreak, monthlyTrend:trend, pendingCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/summary/:year', auth, (req, res) => {
  try {
    const book = bookAccess(req);
    if (!book) return res.status(403).json({ error: '帳簿アクセス権がありません' });
    const year = req.params.year;
    const { startDate, endDate } = req.query;
    const approvedFilter = "AND (status='approved' OR status IS NULL)";

    let dateFilter, dateParams;
    if (startDate && endDate) {
      dateFilter = 'AND date >= ? AND date <= ?';
      dateParams = [startDate, endDate];
    } else {
      dateFilter = "AND strftime('%Y',date) = ?";
      dateParams = [year];
    }

    const inc = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM income WHERE book_id=? ${approvedFilter} ${dateFilter}`).get(book.id, ...dateParams);
    const exp = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE book_id=? ${approvedFilter} ${dateFilter} ${EXPENSE_EXCLUDE_FILTER}`).get(book.id, ...dateParams);
    const breakdown = db.prepare(`SELECT category,SUM(amount) as total,COUNT(*) as count FROM expenses WHERE book_id=? ${approvedFilter} ${dateFilter} GROUP BY category ORDER BY total DESC`).all(book.id, ...dateParams);
    const taxProfitTotal = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE book_id=? ${approvedFilter} ${dateFilter} AND category='tax_non_deductible'`).get(book.id, ...dateParams).total;
    const mi = db.prepare(`SELECT strftime('%Y-%m',date) as month,SUM(amount) as total FROM income WHERE book_id=? ${approvedFilter} ${dateFilter} GROUP BY strftime('%Y-%m',date) ORDER BY month`).all(book.id, ...dateParams);
    const me2 = db.prepare(`SELECT strftime('%Y-%m',date) as month,SUM(amount) as total FROM expenses WHERE book_id=? ${approvedFilter} ${dateFilter} ${EXPENSE_EXCLUDE_FILTER} GROUP BY strftime('%Y-%m',date) ORDER BY month`).all(book.id, ...dateParams);
    const incomeBreakdown = db.prepare(`SELECT COALESCE(income_type,'business') as income_type, SUM(amount) as total, COUNT(*) as count FROM income WHERE book_id=? ${approvedFilter} ${dateFilter} GROUP BY COALESCE(income_type,'business') ORDER BY total DESC`).all(book.id, ...dateParams);

    // カテゴリ別の売上比率
    const totalIncome = inc.total || 1;
    const categoryRatios = breakdown.map(b => ({
      ...b,
      incomeRatio: Math.round(b.total / totalIncome * 1000) / 10,
      isTaxProfit: b.category === TAX_PROFIT_CATEGORY
    }));

    res.json({
      year, startDate: startDate || `${year}-01-01`, endDate: endDate || `${year}-12-31`,
      income: inc.total, expenses: exp.total, taxProfitTotal,
      profit: inc.total - exp.total,
      breakdown: categoryRatios, incomeBreakdown,
      monthlyIncome: mi, monthlyExpense: me2
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================================
// 税額計算エンジン
// ========================================

// 所得税率テーブル（2024年〜）
const INCOME_TAX_BRACKETS = [
  { limit: 1950000, rate: 0.05, deduction: 0 },
  { limit: 3300000, rate: 0.10, deduction: 97500 },
  { limit: 6950000, rate: 0.20, deduction: 427500 },
  { limit: 9000000, rate: 0.23, deduction: 636000 },
  { limit: 18000000, rate: 0.33, deduction: 1536000 },
  { limit: 40000000, rate: 0.40, deduction: 2796000 },
  { limit: Infinity, rate: 0.45, deduction: 4796000 }
];

function calcIncomeTax(taxableIncome) {
  if (taxableIncome <= 0) return 0;
  for (const b of INCOME_TAX_BRACKETS) {
    if (taxableIncome <= b.limit) return Math.floor(taxableIncome * b.rate - b.deduction);
  }
  return 0;
}

function calcResidentTax(taxableIncome) {
  if (taxableIncome <= 0) return 0;
  return Math.floor(taxableIncome * 0.10) + 5000;
}

// ===== 法人税計算エンジン =====
function calcCorporateTax(taxableIncome) {
  if (taxableIncome <= 0) return 0;
  if (taxableIncome <= 8000000) return Math.floor(taxableIncome * 0.15);
  return Math.floor(8000000 * 0.15 + (taxableIncome - 8000000) * 0.232);
}

function calcCorpResidentTax(corpTax) {
  return Math.floor(corpTax * 0.104) + 70000;
}

function calcCorpBusinessTax(taxableIncome) {
  if (taxableIncome <= 0) return 0;
  if (taxableIncome <= 4000000) return Math.floor(taxableIncome * 0.035);
  if (taxableIncome <= 8000000) return Math.floor(4000000 * 0.035 + (taxableIncome - 4000000) * 0.053);
  return Math.floor(4000000 * 0.035 + 4000000 * 0.053 + (taxableIncome - 8000000) * 0.07);
}

function calcCorpSpecialBizTax(taxableIncome) {
  return Math.floor(calcCorpBusinessTax(taxableIncome) * 0.37);
}

function generateCorpPaymentSchedule(fiscalEndMonth, taxes) {
  const { corpTax, corpResidentTax, corpBizTax, corpSpecialBizTax, consumptionTax } = taxes;
  const s = [];
  const deadlineMonth = ((fiscalEndMonth % 12) + 2) % 12 || 12;
  const deadlineYear = deadlineMonth <= 2 ? 2027 : 2026;
  const day = lastDayOfMonth(deadlineYear, deadlineMonth);
  const dl = `${deadlineYear}-${String(deadlineMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

  if ((corpTax || 0) > 0) s.push({ date: dl, label: '法人税', amount: corpTax, cat: 'corp_tax', icon: '🏢' });
  if ((corpResidentTax || 0) > 0) s.push({ date: dl, label: '法人住民税', amount: corpResidentTax, cat: 'corp_resident', icon: '🏙' });
  const bizTotal = (corpBizTax || 0) + (corpSpecialBizTax || 0);
  if (bizTotal > 0) s.push({ date: dl, label: '法人事業税', amount: bizTotal, cat: 'corp_biz', icon: '💼' });
  if (consumptionTax?.applicable) s.push({ date: dl, label: '消費税', amount: consumptionTax.amount, cat: 'consumption', icon: '🧾' });

  // 中間申告（前期法人税が20万超の場合）
  if ((corpTax || 0) > 200000) {
    const midMonth = ((fiscalEndMonth + 6) % 12 + 2) % 12 || 12;
    const midYear = midMonth <= 2 ? 2027 : 2026;
    const midDay = lastDayOfMonth(midYear, midMonth);
    const midDl = `${midYear}-${String(midMonth).padStart(2,'0')}-${String(midDay).padStart(2,'0')}`;
    s.push({ date: midDl, label: '法人税（中間）', amount: Math.floor(corpTax / 2), cat: 'corp_tax', icon: '🏢' });
  }
  return s.sort((a, b) => a.date.localeCompare(b.date));
}

// ===== 個人税計算エンジン =====
// 国民健康保険料（全国平均的な料率）
const NHI_RATES = {
  medical: { incomeRate: 0.075, flat: 42000, cap: 650000 },
  support: { incomeRate: 0.025, flat: 14000, cap: 220000 },
  care:    { incomeRate: 0.020, flat: 14000, cap: 170000 },
};

function calcNHI(totalIncome, expenses, deductionTotal, members = 1, over40 = false) {
  const base = Math.max(0, totalIncome - expenses - 430000);
  const r = NHI_RATES;
  const medical = Math.min(Math.floor(base * r.medical.incomeRate) + r.medical.flat * members, r.medical.cap);
  const support = Math.min(Math.floor(base * r.support.incomeRate) + r.support.flat * members, r.support.cap);
  const care = over40 ? Math.min(Math.floor(base * r.care.incomeRate) + r.care.flat * members, r.care.cap) : 0;
  return { medical, support, care, total: medical + support + care, base };
}

// 個人事業税（5%、事業主控除290万円）
function calcBusinessTax(businessNetIncome) {
  const exempt = 2900000;
  if (businessNetIncome <= exempt) return 0;
  return Math.floor((businessNetIncome - exempt) * 0.05);
}

// 消費税（簡易課税、サービス業みなし仕入率50%）
function calcConsumptionTax(totalRevenue) {
  if (totalRevenue <= 10000000) return { applicable: false, amount: 0 };
  const salesTax = Math.floor(totalRevenue * 10 / 110);
  const amount = Math.floor(salesTax * 0.50);
  return { applicable: true, amount, salesTax };
}

// 医療費控除の閾値（10万円 or 所得の5%の低い方）
function medicalDeductionThreshold(totalIncome) {
  return Math.min(100000, Math.floor(totalIncome * 0.05));
}

// 税務健全性スコア（税務調査リスク指標）
function calcHealthScore(expenseCategories, totalExpenses, totalIncome, hasDepreciations, depDetails) {
  let score = 100;
  const issues = [];
  const totalExp = totalExpenses || 1;
  const totalInc = totalIncome || 1;

  // 接待交際費比率チェック（売上の3%超は要注意）
  const entertainmentTotal = expenseCategories.find(c => c.category === 'entertainment')?.total || 0;
  const entertainmentRatio = entertainmentTotal / totalInc;
  if (entertainmentRatio > 0.10) {
    score -= 25;
    issues.push({ severity: 'high', label: '接待交際費が突出', detail: `売上の${Math.round(entertainmentRatio*100)}%（基準目安: 3%以下）。税務調査で要説明` });
  } else if (entertainmentRatio > 0.05) {
    score -= 10;
    issues.push({ severity: 'medium', label: '接待交際費がやや多め', detail: `売上の${Math.round(entertainmentRatio*100)}%。接待目的・相手先の記録を保管推奨` });
  }

  // 家賃按分比率チェック（売上の50%超は過大）
  const rentTotal = expenseCategories.find(c => c.category === 'rent')?.total || 0;
  const rentRatio = rentTotal / totalInc;
  if (rentRatio > 0.50) {
    score -= 20;
    issues.push({ severity: 'high', label: '家賃・光熱費が過大', detail: `売上の${Math.round(rentRatio*100)}%。自宅按分は事業専用面積比率に基づく根拠が必要` });
  } else if (rentRatio > 0.30) {
    score -= 10;
    issues.push({ severity: 'medium', label: '家賃按分を確認', detail: `売上の${Math.round(rentRatio*100)}%。按分計算の根拠書類を整備推奨` });
  }

  // 一般経費の未分類比率（高すぎると調査対象）
  const generalTotal = expenseCategories.find(c => c.category === 'general')?.total || 0;
  const generalRatio = generalTotal / totalExp;
  if (generalRatio > 0.70) {
    score -= 15;
    issues.push({ severity: 'medium', label: '支出が未分類のまま', detail: `支出の${Math.round(generalRatio*100)}%が「一般経費」。より詳細な科目分類を推奨` });
  }

  // 固定資産の減価償却未登録チェック
  const assetTotal = expenseCategories.find(c => c.category === 'asset')?.total || 0;
  const depCount = (depDetails || []).length;
  if (assetTotal >= 100000 && depCount === 0) {
    score -= 15;
    issues.push({ severity: 'medium', label: '固定資産の減価償却が未登録', detail: `¥${assetTotal.toLocaleString()}の固定資産支出があります。10万円以上は減価償却登録が必要` });
  }

  // 医療費チェック（個人事業主で医療費が突出）
  const medicalTotal = expenseCategories.find(c => c.category === 'medical')?.total || 0;
  if (medicalTotal > 500000) {
    score -= 10;
    issues.push({ severity: 'medium', label: '医療費が高額', detail: `¥${medicalTotal.toLocaleString()}。業務との関連性の説明が必要な場合があります` });
  }

  // スコアが高い場合のポジティブフィードバック
  if (score >= 90) {
    issues.push({ severity: 'good', label: '良好な税務管理', detail: '科目分類・比率ともに健全です。この状態を維持してください' });
  }

  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D';
  const gradeLabel = score >= 90 ? '優良' : score >= 75 ? '良好' : score >= 60 ? '要注意' : '要改善';
  return { score: Math.max(0, score), grade, gradeLabel, issues };
}

// 月末日を取得
function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// 支払スケジュール生成（いつ・何を・いくら）
function generatePaymentSchedule(year, taxes) {
  const y = parseInt(year);
  const s = [];
  const { incomeTax, reconstructionTax, residentTax, nhiTotal, businessTax, consumptionTax } = taxes;
  const totalIT = (incomeTax || 0) + (reconstructionTax || 0);

  if (totalIT > 0) {
    s.push({ date: `${y+1}-03-15`, label: '所得税（確定申告）', amount: totalIT, cat: 'income_tax', icon: '📝' });
    if (totalIT > 150000) {
      const pre = Math.floor(totalIT / 3);
      s.push({ date: `${y+1}-07-31`, label: '予定納税（第1期）', amount: pre, cat: 'income_tax', icon: '📝' });
      s.push({ date: `${y+1}-11-30`, label: '予定納税（第2期）', amount: pre, cat: 'income_tax', icon: '📝' });
    }
  }

  if ((residentTax || 0) > 0) {
    const q = Math.floor(residentTax / 4);
    const q1 = residentTax - q * 3;
    s.push({ date: `${y+1}-06-30`, label: '住民税①', amount: q1, cat: 'resident', icon: '🏙' });
    s.push({ date: `${y+1}-08-31`, label: '住民税②', amount: q, cat: 'resident', icon: '🏙' });
    s.push({ date: `${y+1}-10-31`, label: '住民税③', amount: q, cat: 'resident', icon: '🏙' });
    s.push({ date: `${y+2}-01-31`, label: '住民税④', amount: q, cat: 'resident', icon: '🏙' });
  }

  if ((nhiTotal || 0) > 0) {
    const per = Math.floor(nhiTotal / 10);
    [6,7,8,9,10,11,12,1,2,3].forEach((m, i) => {
      const yr = m >= 6 ? y + 1 : y + 2;
      const day = lastDayOfMonth(yr, m);
      const amt = i === 9 ? nhiTotal - per * 9 : per;
      s.push({ date: `${yr}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`, label: `国保（${i+1}期）`, amount: amt, cat: 'nhi', icon: '🏥' });
    });
  }

  if ((businessTax || 0) > 0) {
    const h = Math.floor(businessTax / 2);
    s.push({ date: `${y+1}-08-31`, label: '事業税①', amount: h, cat: 'biz_tax', icon: '💼' });
    s.push({ date: `${y+1}-11-30`, label: '事業税②', amount: businessTax - h, cat: 'biz_tax', icon: '💼' });
  }

  if (consumptionTax?.applicable) {
    s.push({ date: `${y+1}-03-31`, label: '消費税', amount: consumptionTax.amount, cat: 'consumption', icon: '🧾' });
  }

  return s.sort((a, b) => a.date.localeCompare(b.date));
}

function calcDepreciationForYear(dep, year) {
  const purchaseYear = parseInt(dep.purchase_date.slice(0, 4));
  const purchaseMonth = parseInt(dep.purchase_date.slice(5, 7));
  const y = parseInt(year);
  if (y < purchaseYear) return 0;
  // 売却済みの場合、売却年以降は0
  if (dep.sold_date) {
    const soldYear = parseInt(dep.sold_date.slice(0, 4));
    if (y > soldYear) return 0;
    // 売却年は売却月までの月割り
    if (y === soldYear) {
      const soldMonth = parseInt(dep.sold_date.slice(5, 7));
      const yearlyAmount = Math.floor(dep.purchase_amount / dep.useful_life);
      return Math.floor(yearlyAmount * soldMonth / 12);
    }
  }
  const life = dep.useful_life;
  const yearlyAmount = Math.floor(dep.purchase_amount / life);
  const elapsed = y - purchaseYear;
  if (elapsed >= life) return 0;
  if (elapsed === 0) {
    const months = 12 - purchaseMonth + 1;
    return Math.floor(yearlyAmount * months / 12);
  }
  return yearlyAmount;
}

function calcDepreciationRemaining(dep) {
  const purchaseDate = new Date(dep.purchase_date);
  const endDate = new Date(purchaseDate);
  endDate.setFullYear(endDate.getFullYear() + dep.useful_life);
  if (dep.sold_date) return { months: 0, percent: 0 };
  const now = new Date();
  if (now >= endDate) return { months: 0, percent: 100 };
  const totalMonths = dep.useful_life * 12;
  const elapsedMs = now - purchaseDate;
  const elapsedMonths = Math.floor(elapsedMs / (30.44 * 24 * 60 * 60 * 1000));
  const remaining = Math.max(0, totalMonths - elapsedMonths);
  const percent = Math.round(elapsedMonths / totalMonths * 100);
  return { months: remaining, percent: Math.min(percent, 100) };
}

// 所得区分別ラベル
const INCOME_TYPE_LABELS = {
  business: '事業所得', salary: '給与所得', fx_stock: '株・FX（分離課税）',
  real_estate: '不動産所得', misc: 'その他の所得'
};

// 控除タイプ別ラベル
const DEDUCTION_LABELS = {
  blue_return: '青色申告特別控除', basic: '基礎控除', medical: '医療費控除',
  social_insurance: '社会保険料控除', spouse: '配偶者控除', dependent: '扶養控除',
  life_insurance: '生命保険料控除', earthquake: '地震保険料控除',
  small_business: '小規模企業共済等掛金控除', hometown_tax: 'ふるさと納税', other: 'その他控除'
};

// 税額シミュレーション
router.get('/api/tax-simulation/:year', auth, (req, res) => {
  try {
    const book = bookAccess(req);
    if (!book) return res.status(403).json({ error: '帳簿アクセス権がありません' });
    const year = req.params.year;

    // 収入（区分別、承認済みのみ）
    const incomeByType = db.prepare("SELECT COALESCE(income_type,'business') as income_type, SUM(amount) as total FROM income WHERE book_id=? AND (status='approved' OR status IS NULL) AND strftime('%Y',date)=? GROUP BY COALESCE(income_type,'business')").all(book.id, year);
    const totalIncome = incomeByType.reduce((s, r) => s + r.total, 0);
    const businessIncome = incomeByType.find(r => r.income_type === 'business')?.total || 0;
    const separateIncome = incomeByType.find(r => r.income_type === 'fx_stock')?.total || 0;

    // 課税売上・非課税売上の分類（消費税計算用）
    const taxableRevenue = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM income WHERE book_id=? AND (status='approved' OR status IS NULL) AND strftime('%Y',date)=? AND COALESCE(taxable,1)=1").get(book.id, year).t;
    const nonTaxableRevenue = totalIncome - taxableRevenue;

    // 消費税壁アラート（課税売上1,000万円基準）
    const CT_THRESHOLD = 10000000;
    const taxableRatio = CT_THRESHOLD > 0 ? Math.min(100, Math.round(taxableRevenue / CT_THRESHOLD * 100)) : 0;
    const consumptionTaxAlert = {
      taxableRevenue,
      nonTaxableRevenue,
      threshold: CT_THRESHOLD,
      ratio: taxableRatio,
      level: taxableRevenue >= CT_THRESHOLD ? 'over'
           : taxableRevenue >= 9000000 ? 'danger'
           : taxableRevenue >= 7000000 ? 'warning'
           : 'safe',
      message: taxableRevenue >= CT_THRESHOLD
        ? `課税売上が1,000万円を超えています。翌々年から消費税の申告・納税義務が発生します`
        : taxableRevenue >= 9000000
        ? `課税売上が900万円超。あと¥${(CT_THRESHOLD - taxableRevenue).toLocaleString()}で消費税納税義務が発生します`
        : taxableRevenue >= 7000000
        ? `課税売上が700万円超。1,000万円の壁まであと¥${(CT_THRESHOLD - taxableRevenue).toLocaleString()}です`
        : null
    };

    // 経費（承認済みのみ、利益課税は除外）
    const totalExpenses = db.prepare(`SELECT COALESCE(SUM(amount),0) as t FROM expenses WHERE book_id=? AND (status='approved' OR status IS NULL) AND strftime('%Y',date)=? ${EXPENSE_EXCLUDE_FILTER}`).get(book.id, year).t;
    const taxProfitTotal = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM expenses WHERE book_id=? AND (status='approved' OR status IS NULL) AND strftime('%Y',date)=? AND category='tax_non_deductible'").get(book.id, year).t;

    // 減価償却
    const deps = db.prepare('SELECT * FROM depreciations WHERE book_id=?').all(book.id);
    let totalDepreciation = 0;
    const depDetails = deps.map(d => {
      const amt = calcDepreciationForYear(d, year);
      totalDepreciation += amt;
      const remaining = calcDepreciationRemaining(d);
      return { ...d, yearAmount: amt, remainingMonths: remaining.months, depreciatedPercent: remaining.percent };
    });

    // 経費カテゴリから自動検出される控除（承認済みのみ）
    const medicalExpenses = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM expenses WHERE book_id=? AND (status='approved' OR status IS NULL) AND strftime('%Y',date)=? AND category='medical'").get(book.id, year).t;
    const insuranceExpenses = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM expenses WHERE book_id=? AND (status='approved' OR status IS NULL) AND strftime('%Y',date)=? AND category='insurance'").get(book.id, year).t;

    // 控除
    const deductions = db.prepare('SELECT * FROM deductions WHERE book_id=? AND year=?').all(book.id, year);
    let totalDeductions = 0;
    const hasBasic = deductions.some(d => d.type === 'basic');
    const hasMedical = deductions.some(d => d.type === 'medical');
    const hasInsurance = deductions.some(d => d.type === 'social_insurance');
    const deductionList = [];
    if (!hasBasic) deductionList.push({ type: 'basic', name: '基礎控除', amount: 480000, auto: true });
    // 医療費控除: 10万円 or 所得の5%の低い方を超えた分（自動計算）
    const medThreshold = medicalDeductionThreshold(totalIncome - totalExpenses);
    if (!hasMedical && medicalExpenses > medThreshold) {
      deductionList.push({ type: 'medical', name: '医療費控除（自動）', amount: Math.min(medicalExpenses - medThreshold, 2000000), auto: true });
    }
    // 社会保険料控除: 保険カテゴリの経費全額が控除（自動計算）
    if (!hasInsurance && insuranceExpenses > 0) {
      deductionList.push({ type: 'social_insurance', name: '社会保険料控除（自動計算）', amount: insuranceExpenses, auto: true });
    }
    deductions.forEach(d => { deductionList.push({ ...d, auto: false }); });
    totalDeductions = deductionList.reduce((s, d) => s + d.amount, 0);

    // 課税所得（総合課税分）
    const comprehensiveIncome = totalIncome - separateIncome;
    const netBusinessIncome = Math.max(0, comprehensiveIncome - totalExpenses - totalDepreciation);
    const taxableIncome = Math.max(0, netBusinessIncome - totalDeductions);

    // 税額計算
    const incomeTax = calcIncomeTax(taxableIncome);
    const reconstructionTax = Math.floor(incomeTax * 0.021);
    const residentTax = calcResidentTax(taxableIncome);
    const separateTax = separateIncome > 0 ? Math.floor(separateIncome * 0.20315) : 0;
    const totalTax = incomeTax + reconstructionTax + residentTax + separateTax;

    // 現在の税率帯
    let currentBracket = INCOME_TAX_BRACKETS[0];
    for (const b of INCOME_TAX_BRACKETS) { if (taxableIncome <= b.limit) { currentBracket = b; break; } }

    // 収入区分別の税額内訳（カテゴリ別把握）
    const taxByIncomeType = incomeByType.map(r => {
      const label = INCOME_TYPE_LABELS[r.income_type] || r.income_type;
      if (r.income_type === 'fx_stock') {
        const tax = Math.floor(r.total * 0.20315);
        return { income_type: r.income_type, label, amount: r.total, taxRate: 20.315, taxRateLabel: '20.315%（所得税15.315% + 住民税5%）', taxAmount: tax, method: '申告分離課税' };
      } else {
        return { income_type: r.income_type, label, amount: r.total, taxRate: null, taxRateLabel: '総合課税（累進税率）', taxAmount: null, method: '総合課税' };
      }
    });

    // 総合課税の税率・税額詳細
    const comprehensiveTaxDetail = {
      income: comprehensiveIncome,
      expenses: totalExpenses,
      depreciation: totalDepreciation,
      netIncome: netBusinessIncome,
      deductions: totalDeductions,
      taxableIncome: taxableIncome,
      incomeTaxRate: currentBracket.rate,
      incomeTaxRatePercent: Math.round(currentBracket.rate * 100),
      incomeTax,
      reconstructionTax,
      residentTaxRate: 10,
      residentTax,
      totalComprehensiveTax: incomeTax + reconstructionTax + residentTax
    };

    // カテゴリ別支出集計
    const expenseCategories = db.prepare(`SELECT category, SUM(amount) as total, COUNT(*) as count FROM expenses WHERE book_id=? AND (status='approved' OR status IS NULL) AND strftime('%Y',date)=? GROUP BY category ORDER BY total DESC`).all(book.id, year);

    // 個人 or 法人で分岐
    const entityType = book.entity_type || 'individual';
    const isCorp = entityType === 'corporate';

    let taxResult, adviceGroups, paymentSchedule, taxSummary, totalAllTaxes, effectiveTotalRate;

    if (isCorp) {
      // ===== 法人税計算 =====
      const corpTaxableIncome = Math.max(0, comprehensiveIncome - totalExpenses - totalDepreciation);
      const corpTax = calcCorporateTax(corpTaxableIncome);
      const corpResTax = calcCorpResidentTax(corpTax);
      const corpBizTax = calcCorpBusinessTax(corpTaxableIncome);
      const corpSpecBizTax = calcCorpSpecialBizTax(corpTaxableIncome);
      const consumptionTax = calcConsumptionTax(taxableRevenue);
      const corpTotalTax = corpTax + corpResTax + corpBizTax + corpSpecBizTax + (consumptionTax.applicable ? consumptionTax.amount : 0);

      const corpEffRate = comprehensiveIncome > 0 ? (corpTax + corpResTax + corpBizTax + corpSpecBizTax) / corpTaxableIncome : 0;

      taxResult = {
        incomeTax: corpTax, reconstructionTax: 0, residentTax: corpResTax,
        separateTax: 0, totalTax: corpTotalTax,
        corpBizTax, corpSpecBizTax, consumptionTax,
      };
      totalAllTaxes = corpTotalTax;
      effectiveTotalRate = comprehensiveIncome > 0 ? Math.round(corpTotalTax / comprehensiveIncome * 1000) / 10 : 0;

      const fm = book.fiscal_start_month || 4;
      const fiscalEndMonth = fm === 1 ? 12 : fm - 1;
      paymentSchedule = generateCorpPaymentSchedule(fiscalEndMonth, {
        corpTax, corpResidentTax: corpResTax, corpBizTax, corpSpecBizTax, consumptionTax
      });

      taxSummary = [
        { label: '法人税', amount: corpTax, icon: '🏢' },
        { label: '法人住民税', amount: corpResTax, icon: '🏙' },
        { label: '法人事業税', amount: corpBizTax + corpSpecBizTax, icon: '💼' },
      ];
      if (consumptionTax.applicable) taxSummary.push({ label: '消費税', amount: consumptionTax.amount, icon: '🧾' });

      // 法人向けアドバイス
      adviceGroups = [];
      if (corpTaxableIncome > 0) {
        const corpRate = corpTaxableIncome <= 8000000 ? 0.15 : 0.232;
        const fullRate = corpRate + 0.104 * corpRate + (corpTaxableIncome <= 4000000 ? 0.035 : corpTaxableIncome <= 8000000 ? 0.053 : 0.07);
        adviceGroups.push({
          id: 'corp_expense', title: '損金を増やす', icon: '📊',
          desc: '事業支出を増やして法人所得を下げる',
          currentTotal: totalExpenses,
          steps: [100000, 500000, 1000000, 3000000].map(a => ({ add: a, saving: Math.floor(a * fullRate) })),
        });
        if (corpTaxableIncome > 8000000) {
          const over = corpTaxableIncome - 8000000;
          adviceGroups.push({
            id: 'bracket_down', title: '法人税率ダウン', icon: '💎',
            desc: `あと¥${over.toLocaleString()}の損金で税率23.2%→15%`,
            steps: [{ add: over, saving: Math.floor(over * (0.232 - 0.15)) }],
          });
        }
        adviceGroups.push({
          id: 'exec_comp', title: '役員報酬の最適化', icon: '👤',
          desc: '法人利益と個人所得のバランスで全体最適化',
          steps: [{ add: 0, saving: 0, note: '税理士と要相談' }],
        });
      }
    } else {
      // ===== 個人税計算（既存ロジック拡張） =====
      const nhiRate = NHI_RATES.medical.incomeRate + NHI_RATES.support.incomeRate;
      const bizTaxRate = netBusinessIncome > 2900000 ? 0.05 : 0;
      const effectiveRate = taxableIncome > 0 ? (currentBracket.rate + 0.10 + currentBracket.rate * 0.021 + nhiRate + bizTaxRate) : 0;

      const nhi = calcNHI(comprehensiveIncome, totalExpenses + totalDepreciation, 0);
      const businessTax = calcBusinessTax(netBusinessIncome);
      const consumptionTax = calcConsumptionTax(taxableRevenue);
      totalAllTaxes = totalTax + nhi.total + businessTax + (consumptionTax.applicable ? consumptionTax.amount : 0);
      effectiveTotalRate = comprehensiveIncome > 0 ? Math.round(totalAllTaxes / comprehensiveIncome * 1000) / 10 : 0;

      taxResult = {
        incomeTax, reconstructionTax, residentTax, separateTax, totalTax,
        nhi, businessTax, consumptionTax,
      };

      paymentSchedule = generatePaymentSchedule(year, {
        incomeTax, reconstructionTax, residentTax, nhiTotal: nhi.total, businessTax, consumptionTax
      });

      taxSummary = [
        { label: '所得税', amount: incomeTax + reconstructionTax, icon: '📝' },
        { label: '住民税', amount: residentTax, icon: '🏙' },
        { label: '国民健康保険', amount: nhi.total, icon: '🏥' },
        { label: '個人事業税', amount: businessTax, icon: '💼' },
      ];
      if (consumptionTax.applicable) taxSummary.push({ label: '消費税', amount: consumptionTax.amount, icon: '🧾' });
      if (separateTax > 0) taxSummary.push({ label: '分離課税', amount: separateTax, icon: '📈' });

      // 個人向けアドバイス（グループ×段階）
      adviceGroups = [];
      if (taxableIncome > 0) {
        // Group 1: 事業支出全般
        const generalCats = ['cogs','labor','general','entertainment'];
        const generalTotal = expenseCategories.filter(c => generalCats.includes(c.category)).reduce((s,c) => s + c.total, 0);
        adviceGroups.push({
          id: 'general_expense', title: '事業支出を増やす', icon: '📊',
          desc: '仕入・外注・備品・交通費・広告など全般',
          currentTotal: generalTotal,
          steps: [100000, 500000, 1000000].map(a => ({ add: a, saving: Math.floor(a * effectiveRate) })),
        });

        // Group 2: 家賃按分
        const rentTotal = expenseCategories.find(c => c.category === 'rent')?.total || 0;
        adviceGroups.push({
          id: 'home_office', title: '家賃・光熱費の按分', icon: '🏠',
          desc: rentTotal > 0 ? `現在¥${rentTotal.toLocaleString()}計上中` : '自宅兼事務所なら家賃の一部を控除',
          currentTotal: rentTotal,
          steps: [{ add: 120000, saving: Math.floor(120000 * effectiveRate) }, { add: 360000, saving: Math.floor(360000 * effectiveRate) }],
        });

        // Group 3: 保険・年金
        if (insuranceExpenses === 0) {
          adviceGroups.push({
            id: 'insurance', title: '社会保険料の控除', icon: '🛡',
            desc: '国保・年金は全額が所得控除',
            currentTotal: 0,
            steps: [{ add: 200000, saving: Math.floor(200000 * effectiveRate) }, { add: 500000, saving: Math.floor(500000 * effectiveRate) }],
          });
        }

        // Group 4: 医療費
        const medThresholdVal = medicalDeductionThreshold(comprehensiveIncome - totalExpenses);
        if (medicalExpenses > 0 && medicalExpenses <= medThresholdVal) {
          const remaining = medThresholdVal - medicalExpenses;
          adviceGroups.push({
            id: 'medical', title: '医療費控除まであと少し', icon: '🏥',
            desc: `現在¥${medicalExpenses.toLocaleString()} → あと¥${remaining.toLocaleString()}で控除発動`,
            currentTotal: medicalExpenses,
            steps: [{ add: remaining, saving: Math.floor(remaining * effectiveRate) }],
          });
        } else if (medicalExpenses === 0) {
          adviceGroups.push({
            id: 'medical', title: '医療費控除', icon: '🏥',
            desc: `年間${medThresholdVal > 0 ? '¥' + medThresholdVal.toLocaleString() : '¥100,000'}超で自動控除`,
            currentTotal: 0,
            steps: [{ add: 150000, saving: Math.floor(50000 * effectiveRate) }],
          });
        }

        // Group 5: 税率帯ダウン
        for (let i = INCOME_TAX_BRACKETS.length - 1; i >= 0; i--) {
          if (taxableIncome > INCOME_TAX_BRACKETS[i].limit) {
            const over = taxableIncome - INCOME_TAX_BRACKETS[i].limit;
            const curRate = Math.round((INCOME_TAX_BRACKETS[i + 1]?.rate || currentBracket.rate) * 100);
            const lowRate = Math.round(INCOME_TAX_BRACKETS[i].rate * 100);
            adviceGroups.push({
              id: 'bracket_down', title: '税率帯ダウン', icon: '💎',
              desc: `あと¥${over.toLocaleString()}の支出で所得税率 ${curRate}%→${lowRate}%`,
              steps: [{ add: over, saving: Math.floor(over * (currentBracket.rate - INCOME_TAX_BRACKETS[i].rate)) }],
            });
            break;
          }
        }

        // 全対策の最大節税額
        const maxSaving = adviceGroups.reduce((s, g) => {
          const maxStep = g.steps[g.steps.length - 1];
          return s + (maxStep?.saving || 0);
        }, 0);
        adviceGroups.unshift({
          id: 'summary', title: '全対策で最大', icon: '🎯',
          desc: `年間最大 ¥${maxSaving.toLocaleString()} の節税が可能`,
          maxSaving, effectiveRatePercent: Math.round(effectiveRate * 1000) / 10,
        });
      }
    }

    // 支出カテゴリ別の節税効果（共通）
    const effectiveRate = taxableIncome > 0 ? (isCorp ? 0.25 : (currentBracket.rate + 0.10 + currentBracket.rate * 0.021)) : 0;
    const expenseTaxImpact = expenseCategories.map(c => ({
      category: c.category, total: c.total, count: c.count,
      taxSaving: Math.floor(c.total * effectiveRate),
      effectiveRate: Math.round(effectiveRate * 1000) / 10
    }));

    // 欠損金（赤字）繰越の計算
    const currentYearNetIncome = comprehensiveIncome - totalExpenses - totalDepreciation - totalDeductions;
    const carryoverLoss = (() => {
      if (currentYearNetIncome >= 0) return { hasLoss: false, amount: 0, nextYearSaving: 0 };
      const lossAmt = Math.abs(currentYearNetIncome);
      const savingRate = isCorp ? 0.25 : (currentBracket.rate + 0.10);
      return {
        hasLoss: true,
        amount: lossAmt,
        nextYearSaving: Math.floor(lossAmt * savingRate),
        carryoverYears: isCorp ? 10 : 3,
        message: `今年の赤字¥${lossAmt.toLocaleString()}は${isCorp ? '10' : '3'}年間繰り越せます。来年の税金から最大¥${Math.floor(lossAmt * savingRate).toLocaleString()}を節税できます`
      };
    })();

    // 税務健全性スコア
    const healthScore = calcHealthScore(expenseCategories, totalExpenses, comprehensiveIncome, depDetails.length > 0, depDetails);

    // 税率帯一覧（個人のみ）
    const bracketMap = isCorp ? [] : INCOME_TAX_BRACKETS.map((b, i) => ({
      min: i === 0 ? 0 : INCOME_TAX_BRACKETS[i - 1].limit + 1,
      max: b.limit === Infinity ? null : b.limit,
      rate: b.rate, ratePercent: Math.round(b.rate * 100),
      isCurrent: taxableIncome <= b.limit && (i === 0 || taxableIncome > INCOME_TAX_BRACKETS[i - 1].limit)
    }));

    res.json({
      year, entityType,
      incomeByType: incomeByType.map(r => ({ ...r, label: INCOME_TYPE_LABELS[r.income_type] || r.income_type })),
      taxByIncomeType,
      comprehensiveTaxDetail,
      totalIncome, comprehensiveIncome, separateIncome,
      taxableRevenue, nonTaxableRevenue,
      totalExpenses, taxProfitTotal, totalDepreciation, totalDeductions,
      depreciationDetails: depDetails,
      deductions: deductionList.map(d => ({ ...d, label: DEDUCTION_LABELS[d.type] || d.name || d.type })),
      netBusinessIncome, taxableIncome,
      expenseTaxImpact,
      tax: taxResult,
      nhi: taxResult.nhi || null,
      businessTax: taxResult.businessTax || 0,
      consumptionTax: taxResult.consumptionTax || { applicable: false, amount: 0 },
      totalAllTaxes, effectiveTotalRate,
      taxSummary, paymentSchedule, adviceGroups,
      currentBracket: { rate: currentBracket.rate, ratePercent: Math.round(currentBracket.rate * 100) },
      bracketMap,
      labels: { incomeTypes: INCOME_TYPE_LABELS, deductionTypes: DEDUCTION_LABELS },
      consumptionTaxAlert,
      carryoverLoss,
      healthScore
    });
  } catch (err) { logError(err.message, '/api/tax-simulation', req.userId, err.stack); res.status(500).json({ error: err.message }); }
});

// 控除 CRUD
router.get('/api/deductions/:year', auth, (req, res) => {
  try {
    const book = bookAccess(req);
    if (!book) return res.status(403).json({ error: '帳簿アクセス権がありません' });
    res.json(db.prepare('SELECT * FROM deductions WHERE book_id=? AND year=? ORDER BY id').all(book.id, req.params.year));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/deductions', auth, (req, res) => {
  try {
    const { bookId, year, type, name, amount } = req.body;
    const book = bookAccess(req);
    if (!book) return res.status(403).json({ error: '帳簿アクセス権がありません' });
    const r = db.prepare('INSERT INTO deductions (book_id,year,type,name,amount) VALUES (?,?,?,?,?)').run(book.id, year, type, name || '', parseInt(amount) || 0);
    res.json({ id: r.lastInsertRowid, success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/api/deductions/:id', auth, (req, res) => {
  try {
    const d = db.prepare('SELECT d.* FROM deductions d JOIN books b ON d.book_id=b.id WHERE d.id=? AND b.user_id=?').get(req.params.id, req.userId);
    if (!d) return res.status(404).json({ error: '見つかりません' });
    db.prepare('DELETE FROM deductions WHERE id=?').run(d.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 減価償却 CRUD
router.get('/api/depreciations', auth, (req, res) => {
  try {
    const book = bookAccess(req);
    if (!book) return res.status(403).json({ error: '帳簿アクセス権がありません' });
    res.json(db.prepare('SELECT * FROM depreciations WHERE book_id=? ORDER BY purchase_date DESC').all(book.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/depreciations', auth, (req, res) => {
  try {
    const { bookId, name, purchase_date, purchase_amount, useful_life, method, memo } = req.body;
    const book = bookAccess(req);
    if (!book) return res.status(403).json({ error: '帳簿アクセス権がありません' });
    const r = db.prepare('INSERT INTO depreciations (book_id,name,purchase_date,purchase_amount,useful_life,method,memo) VALUES (?,?,?,?,?,?,?)').run(
      book.id, name, purchase_date, parseInt(purchase_amount), parseInt(useful_life) || 4, method || 'straight', memo || ''
    );
    res.json({ id: r.lastInsertRowid, success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 減価償却: 売却登録
router.put('/api/depreciations/:id/sell', auth, (req, res) => {
  try {
    const { sold_date, sold_amount } = req.body;
    const d = db.prepare('SELECT d.* FROM depreciations d JOIN books b ON d.book_id=b.id WHERE d.id=? AND b.user_id=?').get(req.params.id, req.userId);
    if (!d) return res.status(404).json({ error: '見つかりません' });
    db.prepare('UPDATE depreciations SET sold_date=?, sold_amount=? WHERE id=?').run(sold_date, parseInt(sold_amount) || 0, d.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/api/depreciations/:id', auth, (req, res) => {
  try {
    const d = db.prepare('SELECT d.* FROM depreciations d JOIN books b ON d.book_id=b.id WHERE d.id=? AND b.user_id=?').get(req.params.id, req.userId);
    if (!d) return res.status(404).json({ error: '見つかりません' });
    db.prepare('DELETE FROM depreciations WHERE id=?').run(d.id);
    res.json({ success: true });
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
    const cn = { cogs:'仕入・原価',labor:'外注・人件費',rent:'家賃・光熱費',general:'一般経費',entertainment:'接待交際費',insurance:'保険・年金',welfare:'福利厚生費',medical:'医療費',tax_deductible:'租税公課',tax_non_deductible:'税金(非経費)',asset:'固定資産' };
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
      if (date && amount > 0) rows.push({ date, amount, description: desc.trim(), category: suggestCategoryWithAmount(desc, amount) });
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
    const stmt = db.prepare('INSERT INTO expenses (book_id,date,amount,category,description,source,created_by,status,approved_at,approved_by) VALUES (?,?,?,?,?,?,?,?,?,?)');
    const approvedAt = new Date().toISOString();
    const tx = db.transaction((items) => {
      let c = 0;
      for (const i of items) { if (i.date && i.amount > 0) { stmt.run(book.id, i.date, Math.abs(i.amount), i.category||'general', i.description||'', 'csv', req.userId, 'approved', approvedAt, req.userId); c++; } }
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

// レシートZIPエクスポート（任意期間、カテゴリ別フォルダ）
router.get('/api/export-receipts', auth, (req, res) => {
  try {
    const book = bookAccess(req);
    if (!book) return res.status(403).json({ error: '帳簿アクセス権がありません' });
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: '開始日と終了日を指定してください' });

    const expenses = db.prepare(
      "SELECT e.*, u.name as creator_name FROM expenses e LEFT JOIN users u ON e.created_by = u.id WHERE e.book_id=? AND (e.status='approved' OR e.status IS NULL) AND e.date >= ? AND e.date <= ? AND e.receipt_path IS NOT NULL AND e.receipt_path != '' ORDER BY e.date"
    ).all(book.id, startDate, endDate);

    if (expenses.length === 0) return res.status(404).json({ error: '該当期間のレシートがありません' });

    const CATEGORY_NAMES = {
      cogs:'仕入・原価', labor:'外注・人件費', rent:'家賃・光熱費', general:'一般経費',
      entertainment:'接待交際費', insurance:'保険・年金', welfare:'福利厚生費', medical:'医療費',
      tax_deductible:'租税公課', tax_non_deductible:'税金(非経費)', asset:'固定資産'
    };

    const zipName = `Receipts_${startDate}_${endDate}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res);

    for (const e of expenses) {
      const fp = path.join(__dirname, e.receipt_path.startsWith('/') ? e.receipt_path : '/' + e.receipt_path);
      if (!fs.existsSync(fp)) continue;
      const catName = CATEGORY_NAMES[e.category] || e.category || '未分類';
      const desc = (e.description || '').replace(/[\/\\:*?"<>|]/g, '_').substring(0, 30);
      const fileName = `${e.date}_${e.amount}円_${desc}${path.extname(fp)}`;
      archive.file(fp, { name: `${startDate}_${endDate}/${catName}/${fileName}` });
    }

    archive.finalize();
  } catch (err) { logError(err.message, '/api/export-receipts', req.userId, err.stack); res.status(500).json({ error: err.message }); }
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
