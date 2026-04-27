# 面接分析AIアシスタント

Gemini API を活用した面接分析 Web アプリ。音声 / テキストから文字起こし・Q&A 抽出・多軸フィードバックを生成し、結果を保存・エクスポートできます。

## ✨ 機能

- 🎤 **音声ファイル文字起こし** — Gemini が音声を直接解析
- 📝 **テキスト直接入力** — 文字起こし済みテキストの貼り付けに対応
- 💬 **Q&A 自動抽出** — 質問・回答ペアをカテゴリ分類して整理
- 📊 **5 軸 AI フィードバック** — 応答速度・適切性・一貫性・論理性・総合
- 💾 **アプリ内保存** — ブラウザストレージに履歴を保存
- 📤 **多形式エクスポート** — PDF / TXT / JSON

## 🚀 セットアップ

```bash
# 依存パッケージをインストール
npm install

# 開発サーバ起動
npm run dev

# ビルド
npm run build
```

## 🔑 Gemini API キーの取得

1. [Google AI Studio](https://aistudio.google.com/apikey) にアクセス
2. 「Get API Key」→「Create API key」
3. アプリ起動後、右上の歯車 ⚙ から API キーを設定

## 🛠 技術スタック

- React 18 + Vite
- Tailwind CSS（インラインスタイル併用）
- Recharts（レーダーチャート）
- Lucide React（アイコン）
- Gemini API (`gemini-2.5-flash` 推奨)

## 📁 プロジェクト構成

```
interview-analyzer/
├── src/
│   ├── App.jsx              # メインアプリ
│   ├── main.jsx             # エントリポイント
│   └── index.css            # Tailwind ベース
├── index.html
├── package.json
├── vite.config.js
└── README.md
```

## 🔒 プライバシー

- API キーはブラウザの localStorage にのみ保存
- 音声・テキストデータは Gemini API 以外には送信されません
- 分析結果はすべてローカルで保管

## 📜 ライセンス

MIT
