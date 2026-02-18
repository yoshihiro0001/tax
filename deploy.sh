#!/bin/bash
# ============================================
# Keihi v2 デプロイスクリプト
# fashionhoteljoy.com/tax
# ============================================

set -e

# --- 設定 ---
SERVER="fashionhoteljoy.com"
USER="root"  # サーバーのSSHユーザー名（必要に応じて変更）
REMOTE_DIR="/var/www/tax"
SSH_TARGET="${USER}@${SERVER}"

echo ""
echo "🚀 Keihi v2 デプロイ開始"
echo "   → ${SSH_TARGET}:${REMOTE_DIR}"
echo ""

# 1. ファイルをアップロード
echo "📦 ファイルをアップロード中..."
rsync -avz --progress \
  --exclude 'node_modules' \
  --exclude 'data' \
  --exclude '.git' \
  --exclude '.DS_Store' \
  --exclude 'TAX_SITE_SETUP_PACKAGE' \
  ./ ${SSH_TARGET}:${REMOTE_DIR}/

# 2. リモートでセットアップ
echo ""
echo "⚙️  リモートセットアップ中..."
ssh ${SSH_TARGET} << 'REMOTE_SCRIPT'
  cd /var/www/tax

  # ディレクトリ作成
  mkdir -p data data/backups uploads

  # 依存パッケージインストール
  npm install --production

  # PM2で再起動（プロセス名: tax）
  if pm2 list | grep -q " tax "; then
    pm2 restart tax
    echo "✅ PM2再起動完了 (tax)"
  else
    pm2 start server.js --name tax
    pm2 save
    echo "✅ PM2初回起動完了"
  fi

  echo ""
  echo "📋 PM2ステータス:"
  pm2 list
REMOTE_SCRIPT

echo ""
echo "✅ デプロイ完了！"
echo "   → https://${SERVER}/tax"
echo ""
