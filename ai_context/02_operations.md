# 運用エージェント向け作業手順書

このファイルは、デプロイ・git操作・エラーチェック・軽微な修正を行うエージェント向けの手順書です。

**作業前に必ず以下を読むこと：**
- `/ai_context/00_constitution.md`（基本方針）
- `/ai_context/01_history.md`（変更履歴）
- **このファイル**（運用手順）

---

## 本番環境の構成（最重要）

```
本番サーバー: fashionhoteljoy.com
SSH接続:      ssh root@fashionhoteljoy.com
本番ディレクトリ: /var/www/tax       ← ★ここ以外にデプロイしてはならない
PM2プロセス名:    tax                ← ★この名前以外で操作してはならない
PM2プロセスID:    4
本番URL:       https://fashionhoteljoy.com/tax
ポート:         3001（内部）
DB:            /var/www/tax/data/database.sqlite
```

### 絶対に守ること

- デプロイ先は **`/var/www/tax`** のみ。`/var/www/tax-tool` 等に変更してはならない
- PM2のプロセス名は **`tax`**。`tax-tool` 等を新規作成してはならない
- `data/` ディレクトリはデプロイ対象外（rsync --exclude 'data'）。本番DBを上書きしてはならない

---

## 1. デプロイ手順

### 手順

```bash
cd /Users/kashiharayoshihiro/projects/tax
bash deploy.sh
```

### deploy.sh が行うこと

1. rsync でファイルアップロード（node_modules, data, .git は除外）
2. 本番で `npm install --production`
3. `pm2 restart tax`

### デプロイ後の必須検証（省略禁止）

デプロイ後、以下の**全て**を実行して結果を確認すること：

```bash
# ① 本番のコードが更新されたか確認（先頭行で判別）
ssh root@fashionhoteljoy.com "head -12 /var/www/tax/server.js"

# ② PM2が正常稼働しているか確認（status: online であること）
ssh root@fashionhoteljoy.com "pm2 list"

# ③ PM2のエラーログ確認（直近のエラーがないこと）
ssh root@fashionhoteljoy.com "pm2 logs tax --lines 10 --nostream"

# ④ HTTPレスポンス確認（200であること）
curl -s -o /dev/null -w "%{http_code}" https://fashionhoteljoy.com/tax/

# ⑤ キャッシュバスティングが効いているか確認
curl -s https://fashionhoteljoy.com/tax/ | grep -o 'app.js[^"]*'
```

上記①〜⑤の結果を**全て確認**してから「デプロイ完了」と報告すること。

---

## 2. Git操作

### コミット

```bash
cd /Users/kashiharayoshihiro/projects/tax

# 状態確認
git status
git diff

# ステージング（必要なファイルのみ）
git add <ファイル名>

# コミット（日本語・目的がわかるメッセージ）
git commit -m "$(cat <<'EOF'
種別: 変更の概要

- 変更内容1
- 変更内容2
EOF
)"
```

### プッシュ

```bash
git push origin main
```

### コミットメッセージの種別

- `Fix:` — バグ修正
- `Update:` — 既存機能の改善
- `Add:` — 新機能追加
- `Docs:` — ドキュメントのみ
- `Refactor:` — 動作を変えないコード整理

---

## 3. エラーチェック手順

### ローカルでのチェック（変更後に必ず実行）

```bash
cd /Users/kashiharayoshihiro/projects/tax

# 構文チェック
node --check server.js && echo "server.js OK"
node --check public/app.js && echo "app.js OK"

# 依存パッケージが読み込めるか
node -e "require('sharp'); require('archiver'); require('better-sqlite3'); console.log('ALL OK')"
```

### 本番でのエラーチェック

```bash
# PM2ステータス（online であること、restart数が急増していないこと）
ssh root@fashionhoteljoy.com "pm2 list"

# エラーログ確認
ssh root@fashionhoteljoy.com "pm2 logs tax --lines 30 --nostream"

# サーバー内でモジュール確認
ssh root@fashionhoteljoy.com "cd /var/www/tax && node -e \"require('sharp');require('archiver');console.log('OK')\""
```

---

## 4. キャッシュバスティング

ブラウザはCSS/JSをキャッシュする。フロントエンド（app.js, style.css）を変更した場合は、
`public/index.html` の以下を更新すること：

```html
<!-- 日付+連番で更新 例: 20260218b → 20260219a -->
<link rel="stylesheet" href="style.css?v=YYYYMMDD+連番">
<script src="app.js?v=YYYYMMDD+連番"></script>
```

**フロントを変更したのにキャッシュバスティングを更新しないと、ユーザーに変更が反映されない。**

---

## 5. 軽微な変更時の手順

### フロー

1. コード変更
2. ローカル構文チェック（`node --check`）
3. git add → commit → push
4. `bash deploy.sh`
5. デプロイ後検証（セクション1の①〜⑤）
6. `/ai_context/01_history.md` に追記

### history.md への記録（必須）

変更を行ったら**必ず** `/ai_context/01_history.md` に追記する。
記録がない作業は未完了とみなす。

```
【YYYY-MM-DD】

■種別
（機能追加 / 修正 / エラー対応 / UI変更 / 設計変更 / デプロイ）

■内容
何を変更したか

■理由
なぜ変更したか

■対象
対象ファイル

■結果
完了 / コミット: ハッシュ / デプロイ済み
```

---

## 6. やってはいけないこと

| 禁止事項 | 理由 |
|---|---|
| デプロイ先を `/var/www/tax` 以外にする | PM2が別ディレクトリを見ており反映されない |
| PM2に新しいプロセスを作成する | プロセス名 `tax` のみ使用 |
| `data/` ディレクトリをデプロイで上書きする | 本番DBが消える |
| フロント変更時にキャッシュバスティングを忘れる | ユーザーに反映されない |
| デプロイ後の検証を省略する | 反映されていない可能性に気づけない |
| `01_history.md` への記録を忘れる | 作業は未完了扱い |
| `deploy.sh` の `REMOTE_DIR` や PM2プロセス名を変更する | 全ての問題の原因になる |

---

## 7. トラブルシューティング

### PM2が errored になった場合

```bash
# エラー内容の確認
ssh root@fashionhoteljoy.com "pm2 logs tax --lines 50 --nostream"

# 多くの場合は require でモジュールが見つからないエラー
# → 本番で npm install を再実行
ssh root@fashionhoteljoy.com "cd /var/www/tax && npm install --production && pm2 restart tax"
```

### ブラウザでエラーが出る場合

1. ブラウザの開発者ツール → Console を確認
2. エラーメッセージをそのままコピーして報告
3. 多くの場合は API レスポンスの undefined アクセス → `|| 0`, `|| {}`, `?.` で防御

### レポート画面が真っ白になる場合

loadReport 関数内のプロパティアクセスが安全か確認。
`t.xxx.yyy` → `(t.xxx || {}).yyy` または `t.xxx?.yyy` に変更。

---

## 8. ファイル構成（参考）

```
/Users/kashiharayoshihiro/projects/tax/   ← ローカル
├── server.js          ← バックエンド全体（Express + SQLite）
├── public/
│   ├── index.html     ← SPA の HTML
│   ├── app.js         ← フロントエンド全体
│   ├── style.css      ← スタイル
│   └── manifest.json  ← PWA設定
├── deploy.sh          ← デプロイスクリプト
├── config.json        ← Google OAuth等の設定
├── ai_context/        ← AI向けコンテキスト
│   ├── 00_constitution.md
│   ├── 01_history.md
│   └── 02_operations.md（このファイル）
├── data/              ← SQLiteデータ（git管理外）
└── uploads/           ← レシート画像

/var/www/tax/                              ← 本番
├── （上記と同じ構成）
├── data/database.sqlite                   ← 本番DB（上書き禁止）
└── uploads/                               ← 本番レシート画像
```
