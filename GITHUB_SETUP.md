# GitHub Push & Claude Code 移行ガイド

## 📂 ファイル構成（手元での配置）

ダウンロードした全ファイルを以下のように配置してください：

```
interview-analyzer/
├── .gitignore
├── README.md
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── App.jsx          ← InterviewAnalyzer.jsx をリネーム
    └── main.jsx
```

> **注意**: `InterviewAnalyzer.jsx` を `src/App.jsx` という名前で配置してください。

---

## 🐙 GitHub Push 手順（PDF準拠）

### 手順 1: ローカル動作確認

```bash
cd interview-analyzer
npm install
npm run dev
```
ブラウザで `http://localhost:5173` が開けばOK。

### 手順 2: GitHub でプライベートリポジトリ作成（PDF p.3〜5）

1. **GitHub Dashboard** にアクセス
2. 画面左上「Top repositories」横の **緑色「New」ボタン** をクリック
3. **Repository name**: `interview-analyzer`（任意）
4. **Choose visibility**: 必ず **Private** を選択（⚠ Publicはコード全世界公開）
5. その他はデフォルトでOK → **Create repository** をクリック

### 手順 3: ローカルから push

リポジトリ作成画面に表示されるコマンドをコピーして実行：

```bash
cd interview-analyzer

# 初回のみ
git init
git add .
git commit -m "Initial commit: 面接分析アプリ"
git branch -M main

# GitHub のリポジトリURLに書き換える
git remote add origin https://github.com/<あなたのusername>/interview-analyzer.git

# push
git push -u origin main
```

### 手順 4: Private 確認（PDF p.7）

- リポジトリ画面でリポジトリ名横に **「Private」バッジ** が表示されていることを確認

### 手順 5: VEXUM-ai を Collaborator に招待（PDF p.6, 8）

1. リポジトリ画面の **Settings** タブをクリック
2. 左メニューの **Collaborators** をクリック
3. **Add people** ボタンをクリック
4. 検索ボックスに **`VEXUM-ai`** と入力
5. 候補から選択して **Add to repository** をクリック
6. VEXUM-ai 側で招待を承認すれば共同開発開始

---

## 🤖 Claude Code への移行

Claude Code はターミナルから AI に開発を任せられる Anthropic の CLI ツールです。

### インストール

```bash
# Node.js 18+ が必要
npm install -g @anthropic-ai/claude-code
```

### mukouyamasouta の GitHub リポジトリで起動

```bash
# 自分の手元に既にクローン済みなら
cd path/to/mukouyamasouta-repo
claude

# まだの場合
git clone https://github.com/mukouyamasouta/<repo-name>.git
cd <repo-name>
claude
```

`claude` を実行すると初回はAnthropicへのログインが求められます。

### このプロジェクトの続きを Claude Code で進める例

このアプリのリポジトリ内で `claude` を起動して以下のような依頼が可能：

```
このリポジトリの面接分析アプリに、面接の会話をリアルタイムで録音する機能を追加してください。
ブラウザの MediaRecorder API を使って、録音終了後に音声ファイルとして
Gemini API に送信し、文字起こしから分析まで一貫して動くようにしてください。
```

```
src/App.jsx の Q&A タブで、各質問に「もっと良い回答例」を再生成するボタンを追加してください。
個別の質問IDに対して Gemini API を呼び出すロジックを実装してください。
```

```
セッション履歴を比較するページを追加してください。
2つのセッションを選んで、スコアの推移をグラフで表示する機能です。
```

Claude Code は実際にファイルを編集・テスト・git commit まで実行できるため、
このアプリの拡張開発に最適です。

---

## ⚠️ 重要な注意

- **API キーをコミットしない**: `.gitignore` に `.env` を含めています
- **Private 設定の再確認**: PDF 5ページ目の警告通り、必ず Private で作成
- **VEXUM-ai 招待**: コード共有前に Collaborator として正式に招待

---

## 🆘 トラブルシューティング

| 症状 | 対応 |
|------|------|
| `npm install` でエラー | Node.js v18 以上を使用しているか確認 |
| 音声ファイルで失敗 | 20MB以下のMP3/WAVを使用。長い音声は Gemini File API が必要 |
| API キー接続失敗 | キー文字列の前後にスペースが入っていないか確認 |
| `git push` で reject | 既存リポジトリの場合 `git pull --rebase origin main` 実行後に再 push |
