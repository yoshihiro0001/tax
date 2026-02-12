# 個人用経費管理・確定申告支援ツール 構築情報パッケージ

このフォルダには、シンプルな個人用経費管理・確定申告支援ツールを構築するために必要な全ての情報が含まれています。

## 📋 含まれるファイル

| ファイル名 | 内容 |
|----------|------|
| `SERVER_INFO.md` | サーバー・ドメイン・URL構成の情報 |
| `DATABASE_INFO.md` | データベース設定（SQLite/JSON） |
| `TECHNICAL_STACK.md` | 技術スタック・実装方法の詳細 |
| `PHASE_PLAN.md` | フェーズ別実装計画書 |
| `DEPLOYMENT_GUIDE.md` | デプロイ手順の詳細 |

## 🎯 プロジェクト概要

### サイト名
**個人用経費管理・確定申告支援ツール（義大専用）**

### 目的
- 収入・経費入力の簡素化
- レシート写真からの自動入力（OCR）
- クレカ明細CSV自動取込
- AI相談用フォーマット自動生成（Grok等に投げる用）
- 青色申告に必要な情報を1画面で完結

### URL構成
- **メインドメイン**: `fashionhoteljoy.com`
- **サブディレクトリ**: `/tax`
- **完全なURL**: `https://fashionhoteljoy.com/tax`
- **API URL**: `https://fashionhoteljoy.com/tax/api/*`（必要最小限）

### 技術スタック（シンプル最優先）
- **Frontend**: HTML + CSS (Tailwind/Pico) + Vanilla JavaScript
- **Backend**: Node.js + Express **または** Python + Flask
- **データベース**: SQLite（ファイル1つ）**または** JSONファイル
- **OCR**: Tesseract.js（ブラウザ）or Google Cloud Vision API無料枠
- **認証**: HTTP Basic Auth または秘密URL（個人用最小限）
- **PWA対応**: ホーム画面追加可能

### 設計コンセプト
- ✅ **1画面完結型**：入力から出力まで最小クリック
- ✅ **ボタンは3つだけ**：「保存」「集計表示」「AI用出力」
- ✅ **勘定科目10種固定**：青色申告に直結
- ✅ **スマホ最適化**：タッチフレンドリーな大きなボタン
- ✅ **余分な機能ゼロ**：必要最小限のみ実装

### 既存システムとの関係
- **既存サイト**: hotel_system（ホテル管理システム）
- **サーバー**: 同一サーバー上で動作（軽量なので影響最小）
- **ドメイン**: 同一ドメイン配下（`/tax`サブディレクトリ）
- **データベース**: 完全独立（SQLite or JSON）


## 🚀 クイックスタート（10分で始める）

### Option A: Node.js版（推奨）

```bash
# 1. プロジェクトフォルダ作成
mkdir tax-tool
cd tax-tool

# 2. package.json作成
npm init -y

# 3. 必要なパッケージをインストール
npm install express sqlite3 multer papaparse

# 4. index.html と server.js を作成（詳細はTECHNICAL_STACK.md参照）

# 5. 開発サーバー起動
node server.js
```

ブラウザで `http://localhost:3000` にアクセス

### Option B: Python版

```bash
# 1. プロジェクトフォルダ作成
mkdir tax-tool
cd tax-tool

# 2. 仮想環境作成
python3 -m venv venv
source venv/bin/activate

# 3. 必要なパッケージをインストール
pip install flask sqlite3

# 4. app.py と templates/index.html を作成

# 5. 開発サーバー起動
python app.py
```

ブラウザで `http://localhost:5000` にアクセス

## 📖 詳細情報

各ファイルを参照してください：

1. **サーバー情報**: `SERVER_INFO.md` - ドメイン・サブディレクトリ構成
2. **データベース設定**: `DATABASE_INFO.md` - SQLite/JSON設定
3. **技術スタック**: `TECHNICAL_STACK.md` - 実装方法・コード例
4. **フェーズ計画**: `PHASE_PLAN.md` - 実装の全体計画
5. **本番デプロイ**: `DEPLOYMENT_GUIDE.md` - デプロイ手順

## 🔒 セキュリティ注意事項

⚠️ **重要**: このフォルダには認証情報（パスワード、APIキー等）が含まれています。

- Gitリポジトリにコミットしないでください
- 外部に公開しないでください
- 開発者間で安全に共有してください（暗号化推奨）

## 💬 開発のポイント

- **シンプル第一**：複雑な機能は追加しない
- **1画面完結**：ページ遷移は最小限に
- **スマホ最適化**：縦長レイアウト、大きなボタン
- **データバックアップ**：週1でJSONエクスポート推奨

## 🎨 UI原則

```
[+収入] [+経費]  ← 大きなボタン2つ
┌─────────────────┐
│ 日付: [今日]    │
│ 金額: [     円] │
│ 科目: [▼]      │ ← 10種固定
│ 摘要: [      ]  │
│ 📷 [レシート]   │ ← カメラ起動
└─────────────────┘
   [保存] [集計] [AI出力]
```

---

**作成日**: 2026年2月12日  
**対象**: 個人用経費管理ツール開発者（義大専用）  
**バージョン**: 1.0
