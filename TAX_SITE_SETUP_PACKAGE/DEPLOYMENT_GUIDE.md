# デプロイ手順ガイド（シンプル構成）

このドキュメントでは、個人用経費管理ツールを本番環境（`fashionhoteljoy.com/tax`）にデプロイする手順を説明します。

---

## 🎯 デプロイ方法の概要

既存のサーバー（`fashionhoteljoy.com`）に、軽量なNode.jsアプリとして追加します。

### 前提条件

- ✅ サーバーにSSHアクセス可能
- ✅ Node.js（v18以上）がインストール済み
- ✅ Nginxが稼働中
- ✅ 既存のhotel_systemが動作中

---

## 📦 Step 1: ローカルで開発・テスト

### 1-1. プロジェクト作成

```bash
# ローカルマシンで作業
mkdir tax-tool
cd tax-tool

# package.json作成
npm init -y

# 依存パッケージインストール
npm install express sqlite3 multer papaparse
```

### 1-2. ファイル作成

```bash
# ディレクトリ構成
mkdir -p public data uploads

# ファイル作成（TECHNICAL_STACK.md参照）
# - server.js
# - public/index.html
# - public/app.js
# - public/style.css
```

### 1-3. ローカルテスト

```bash
# 起動
node server.js

# ブラウザでアクセス
open http://localhost:3001
```

動作確認：
- 収入・経費入力ができるか
- 集計が表示されるか
- AI用フォーマットがコピーできるか

---

## 🚀 Step 2: サーバーへデプロイ

### 2-1. ファイルアップロード

#### Option A: rsync（推奨）

```bash
# ローカルからサーバーへ
rsync -avz --exclude 'node_modules' \
  tax-tool/ user@fashionhoteljoy.com:/var/www/tax-tool/
```

#### Option B: Git経由

```bash
# Gitリポジトリ作成（ローカル）
cd tax-tool
git init
git add .
git commit -m "初回コミット"

# プライベートリポジトリにpush（GitHub/GitLab）
git remote add origin https://github.com/your-repo/tax-tool.git
git push -u origin main

# サーバー側でclone
ssh user@fashionhoteljoy.com
cd /var/www
git clone https://github.com/your-repo/tax-tool.git
```

### 2-2. サーバー側でセットアップ

```bash
# サーバーにSSH接続
ssh user@fashionhoteljoy.com

# プロジェクトディレクトリへ移動
cd /var/www/tax-tool

# 依存パッケージインストール
npm install --production

# ディレクトリ作成
mkdir -p data uploads data/backups

# 権限設定
chmod 755 data uploads
chmod 644 data/database.sqlite  # 初回起動後に自動作成される
```

---

## ⚙️ Step 3: PM2で永続化

PM2を使ってNode.jsアプリをバックグラウンド実行します。

### 3-1. PM2インストール

```bash
# グローバルインストール
sudo npm install -g pm2
```

### 3-2. アプリ起動

```bash
# アプリ起動（ポート3001で起動するように server.js を設定）
cd /var/www/tax-tool
pm2 start server.js --name tax-tool

# 起動確認
pm2 list
pm2 logs tax-tool

# 自動起動設定
pm2 startup
pm2 save
```

### 3-3. PM2コマンド一覧

```bash
# 再起動
pm2 restart tax-tool

# 停止
pm2 stop tax-tool

# ログ確認
pm2 logs tax-tool

# モニタリング
pm2 monit
```

---

## 🔧 Step 4: Nginx設定

Nginxで `/tax` パスを Node.js アプリにプロキシします。

### 4-1. Nginx設定ファイル編集

```bash
sudo nano /etc/nginx/sites-available/fashionhoteljoy.com
```

### 4-2. 設定内容（追加部分）

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
    
    # ===== 新規追加：経費管理ツール =====
    location /tax {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # アップロード画像へのアクセス
    location /tax/uploads {
        alias /var/www/tax-tool/uploads;
    }
}
```

### 4-3. 設定反映

```bash
# 設定テスト
sudo nginx -t

# Nginx再起動
sudo systemctl reload nginx
```

---

## 🔐 Step 5: 認証設定（個人用最小限）

### Option A: HTTP Basic認証（推奨）

#### Nginx設定に追加

```bash
# パスワードファイル作成
sudo apt install apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd yoshihiro
# パスワード入力プロンプトが表示される
```

#### Nginx設定に追加

```nginx
location /tax {
    auth_basic "Tax Tool";
    auth_basic_user_file /etc/nginx/.htpasswd;
    
    proxy_pass http://localhost:3001;
    # ... 以下同じ
}
```

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### Option B: 秘密URL

URLパスを推測しにくいものに変更：

```nginx
location /tax-secret-abc123xyz {
    proxy_pass http://localhost:3001;
    # ...
}
```

アクセスURL: `https://fashionhoteljoy.com/tax-secret-abc123xyz`

### Option C: IPアクセス制限

特定のIPからのみアクセス許可：

```nginx
location /tax {
    allow 123.456.789.0;    # あなたの自宅IP
    deny all;
    
    proxy_pass http://localhost:3001;
    # ...
}
```

---

## ✅ Step 6: 動作確認

### 6-1. ブラウザでアクセス

```
https://fashionhoteljoy.com/tax
```

### 6-2. 確認項目

- [ ] ページが表示される
- [ ] 収入・経費入力ができる
- [ ] データが保存される（DB確認）
- [ ] 集計が正しく表示される
- [ ] レシートアップロードができる
- [ ] AI用フォーマットがコピーできる

### 6-3. データベース確認

```bash
cd /var/www/tax-tool
sqlite3 data/database.sqlite

# SQLiteコマンド
.tables          # テーブル一覧
SELECT * FROM expenses LIMIT 5;  # データ確認
.exit
```

---

## 💾 Step 7: 自動バックアップ設定

### 7-1. バックアップスクリプト作成

```bash
nano /var/www/tax-tool/backup.sh
```

```bash
#!/bin/bash
DATE=$(date +%Y%m%d)
cp /var/www/tax-tool/data/database.sqlite \
   /var/www/tax-tool/data/backups/backup_${DATE}.sqlite
```

```bash
chmod +x /var/www/tax-tool/backup.sh
```

### 7-2. Cron設定（週1自動バックアップ）

```bash
crontab -e
```

以下を追加：
```
# 毎週日曜 午前3時にバックアップ
0 3 * * 0 /var/www/tax-tool/backup.sh
```

---

## 🔄 Step 8: 更新・メンテナンス

### コード更新時

```bash
# ローカルで修正 → Git push
git add .
git commit -m "機能追加"
git push origin main

# サーバー側で pull
ssh user@fashionhoteljoy.com
cd /var/www/tax-tool
git pull origin main

# アプリ再起動
pm2 restart tax-tool
```

### データベースバックアップ（手動）

```bash
cd /var/www/tax-tool
./backup.sh
```

### ログ確認

```bash
# PM2ログ
pm2 logs tax-tool

# Nginxログ
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

---

## 🚨 トラブルシューティング

### 問題: `https://fashionhoteljoy.com/tax` にアクセスできない

**原因1:** PM2が起動していない

```bash
pm2 list
pm2 start server.js --name tax-tool
```

**原因2:** Nginx設定エラー

```bash
sudo nginx -t
sudo systemctl reload nginx
```

**原因3:** ファイアウォール

```bash
sudo ufw status
sudo ufw allow 3001/tcp
```

### 問題: データが保存されない

**原因:** ディレクトリ権限

```bash
cd /var/www/tax-tool
ls -la data/
chmod 755 data
chown -R $USER:$USER data/
```

### 問題: レシートアップロードができない

**原因:** uploadsディレクトリの権限

```bash
chmod 755 uploads
chown -R $USER:$USER uploads/
```

### 問題: 502 Bad Gateway

**原因:** Node.jsアプリが起動していない

```bash
pm2 list
pm2 logs tax-tool
pm2 restart tax-tool
```

---

## 📊 パフォーマンス最適化（オプション）

### Gzip圧縮（Nginx）

```nginx
gzip on;
gzip_types text/css application/javascript application/json;
gzip_min_length 256;
```

### キャッシュ設定

```nginx
location /tax/uploads {
    alias /var/www/tax-tool/uploads;
    expires 7d;
    add_header Cache-Control "public, immutable";
}
```

---

## 🔒 セキュリティチェックリスト

- [ ] HTTP Basic認証が設定されている
- [ ] SQLiteファイルが外部からアクセスできない
- [ ] uploadsディレクトリが適切な権限
- [ ] 自動バックアップが動作している
- [ ] PM2が自動起動設定されている
- [ ] Nginxログローテーション設定済み

---

## 📞 サポート

### よく使うコマンド

```bash
# アプリ再起動
pm2 restart tax-tool

# ログ確認
pm2 logs tax-tool

# データベースバックアップ
./backup.sh

# Nginx設定テスト
sudo nginx -t

# Nginx再起動
sudo systemctl reload nginx
```

### 緊急時

```bash
# アプリ停止
pm2 stop tax-tool

# Nginx停止
sudo systemctl stop nginx
```

---

**作成日**: 2026年2月12日  
**対象環境**: Ubuntu 20.04/22.04, Node.js 18+, Nginx, PM2  
**所要時間**: 30分-1時間（初回デプロイ）
