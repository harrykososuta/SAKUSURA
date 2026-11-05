---
name: sakusura-html-deck
description: このフォルダー（SAKUSURA）でHTMLスライドの講義・ビジネスプレゼンを作る・直すときに使う。SAKUSURAビジネス標準（合計12枚／1枚目サムネイル#演題番号／2枚目アジェンダ／一文だけのスライド2枚／図解はフロー図／PDF・Word・PowerPointは input/ から読み取り／画像はCodexへ依頼書／最終枚Take Home Message 4つ／右上SAKUSURA・右下ページ番号・左下表題／見出し40px・本文28px・グレー2階調）で lecture.json を書き、TTS・Harness検証まで進める。「スライドを作って」「講義を作って」「プレゼン資料」「演題番号◯◯」などの依頼で、このフォルダーが作業場所なら sakusura-word-slides（PPTX）より優先する。
---

# SAKUSURA HTMLデッキ制作

正本は `AGENTS.md`（制作ループ）と `docs/DESIGN.md`（デザイン規格）。最初に両方を読む。

## 0. 元資料を読む
- `npm run inputs` で `input/` のPDF / Word / PowerPoint を確認（未作成のもの。複数なら最新、迷えば確認）。
- PDFは Read で**全ページ**読む（10ページ超は pages を分けて）。Wordは `npm run extract -- "input/<ファイル名>.docx" --out <scratchpad>/source.md` で抽出して全文読む。
- PowerPoint（.pptx）は `npm run extract -- "input/<ファイル名>.pptx" --out <scratchpad>/source.md --media <scratchpad>/media` で抽出して全文読む。表・グラフの数値・SmartArt・**発表者ノート**（台本の材料）も出る。見出しの「（推定）」は文字の大きさからの推定なので、内容で確かめる。図や写真の意味は `--media` に保存された画像を Read で見て把握する（スライドへの流用はしない。必要な画像はこれまでどおりCodexへ依頼）。元の配置・色は使わず、標準の12枚とカテゴリの配色で作り直す。
- 表・図の数値も控え、資料内の矛盾や不明点は報告用にメモ。
- 作成する講義の `lecture.json` に `"source": "input/<ファイル名>.pdf"` を入れる（`npm run new -- ... --design <id> --rules sakusura --source input/<ファイル名>.pdf`）。

## 1. 構成を決める
- **最初にデザインを聞く（必須）**：`npm run designs` で一覧を出し、AskUserQuestion で「どのデザインで作るか」を質問する（依頼文でデザインが明示されたときだけ省略）。標準以外が選ばれたら、表示・動画はまだ標準デザインのままであることを伝える。選択肢には「LLMにおまかせ」（id: llm）を必ず入れ、同じ質問で「SAKUSURAの構成ルールを守るか（`--rules sakusura` / `--rules free`）」も聞く。選んだ id は `npm run new` の `--design` に渡す。LLMにおまかせは `lectures/<slug>/theme.css` に見た目を書いて `npm run theme -- --lecture <slug>` で取り込み（AGENTS.md「LLMにおまかせのデザイン」）、完成後に「テンプレートとして保存するか」を聞いて `npm run design:save -- --lecture <slug> --name "名前"`。合うデザインがなければデザインを作るよう促し、代替案（標準を複製して調整／PDFから取り込む／AIに調整を依頼／今回は標準で作る）を示す。
- **TTSのAPIキーを確認する**：`npm run tts:status` で登録状況を見る。未登録なら登録手順を示して「登録してから音声付きで作る」か「無音で作る」かを同じ質問で聞く。登録しない・返事がない場合は無音で作る（ナレーション原稿は同じように書く。`npm run tts` は使わず、`npm run timing -- --lecture <slug>` で表示時間を合わせ、Harness と書き出しに `--silent` を付ける）。
- 依頼からテーマ・対象者・ゴール・演題番号・題名・**カテゴリ**を確定。不明な演題番号は既存講義の次の番号を提案。
- カテゴリは `designs/category-presets.json` の一覧から選ぶ（デザイン画面の「カテゴリごとのデザイン設定」で追加・削除。`npm run new` が一覧を表示する。一覧が空なら `--category` を付けない）。同じシリーズの既存講義と同じにする。内容から明らかでなければ確認する。
- 構成は固定で**合計12枚**：1 サムネイル（title）/ 2 アジェンダ（agenda）/ 3〜11 本編 / 12 Take Home Message（takehome・4つ）。
- 本編の見出しは**結論の文**（全角30字以内）。1枚1メッセージ。本編のうち**2枚は一文だけのスライド（message）**を要所（導入・山場・結論の直前）に置く。連続させず、blocks は空、一文は全角30字以内で `\n` で意味の切れ目に改行。
- 図解は**フロー図（flow）**。手順・因果・プロセスは箱と矢印で示す（本編に1枚以上）。
- 画像があると伝わる箇所（表紙、場面や人物を伝える要点）だけ `image` に alt と prompt を書く。手順・因果の図解は画像にしない。
- 歴史上の人物が登場する講義では、一文スライド（message）の右側に人物紹介 `people` を置ける（5人まで。`{ id, name, text, image: { alt, prompt } }`、text は2行まで、cue不要）。似顔絵は600×600の正方形で、円形に切り抜いて表示する。実在の人物の似顔絵は共通スタイルの例外なので、**描くかどうかを毎回ユーザーに確認**してから依頼する。
- **解剖・構造（血管の走行、断面など）は `figure` ＋模式図**にする。`prompt` には向き（どちら側から見るか、画像の上下左右が体のどこか）・各構造の走行と分岐/合流の位置・色の意味・描かないものを、番号付きで細かく書く。`labels` に図へ重ねる名称（9個まで）、`checklist` に解剖学的な確認項目を書く。同じ部位の図は構図・縮尺をそろえるよう指示する。
- 生成済み画像への直し（「中膜が広すぎる」など）は自分で画像を加工せず、`image.revision` に直す点を書き、prompt・checklist も合わせて直して `npm run images` で依頼書を出し直す。確認後に `revision` を外す。
- **動き多め（`motion: "rich"`。AI Topic カテゴリ `ai` も同じ扱い）は動きで見せる**：仕組み・処理の流れは `flow`（矢印が伸び、光の点が流れる）、AIとのやりとりは `chat`（AIが1文字ずつ答える）、資料にある数値の比較は `bars`（棒が伸び、数字が数え上がる）。本編に chat か bars を1〜2枚入れ、YouTubeで見て「動きで分かる」構成にする。歴史は `timeline`、繰り返す仕組み（イベントループ等）は `cycle`、構成図は `stack`、コードの説明は `code`（打ち込み→実行結果）を使う。AI Topic は全スライドに登場の動きが付き、1枚の情報量を増やしてよい（本文6つ・表6行・フロー図5つまで）。図解は「何が・どの順で・どうつながるか」まで具体的に書き、箱の言葉を短くする代わりに detail や note で補う。詳しくは docs/DESIGN.md「アニメーション」、見本は `lectures/ai-motion-demo`。
- **AI Topic はアイコンと画像を多用する**（ユーザー指定：「単なるフロー図だけだとわかりにくい」）。図解の各ブロック（flow・table・timeline・cycle・stack・steps・compare・agenda・takehome・bars・statement）に `blocks[].icon`（`src/icons.js` の線画アイコン名）を付ける。さらに1講義につき2〜3枚のスライドで Codex の画像を使う（たとえ・場面が伝わる flow の段階の絵 `blocks[].image`＋`imageSeries`、compare の左右の絵、statement の右の画像）。表紙の画像だけで終わらせない。
- 資料にない数値・事実は作らない。不明は `[要確認]`。

## 2. lecture.json を書く
```powershell
npm run new -- --name <slug> --title "題名" --number <演題番号> [--category <カテゴリ>] [--motion rich] --design <ユーザーが選んだid> --rules <sakusura|free>   # 12枚固定。5・9枚目が一文スライドの仮置き（位置は要所へ移してよい）
```
- layout は title / agenda / statement / flow / steps / compare / table / chat / bars / code / timeline / cycle / stack / message / takehome。12枚固定で6枚目が flow の仮置き。
- 項目×観点で比べる内容（消毒薬の比較など）は表（table：`columns` と各行の `label`・`text`・`cells`、5行まで）にする。スライドの結論を言い切りたいときは本文の下にまとめの一文 `note`（cue の target は "note"）を置ける。どちらも多用しない。
- 重要語は `**語**`（濃いグレー太字）。1行に1か所まで。文字色・文字サイズはCSSで固定なので指定しない。
- compare の中央の丸矢印は変化（Before→After）のときだけ `"transition": true`。並べて比べるだけなら付けない。
- 本編のブロックは4つまで（bars は6行まで。AI Topic は本文6つ・表6行・フロー図5つまで。code 3・timeline 7・cycle 6・stack 8 まで）、アジェンダは6つまで。
- chat は `role`（user / ai）付きの吹き出し2〜4つ。答えは3行程度に収める。bars は各行に `label`・`value`（・`unit`・強調は `highlight`）。動きは cue の時刻から始まり音声の終わりまでに終える必要があるので、AIの答え・棒グラフの cue は話し始めに合わせ、最後の cue を音声の終わり間際に置かない（`npm run check` が警告）。カードは使わない（罫線と余白で整理済み）。
- 編集のたびに PostToolUse フック（`tools/hooks/check-lecture.mjs`）が構成・cueを検査する。エラーが出たらその場で直す。

## 3. 画像の依頼（Codex）
```powershell
npm run images:task -- --lecture <slug> --check  # 依頼対象を確認
npm run images:task -- --lecture <slug>          # REQUEST.md・Orca Task・Codex担当を作成
npm run images:task -- --lecture <slug> --wait   # 完了または質問を最大55秒待つ
```
- 画像生成はCodexへ任せ、Claudeは進行役を続ける。[docs/ORCA_IMAGES.md](../../../docs/ORCA_IMAGES.md) を読んで、依頼対象の報告、Orca完了通知の待機・全件処理、worker-release、Deliveryのack、`--record` まで行ってから制作を再開する。時間切れでターンを終了したり同じ担当を再起動したりしない。入力待ちへの通知だけに頼らず、Claude自身が待機ループを回す。
- `--wait` は、Codexが依頼文を送信しないまま止まっていれば、Enterを1回だけ自動で送る（結果の `nudged`）。自動送信の後も止まっている場合は、画面を読んで確かめる。
- **待ち時間を使う**：画像の依頼を出す前に、台本を確定し、`npm run tts -- --lecture <slug> --check` の枚数・文字数を伝えてTTS生成の了承を得ておく。依頼を出したら、待機の合間にTTSを生成する（音声は lecture.json を変えない）。cue合わせなど lecture.json の変更は `--record` の後に行う（依頼中に変えると記録の照合に失敗する）。

## 4. 検証
```powershell
npm run harness -- --lecture <slug> --browser            # 制作中（音声なしは無音リハーサル）
npm run tts -- --lecture <slug> --check                  # 生成前に枚数・文字数をユーザーへ伝える
npm run harness -- --lecture <slug> --production --browser  # 完成前（必須）
```
- `reports/<slug>/slide-*.png` を全枚 Read で目視：はみ出し・語の途中の改行（`\n` で調整）・強調の多すぎ・下半分の空きすぎ。
- あわせて docs/DESIGN.md「全面の使い方・間隔・文字の大きさ」を全枚で確認する：下端や真ん中の空き、並列項目の行の高さと開始位置の不揃い、キャラクターだけの行、文字サイズの下限（本文・表27px）、同じ部品の大きさの違い、1〜2文字だけの行。ユーザーに見せる前に直す。
- ブラウザ検査はデザイン規格（固定要素の位置・40px/28px・グレー以外の文字色）も自動で確認する。

## 5. 報告
- **追加した図形・文字の確認**：Harness の出力（と `reports/<slug>/harness.md`）に「追加した図形・文字の確認」があれば、完了報告で一覧を示して「読ませたいものはありますか？」と確認する。読ませる依頼が来たら、そのスライドの原稿の最後に言葉を足し → `npm run tts -- --lecture <slug> --check` で1枚分の枚数・文字数を伝えて了承を得てから生成 → そのスライドの cue を試聴で見直す。
- 編集画面で足した `shapes`（図形・文字）は、lecture.json を直すときも消さず、cue も残す。
作成場所、起動方法（`npm start` → http://127.0.0.1:4173/?lecture=<slug>）、使用した声、実行済み検証、未実施（TTS未生成・試聴・動画の視聴確認）を分けて伝える。
- 動画化を頼まれたら `npm run render -- --lecture <slug>`（本番検証が通った後）。出力は `exports/<slug>_番号.mp4`（毎回番号を増やして残す。最新は最大番号）。ユーザー自身は再生画面の「動画を書き出す」ボタンでも同じ書き出しができる。
