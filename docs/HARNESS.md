# 制作・検証 Harness

Harnessは「毎回の制作で使うルール・入力形式・生成コマンド・検証・結果記録」の組み合わせです。HTMLプレイヤーを共通化し、講義ごとに台本・表示内容・音声・cueを差し替えます。

## 入口

| 区分 | ファイル | 役割 |
|---|---|---|
| ルール | AGENTS.md / CLAUDE.md | Codex・Claude Codeの作業ルール |
| ルール | docs/DESIGN.md | SAKUSURAビジネス標準のデザイン規格（構成・固定要素・文字・配色） |
| ルール | .claude/ | Claude Codeのスキル・保存時検査フック・権限 |
| 入力 | input/ | 元資料（PDF / Word / PowerPoint）を置く場所（`npm run inputs` で一覧、`npm run extract` で Word・PowerPoint の本文を抽出） |
| 入力 | templates/brief.md | 講義の依頼書 |
| 講義 | lectures/<slug>/lecture.json | 見出し・表示要素・台本・cue |
| 講義 | lectures/<slug>/images/ | Codexが生成した画像と依頼書 REQUEST.md（`npm run images`） |
| 講義 | lectures/<slug>/audio/ | 生成したWAVと生成条件 |
| 設定 | config/tts.json | モデル・clonevoice・話し方の既定値 |
| 実装 | src/ | プレイヤー（音声基準の同期・描画・デザインCSS） |
| 実装 | tools/ | 作成・TTS・画像依頼・検証・サーバーのコマンド |
| 検証 | tests/ | 回帰テスト |
| 出力 | reports/<slug>/ | 講義ごとの検証結果（harness.md・qa.json・browser-qa.json・slide-*.png）。再生成できるので消してよい |

ブラウザ検査・動画書き出し用の隔離Chromeプロファイルは、OSの一時フォルダー内の `html-slide-recording-harness/browser-profiles/` に作り、終了時に削除します。同期中のChromeのDBやロックによるエラーを避けるため、`reports/` には作りません。

## 制作の流れ

```powershell
# 0. 元資料（PDF / Word / PowerPoint）を input/ に置き、一覧を確認
npm run inputs

# 1. どのデザインで作るか・TTSのAPIキーが登録済みかをユーザーに確認
npm run designs
npm run tts:status   # 未登録なら登録を促す。登録しない場合は無音で作る（下の「無音で作る場合」）

# 2. 標準構成12枚（一文スライド2枚・フロー図1枚を含む）、合計予定600秒のひな形を、選ばれたデザインで新規作成
npm run new -- --name lesson-01 --title "講義タイトル" --number 01 --category <カテゴリ> --design sakusura-standard --rules sakusura --source input/資料.pdf

# 「LLMにおまかせ」（--design llm）の場合：lectures/lesson-01/theme.css に見た目を書いて取り込む。完成後、テンプレートとして保存するか確認
npm run theme -- --lecture lesson-01
npm run design:save -- --lecture lesson-01 --name "テンプレート名"

# 2. Orca内で画像Taskを作り、Codexに依頼してClaudeが完了を待つ
npm run images:task -- --lecture lesson-01
npm run images:task -- --lecture lesson-01 --wait
# 通知処理・担当の後処理・ack・--recordの詳細は docs/ORCA_IMAGES.md

# lecture.jsonを編集した後、生成予定だけを確認（API料金なし）
npm run tts -- --lecture lesson-01 --check

# 台本・モデル・声・話し方が変わったスライドだけ生成
npm run tts -- --lecture lesson-01

# 一枚だけの生成・再生成
npm run tts -- --lecture lesson-01 --slide 003

# 制作中の確認。音声不足は警告扱い
npm run harness -- --lecture lesson-01

# 収録前の確認。音声不足・総尺不一致はエラー扱い
npm run harness -- --lecture lesson-01 --production --browser
```

ひな形は台本が空欄です。空欄がある状態でTTSを実行すると、APIを呼び出す前に停止します。まず台本を記入してください。

### 無音で作る場合（TTSのAPIキーを登録しない人）

`npm run tts:status` が「未登録」で、ユーザーが登録しないときは無音で作ります。ナレーション原稿は音声付きと同じように全スライドに書きます（あとでキーを登録すれば、同じ原稿から音声を生成できます）。

```powershell
# 原稿の文字数（約5.1文字/秒）から各スライドの表示時間を決め、cue を同じ比率で合わせる（--check で確認だけ）
npm run timing -- --lecture lesson-01

# 収録前の確認。音声の未生成はエラーにせず、表示時間で総尺を測る
npm run harness -- --lecture lesson-01 --production --silent --browser

# 無音のMP4を書き出す（再生画面の「書き出し」→「無音で動画を書き出す」と同じ）
npm run render -- --lecture lesson-01 --silent
```

## 自動で確認するもの

- JavaScriptの構文、プレイヤー制御・巻き戻し・再生競合の回帰テスト。
- 必須項目・ID重複・cue順序・存在しない表示要素。
- 構成（合計12枚・一文スライド2枚・フロー図1枚以上・サムネイル#番号・アジェンダ・Take Home Message 4つ）と強調記法 `**` の対応。
- WAVの形式・完全性・実際の長さ・発話区間・ファイルハッシュ。
- 台本・モデル・声・話し方とキャッシュの一致。
- cueが音声終了前にあること、総尺が目標±15%であること。
- ブラウザの再生・停止・シーク・再開・自動送り・最終停止。
- 録画時の1920×1080・UI非表示、各スライドのはみ出し、画面PNG。
- デザイン規格：右上SAKUSURA・右下ページ番号・左下題名の位置、見出し40px・本文28px、グレー以外の文字色がないこと。

ブラウザ検査は音声が揃っていれば実WAVを再生し、揃っていなければ無音リハーサルとして確認します。previewのPASSは収録準備完了を意味しません。`production` と音声準備数を確認してください。

## 人が確認するもの

音声の誤読・声の似方・自然さ・音質、図解の説明としての正しさ、発話とcueの意味の一致、書き出した動画（`exports/<slug>_番号.mp4`）またはOBSに保存された音声と画質は人が確認します。自動QAのPASSと分けて報告します。

## 失敗したとき

| 状況 | 対応 |
|---|---|
| HTTP 401 / 403 | 環境変数または.envのキーとAPIプロジェクトの権限を確認 |
| HTTP 404 | モデルとカスタムボイスの提供・登録状況を確認 |
| HTTP 429 | 利用枠を確認してから、時間を空けて変更分だけ再実行 |
| ボイスが見つからない | `npm run voices`。IDを別の話者へ勝手に置換しない |
| 台本変更済み | TTSを再生成し、cueも確認 |
| 総尺が目標から外れる | 説明の分量を調整して該当スライドだけ再生成 |
| cueが音声より長い | 試聴してcueを移動。音声の速度変更で無理に合わせない |
| 二重起動ロックが残る | TTSプロセスが停止済みと確認してから該当講義のaudio/.tts.lockを削除 |

生成スクリプトは失敗時に自動課金再試行をしません。完了したスライドはキャッシュに残り、再実行で続きから進みます。
