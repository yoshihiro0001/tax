# フェーズ別実装計画書

この計画は、**抜けなく・シンプルに**個人用経費管理ツールを構築するためのロードマップです。

---

## 🎯 全体コンセプト

- **ターゲット**: あなた1人用（義大専用）
- **セキュリティ**: 最低限（パスワード or 秘密URL）
- **技術**: シンプル最優先 → HTML + CSS + Vanilla JS + Node.js/Express
- **AI連携**: データをコピペしやすいテキスト/JSON形式で出力
- **自動化**: レシートOCR、クレカCSVパース
- **UI原則**: 1画面完結、ボタンは3つだけ

---

## 📋 Phase 1: 要件定義（1-2日）

### 必須機能リスト（10項目）

| No. | 機能 | 説明 |
|-----|------|------|
| 1 | **収入入力** | 日付・金額・種類（振込/現金/その他）・摘要 |
| 2 | **経費入力** | 日付・金額・勘定科目・摘要・レシート画像添付 |
| 3 | **レシート写メ自動入力** | カメラ起動 → OCR → 日付/金額/店舗推定 → 科目提案 |
| 4 | **クレカ明細CSV取込** | CSVアップロード → パース → 自動経費候補生成 |
| 5 | **データ保存** | SQLite or JSONファイル |
| 6 | **自動集計** | 月別/年別/科目別（収入合計、経費合計、粗利益、主要経費内訳） |
| 7 | **青色申告用勘定科目** | ドロップダウン（10科目固定） |
| 8 | **AI相談用フォーマット出力** | コピペ1発で済むテキスト/JSON |
| 9 | **検索/編集/削除** | 一覧からタップで編集 |
| 10 | **バックアップ** | JSONエクスポート |

### 勘定科目（10種固定）

| No. | 科目名 | 用途 |
|-----|--------|------|
| 1 | 外注工賃 | 甥っ子報酬など |
| 2 | 旅費交通費 | ホテル調査移動費 |
| 3 | 通信費 | スマホ・ネット代 |
| 4 | 消耗品費 | PC周辺・文具 |
| 5 | 広告宣伝費 | ツール・サービス代 |
| 6 | 接待交際費 | 打ち合わせ飲食 |
| 7 | 減価償却費 | PC等（2年前購入） |
| 8 | 家事按分 | 家賃・光熱費一部 |
| 9 | 支払手数料 | 振込手数料等 |
| 10 | 雑費 | その他（新しい科目はここに） |

### AI用出力フォーマット例

```
【2025年分 データまとめ】

期間: 2025/01/01 - 2025/12/31
総収入: 4,620,000円
総経費: 1,800,000円

内訳:
- 外注工賃: 900,000円
- 旅費交通費: 300,000円
- 通信費: 120,000円
- 消耗品費: 80,000円
- 広告宣伝費: 150,000円
- 接待交際費: 50,000円
- 減価償却費: 100,000円
- 家事按分: 80,000円
- 支払手数料: 10,000円
- 雑費: 10,000円

青色特別控除: 650,000円想定
課税所得目安: 2,170,000円

コメント/質問: [ここに自由記述]
```

---

## 🎨 Phase 2: 設計・UI/UX設計（1-3日）

### 画面構成（1画面主義）

```
┌───────────────────────────────┐
│  💰 経費管理ツール            │
├───────────────────────────────┤
│  [+収入]  [+経費]  ← 大ボタン │
├───────────────────────────────┤
│  日付: [2025-02-12]  ← 今日  │
│  金額: [        円]           │
│  科目: [▼外注工賃]  ← 10種   │
│  摘要: [          ]           │
│  📷 [レシート]  ← カメラ起動  │
├───────────────────────────────┤
│  [保存] [集計] [AI出力]       │
└───────────────────────────────┘
```

### スマホ最適化

- **レスポンシブ**: Tailwind CSS or Pico CSS
- **縦長1カラム**: スクロール最小限
- **大きなボタン**: タッチフレンドリー（min-height: 48px）
- **数値キーボード**: `<input type="number">`
- **PWA対応**: manifest + service worker でホーム画面追加可能

### 画面フロー

```
[起動]
  ↓
[トップ: +収入 / +経費 ボタン]
  ↓
[入力フォーム表示]
  ↓
[保存ボタン]
  ↓
[保存完了 → フォームリセット]
  ↓
[集計ボタン → グラフ・表表示]
  ↓
[AI出力ボタン → テキストコピー]
```

---

## 🔧 Phase 3: 技術選定・実装計画

### 技術スタック

| 項目 | 選択 | 理由 | 代替 |
|------|------|------|------|
| **Frontend** | HTML + Vanilla JS | ビルド不要、依存ゼロ | SvelteKit |
| **CSS** | Tailwind CDN or Pico CSS | 軽量、レスポンシブ | - |
| **Backend** | Node.js + Express | サーバーにあるはず | Python/Flask |
| **DB** | SQLite | ファイル1つ、簡単 | JSONファイル |
| **OCR** | Tesseract.js or Google Vision API | ブラウザ完結 or 無料枠 | Clova OCR |
| **CSV Parse** | PapaParse | 軽量 | - |
| **グラフ** | Chart.js | 軽量、見た目良い | - |
| **認証** | HTTP Basic Auth | 個人用最小限 | なし |

### 実装順序（最短パス）

| Day | タスク | 成果物 |
|-----|--------|--------|
| 1-2 | 基本HTMLフォーム + localStorage保存テスト | 入力→保存動作確認 |
| 3-4 | バックエンドAPI（POST /income, /expense）+ SQLite | DB保存成功 |
| 5-6 | 集計API + フロント表示 | 科目別・月別集計表示 |
| 7-8 | レシートアップロード + OCR統合 | 写メ→自動入力 |
| 9-10 | CSVアップロード + パース | クレカ明細取込 |
| 11-12 | AI用フォーマット生成ページ | コピペ用テキスト出力 |
| 13-14 | PWA化 + スタイリング仕上げ | ホーム画面追加可能 |

---

## 💻 Phase 4: 実装・テスト（1-2週間）

### Day 1-2: 基本フォーム + localStorage

**目標:** 入力→保存→表示の基本動作

```javascript
// localStorage に保存テスト
const data = {
  income: [],
  expenses: []
};

function saveExpense(date, amount, category, description) {
  data.expenses.push({ date, amount, category, description });
  localStorage.setItem('taxData', JSON.stringify(data));
}
```

### Day 3-4: バックエンド + SQLite連携

**目標:** 本番用DB保存

```bash
npm install express sqlite3
node server.js
```

テスト:
```bash
curl -X POST http://localhost:3001/api/expense \
  -H "Content-Type: application/json" \
  -d '{"date":"2025-02-12","amount":5000,"category":"travel","description":"タクシー"}'
```

### Day 5-6: 集計API

**目標:** 年別・科目別集計

エンドポイント:
```
GET /api/summary/2025
```

レスポンス:
```json
{
  "year": "2025",
  "income": 4620000,
  "expenses": 1800000,
  "breakdown": [
    {"category": "outsourcing", "total": 900000},
    {"category": "travel", "total": 300000}
  ]
}
```

### Day 7-8: レシートOCR

**選択肢:**

**Option A: Tesseract.js（ブラウザ完結）**

```html
<script src='https://unpkg.com/tesseract.js@v4.0.0/dist/tesseract.min.js'></script>
```

```javascript
Tesseract.recognize(imageFile, 'jpn')
  .then(({ data: { text } }) => {
    console.log(text);
    // 正規表現で日付・金額・店舗名を抽出
  });
```

**Option B: Google Cloud Vision API**

```javascript
fetch('https://vision.googleapis.com/v1/images:annotate?key=YOUR_API_KEY', {
  method: 'POST',
  body: JSON.stringify({
    requests: [{
      image: { content: base64Image },
      features: [{ type: 'TEXT_DETECTION' }]
    }]
  })
});
```

### Day 9-10: CSVアップロード

```javascript
const Papa = require('papaparse');

Papa.parse(csvFile, {
  header: true,
  complete: (results) => {
    results.data.forEach(row => {
      // 日付・金額・摘要を抽出
      saveExpense(row['利用日'], row['金額'], 'misc', row['利用店舗']);
    });
  }
});
```

### Day 11-12: AI用フォーマット出力

```javascript
app.get('/api/ai-format/:year', (req, res) => {
  // 集計データを取得
  // テキスト形式に整形
  res.json({ text: formattedText });
});
```

フロント:
```javascript
fetch('/api/ai-format/2025')
  .then(r => r.json())
  .then(data => {
    navigator.clipboard.writeText(data.text);
    alert('クリップボードにコピーしました！');
  });
```

### Day 13-14: PWA化 + デザイン

- manifest.json 作成
- service worker 追加（オフライン対応）
- CSS仕上げ（Tailwind or Pico）

---

## 🧪 Phase 5: 運用・メンテナンス

### バックアップルーティン

**週1でJSONエクスポート**

```bash
# cronで毎週日曜3時に実行
0 3 * * 0 curl http://localhost:3001/api/export > /var/www/tax-tool/data/backups/backup_$(date +\%Y\%m\%d).json
```

### 更新方針

- **新科目が必要**: コード修正だけ（categories配列に追加）
- **新機能追加**: 最小限のみ（ボタンを増やさない）

### 拡張アイデア（後で）

- Gemini API連携で自動科目提案強化
- 領収書PDF保存機能
- 月次レポートPDF出力
- Googleスプレッドシート連携

---

## ✅ チェックリスト

### 開発完了の基準

- [ ] 収入・経費の入力ができる
- [ ] データがSQLiteに保存される
- [ ] 年別・科目別集計が表示される
- [ ] レシート写真から自動入力できる
- [ ] CSVアップロードで一括取込できる
- [ ] AI用フォーマットがコピーできる
- [ ] スマホで快適に操作できる
- [ ] PWAとしてホーム画面に追加できる
- [ ] バックアップが取れる

### デプロイ完了の基準

- [ ] 本番サーバーで動作する
- [ ] `https://fashionhoteljoy.com/tax` でアクセスできる
- [ ] 認証が設定されている
- [ ] 自動バックアップが設定されている

---

## 📊 タイムライン概要

```
Week 1: Phase 1-3 (要件定義・設計・技術選定)
Week 2: Phase 4 前半 (基本実装・DB連携・集計)
Week 3: Phase 4 後半 (OCR・CSV・AI出力)
Week 4: Phase 4 完成 (PWA・デザイン・テスト)
Week 5: Phase 5 (デプロイ・運用開始)
```

---

**作成日**: 2026年2月12日  
**見積**: 1-2週間で実装完了（1日2-3時間作業想定）
