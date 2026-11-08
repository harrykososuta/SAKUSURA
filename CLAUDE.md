# Claude Code用エントリーポイント

共通の制作・検証ルールは [AGENTS.md](AGENTS.md) にあります。作業前に読み、同じHarnessを使ってください。

- 詳細な制作ループ: [docs/HARNESS.md](docs/HARNESS.md)
- 起動と操作: [README.md](README.md)
- 標準TTS: Gemini 3.8 Flash-Lite TTS / **clonevoice（Voice clone）**
- デザイン規格: [docs/DESIGN.md](docs/DESIGN.md)（見本: `tests/fixtures/lectures/business-design`）
- **スライド作成の依頼では、着手前に必ず「どのデザインで作るか」をユーザーに聞く**（AskUserQuestion。一覧は `npm run designs`、記録は `npm run new -- ... --design <id>`）。選択肢には「LLMにおまかせ」（`--design llm`。theme.css を書いて `npm run theme` で取り込み、完成後に `npm run design:save` でテンプレート保存するか質問）を含め、SAKUSURAの構成ルールを守るか（`--rules sakusura|free`）も毎回聞く。合うデザインがなければ作成を促して代替案を示す。詳細は AGENTS.md「デザインの確認」。
- **TTSのAPIキー**（`npm run tts:status`）が未登録なら登録を促し、登録しない場合は無音で作る（原稿は通常どおり書く → `npm run timing` → `--silent` で検証・書き出し）。詳細は AGENTS.md「ナレーション音声（TTS）の確認」。
- 完了前の検証: `npm run harness -- --lecture <slug> --production --browser`
- 画像の自動依頼・完了待ち: [docs/ORCA_IMAGES.md](docs/ORCA_IMAGES.md)。`npm run images:task -- --lecture <slug>` でOrca内のTaskとCodex担当を起動し、`--wait` で完了を待つ。同じClaudeが通知を処理して制作を続行する。

## Claude Code の設定（.claude/）

- 元資料：`input/` にPDF / Word / PowerPoint を置く → 全ページ読んで作成（Word・PowerPointは `npm run extract`）。画像が必要な箇所は `npm run images` でCodex向けの依頼書を出す（自分では生成しない）。
- スキル `sakusura-html-deck`：このフォルダーでのスライド制作手順。PPTX用の `sakusura-word-slides` より優先します。
- フック：`lecture.json` を Edit/Write するたびに `tools/hooks/check-lecture.mjs` が構成・cueを検査します。エラーが返ったらその場で直します。スライド・講義・資料の作成依頼を受けると `tools/hooks/design-reminder.mjs` がデザインの確認ルール・一覧とTTSのAPIキーの登録状況を伝えます。
- 権限：検証・ひな形作成・`tts --check` は確認なしで実行できます。実際のTTS生成（課金）は毎回確認します。`.env` は読みません。
