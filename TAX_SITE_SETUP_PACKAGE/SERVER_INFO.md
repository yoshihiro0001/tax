# サーバー・ドメイン情報

## 🌐 ドメイン構成

### メインドメイン
```
fashionhoteljoy.com
```

### 新ツールのURL
- **アクセスURL**: `https://fashionhoteljoy.com/tax`
- **データAPI**: `https://fashionhoteljoy.com/tax/api/*`（内部使用のみ）

### 既存サイト（参考）
- **ホテル管理**: `https://fashionhoteljoy.com/staff`
- **株情報サイト**: `https://fashionhoteljoy.com/kabu`

### 認証方式（個人用最小限）
- **Option 1**: HTTP Basic認証（ユーザー名・パスワード）
- **Option 2**: 秘密のURLパス（例: `/tax-secret-abc123`）
- **Option 3**: 認証なし（サーバーのIPアクセス制限で保護）

## 🖥️ サーバー環境

### 開発環境

**Node.js版の場合:**
- **ホスト**: `127.0.0.1`（ローカル）
- **ポート**: `3000`
- **URL**: `http://localhost:3000`

**Python版の場合:**
- **ホスト**: `127.0.0.1`（ローカル）
- **ポート**: `5000`
- **URL**: `http://localhost:5000`

### 本番環境
- **サーバーIP**: （既存サーバーと同じ）
- **Webサーバー**: Nginx（リバースプロキシ設定）
- **アプリサーバー**: Node.js or Python
- **ポート**: 内部ポート（例: 3001）→ Nginxが `/tax` にプロキシ
- **ドキュメントルート**: 既存サイトと同じサーバー上

## 📁 ディレクトリ構造（本番）

### 推奨配置（シンプル構成）

```
/var/www/
├── hotel_system/          # 既存のホテル管理システム（Laravel）
│   └── public/
│       ├── staff/         # /staff サブディレクトリ
│       └── kabu/          # /kabu サブディレクトリ
│
└── tax-tool/              # 新しい経費管理ツール（軽量）
    ├── server.js          # Node.js版メインファイル
    ├── app.py             # Python版メインファイル
    ├── public/            # 静的ファイル
    │   ├── index.html
    │   ├── style.css
    │   └── app.js
    ├── data/              # データ保存
    │   ├── database.sqlite   # SQLiteファイル
    │   └── backups/          # JSONバックアップ
    └── uploads/           # レシート画像
```

### ファイル構成（最小限）

```
tax-tool/
├── package.json           # Node.js依存関係（5個程度）
├── server.js              # バックエンド（100-200行）
├── public/
│   ├── index.html         # メイン画面（1ページのみ）
│   ├── style.css          # スタイル（Tailwind CDN or 軽量CSS）
│   └── app.js             # フロントロジック（300-500行）
├── data/
│   └── database.sqlite    # データベースファイル（数MB）
└── uploads/               # アップロード画像
```

## 🔧 Webサーバー設定

### Nginx設定（リバースプロキシ）

既存の設定ファイルに追加：`/etc/nginx/sites-available/fashionhoteljoy.com`

```nginx
server {
    listen 80;
    server_name fashionhoteljoy.com;
    
    # 既存のLaravelサイト（/staff, /kabu 等）
    location / {
        root /var/www/hotel_system/public;
        try_files $uri $uri/ /index.php?$query_string;
        
        location ~ \.php$ {
            fastcgi_pass unix:/var/run/php/php8.2-fpm.sock;
            fastcgi_index index.php;
            fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
            include fastcgi_params;
        }
    }
    
    # 新しい経費管理ツール（/tax）
    location /tax {
        proxy_pass http://localhost:3001;  # Node.jsアプリのポート
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### PM2で Node.js を永続化（推奨）

```bash
# PM2インストール
npm install -g pm2

# アプリ起動
pm2 start server.js --name tax-tool

# 自動起動設定
pm2 startup
pm2 save
```

### Pythonの場合（Gunicorn使用）

```bash
# Gunicornインストール
pip install gunicorn

# 起動
gunicorn -w 2 -b 127.0.0.1:3001 app:app
```

## 🔒 SSL証明書

既存のSSL証明書が `fashionhoteljoy.com` ドメイン全体をカバーしている場合、そのまま使用可能です。

- **既存証明書**: Let's Encrypt または商用証明書
- **HTTPS**: `https://fashionhoteljoy.com/tax`

## ⚙️ 必要な環境

### Node.js版の場合

```bash
# Node.jsバージョン確認
node --version  # v18以上推奨

# npmパッケージ（最小限）
npm install express sqlite3 multer papaparse
```

### Python版の場合

```bash
# Pythonバージョン確認
python3 --version  # Python 3.8以上

# 必要なパッケージ
pip install flask sqlite3
```

### サーバー要件（軽量）

- **メモリ**: 100MB程度（個人用なので最小）
- **CPU**: 既存サーバーのリソースで十分
- **ディスク**: 100MB（データ・画像含む）

## 🔄 デプロイ方法（シンプル）

### 1. サーバーにファイルアップロード

```bash
# ローカルからサーバーへrsync
rsync -avz tax-tool/ user@fashionhoteljoy.com:/var/www/tax-tool/

# または Git経由
cd /var/www
git clone https://github.com/your-repo/tax-tool.git
```

### 2. 依存関係インストール

```bash
cd /var/www/tax-tool

# Node.js版
npm install --production

# Python版
pip install -r requirements.txt
```

### 3. アプリ起動

```bash
# Node.js + PM2
pm2 start server.js --name tax-tool -i 1

# Python + Gunicorn
gunicorn -w 2 -b 127.0.0.1:3001 app:app --daemon
```

### 4. Nginx設定反映

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 📊 サーバーリソース

既存サイトと同じサーバーを使用する場合、以下を確認：

- **CPU**: 十分な余裕があるか
- **メモリ**: 追加のPHP-FPMプロセス分を確保
- **ディスク**: ログファイルやアップロードファイル用の容量

---

**更新日**: 2026年2月12日
