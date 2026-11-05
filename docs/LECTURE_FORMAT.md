# 講義データの仕様

`lectures/<slug>/lecture.json` を編集します。内容はHTMLではなく文字列として表示するため、台本へHTMLタグを貼っても実行されません。

既存の単独HTMLスライドをそのままライブラリに登録する場合は、同フォルダーに `slides.html` と `html-deck.json`（`version: 1`, `format: "html"`, `title`, `description`, `category`, `slides`: 枚数）を置きます。ライブラリの題名・「再生」から開けます。HTML内の画像などは埋め込みにし、外部通信やスタジオ本体へのアクセスを許可しない独立した画面で表示します。共通エディター・挿入元の一覧には含まれません。

見た目を保って共通エディターで編集する取り込みは `lecture.json` の `layout: "document"` を使います。`document: {width:1280,height:720,tree}` に受動的な要素の構造だけを保存し、文字は `blocks[].text`、画像は `blocks[].image` に分けます。tree の `bind` は本文IDまたは `title`、`image` は画像ブロックIDです。元の装飾つき文字は `original` と `children` で保持し、編集した文字は新しい本文を安全なテキストとして表示します。スクリプト・イベント属性・外部URLは使えません。配置の移動量・幅・高さは通常と同じ1920×1080上のpxです。各画像を選択して差し替え・トリミングでき、本文・表のセル文字・原稿・cue・スライドの複製や挿入は通常の講義と同じ保存処理を使います。

`document.tree` の要素に `reveal: "本文ID"` を指定すると、その要素内の文字・画像を一つのブロックとして短く表示します。同じ要素内のすべての本文・画像のcue時刻をそろえ、`reveal` にはその要素内の本文または画像IDを指定します。入れ子・重複指定は不可。0秒は即時表示、以後は各cueから0.26秒で表示し、停止・巻き戻し・手動送り・書き出しで同じ再生時刻から復元します。個々の文字と画像は引き続き編集できます。

```json
{
  "version": 1,
  "title": "講義名",
  "description": "対象者と内容",
  "number": "01",
  "category": "va",
  "brand": "SAKUSURA",
  "targetSeconds": 600,
  "slides": [{
    "id": "001",
    "layout": "statement",
    "title": "スライドの見出し",
    "eyebrow": "章の名前",
    "narration": "読み上げる台本の全文です。",
    "plannedSeconds": 40,
    "gapAfter": 0.5,
    "blocks": [
      {"id": "main", "label": "要点", "text": "最初に表示する説明"},
      {"id": "detail", "label": "補足", "text": "途中で表示する説明"}
    ],
    "cues": [{"at": 0, "target": "main"}, {"at": 5.2, "target": "detail"}]
  }]
}
```

| フィールド | 意味 |
|---|---|
| number | 演題番号（数字）。サムネイルに `#01` の形で表示 |
| design | 作成時にユーザーが選んだデザイン。`sakusura-standard`（標準）・`llm`（LLMにおまかせ）・「デザイン」画面で保存した `design-<UUID>`（一覧は `npm run designs`）。`npm run new` の `--design` で記録する。見た目は `theme` で決まり、PDF原本・配色だけのプリセットの反映は未実装 |
| rules | SAKUSURAの構成ルールを守るか。`sakusura`（12枚・一文スライド2枚・Take Home Message 4つなどを検査）／`free`（枚数・構成も自由。構成の検査を外す）。`npm run new` の `--rules` で記録する |
| slidesEdited | 編集画面でスライドを挿入・削除・並べ替えした印（`true`。画面が自動で付ける）。枚数・並びは生成時のルールなので、付いた講義は合計12枚・一文スライド2枚・1枚目サムネイル・最終枚Take Home Message などを検査しない（演題番号・カテゴリ・強調記法・一文スライドの blocks は検査する）。Claudeは外さない |
| theme | 講義ごとのCSS `{ "css": "..." }`。「LLMにおまかせ」やCSSテンプレートの見た目。`lectures/<slug>/theme.css` を `npm run theme` で検査して取り込む。セレクターは `#stage` から、`@import`・外部 `url()`・スクリプトは不可、60000文字まで。あるときは見た目の規格検査（文字サイズ・色・書体・固定要素の位置）を外す |
| category | 動画のカテゴリ（シリーズ）のID。`designs/category-presets.json` の一覧から選ぶ（一覧が空なら書かない）。線と図形の配色とサムネイルのカテゴリ名が決まる（docs/DESIGN.md） |
| motion | 任意。`"rich"`（動き多め）：全スライドに登場の動きが付き、1枚の情報量を増やせる。AI Topic カテゴリ `ai` も同じ扱い |
| source | 任意。元資料（`input/<ファイル名>.pdf` / `.docx` / `.pptx`） |
| targetSeconds | 全体の目標時間。本番QAでは±15%以内 |
| layout | title: サムネイル / agenda: アジェンダ / statement: 要点 / steps: 段階 / compare: 2列比較 / table: 表 / chat: AIとのやりとり / bars: 棒グラフ / code: コード / timeline: 年表 / cycle: 輪の図 / stack: 層の図 / message: 一文 / takehome: Take Home Message（4つ）。並び順の規則は docs/DESIGN.md |
| plannedSeconds | 音声未生成時と無音リハーサルで使う予定時間 |
| appearance | スライド別の見た目 `{ "css": "#stage ...", "category": "va" }`。挿入画面の「挿入元を保持する」（既定）で、その時点のCSSとカテゴリを保存する。`css: ""` は標準の見た目を保持、カテゴリ未設定は `null`。CSSの制限は講義の `theme.css` と共通。編集・再生・MP4で同じ見た目になり、ほかのスライドには影響しない。「編集中の講義に合わせる」で挿入するとこの指定を外し、挿入先のCSSとカテゴリを使う。配置・図形・画像・cueはどちらも保持する |
| gapAfter | 音声終了後、次のスライドへ進むまでの余白。最終枚では使わない |
| narration | 読み上げ原稿。操作画面に表示 |
| ttsText | 任意。専門用語の読み仮名を補助する場合だけ指定する生成用原稿 |
| style | 任意。スライド別の話し方。未指定ならTTS設定の既定値 |
| ttsModel | 任意。そのスライドだけ別のTTSモデル（例 `gemini-3.8-flash-tts`）で生成する。`config/tts.json` の model を変えると全講義の音声が作り直し対象になるため、1日の上限（RPD）に達したときなどはこちらを使う |
| ttsVoice | 任意。そのスライドだけ別の声（永続カスタムボイスID `voice_…`。一覧は `npm run voices`）で生成する。`config/tts.json` の voice を変えると全講義の音声が作り直し対象になるため、紹介動画など講義単位で声を変えるときは全スライドにこれを書く。ユーザーが声を指定したときだけ使う |
| imageSeries | 任意（flow / compare）。段階・列ごとの絵に共通する構図・色の指示（Codexへの依頼書に載る） |
| blocks[].image | 任意（flow / compare / table）。flow は段階の箱の上部、compare は列の見出しの上、table は行の見出しの左（小さなアイコン）に置く絵 `{ "alt", "prompt", "checklist" }`。ファイル名の既定は `<スライドID>-<ブロックID>.png` |
| blocks[].icon | 任意（agenda / statement / flow / steps / compare / table / bars / timeline / cycle / stack / takehome）。線画アイコンの名前（`src/icons.js` の `ICONS`。例 `database`・`user`・`search`・`key`・`shield`・`code`）。淡い丸の地にカテゴリの色の線で描き、flow は箱の上部、cycle は箱の左端、stack は箱の左、それ以外は label の左に置く。同じブロックに `image` があれば絵を優先する。AI Topic では図解のブロックにほぼ必ず付ける |
| transition | 任意（compare のみ）。true で中央を丸矢印にし、変化（Before→After）を示す |
| columns / blocks[].cells | table のみ。columns は見出し行（2〜4列）、各行は label（1列目）・text（2列目）・cells（3列目以降、columns−2個） |
| note | 任意（statement / flow / figure / steps / compare / table / chat / bars）。本文の下に置くまとめの一文（改行なし）。cue の target は "note" |
| image | 任意（title / statement / figure。figure では必須）。`{ "alt": 説明, "prompt": 生成指示, "file": 省略時 <id>.png, "labels": [図に重ねる名称], "checklist": [図が満たす条件], "revision": 生成済み画像への修正依頼（確認後に外す） }`。画像とラベル座標（`<画像名>.labels.json`）はCodexが `lectures/<slug>/images/` に保存 |
| image.crop | 任意。トリミング範囲 `{ "x": 0.1, "y": 0.1, "width": 0.8, "height": 0.8 }`。元画像全体に対する0〜1の割合で、範囲は画像内。幅・高さの最小は0.01。未指定は全体を表示。元画像は変更せず、編集・再生・動画で同じ範囲を描画 |
| image.labelPositions | 任意。編集画面で指定した構造ラベルの座標 `[{ "text": "構造名", "x": 0.4, "y": 0.5, "side": "right" }]`。`labels` の各名称と一致し、元画像全体に対する0〜1の割合。side は left / right / top / bottom。ある場合は外部の `.labels.json` より優先し、トリミング後の位置へ換算して表示 |
| blocks | 段階表示する内容。id、textが必須。label、detailは任意。`**語**` で重要語を濃いグレー太字にする |
| blocks[].role | chat のみ・必須。`user`（質問・右）/ `ai`（答え・左）。吹き出しは2〜4つ。label は吹き出し上の小さな見出し（任意） |
| blocks[].value / unit / highlight | bars のみ。value（0以上の数値・必須）、unit（6文字までの単位、例 `%`・`分`）、highlight（true でオレンジの棒）。bars は label（項目名）が必須で、text は項目名の下の補足（任意）。行は2〜6つ |
| max | 任意（bars のみ）。棒の目盛りの上限。省略時は value の最大値 |
| blocks[].code / command / output | code のみ。code（必須・12行まで）、command（ターミナルで打つコマンド。`$ ` は自動で付く）、output（結果）。label＝ファイル名、text＝パネルの下の説明。パネルは1〜3枚 |
| blocks[].row | stack のみ・必須。層の段（1〜5、1がいちばん下）。同じ row のブロックは横に並ぶ |
| center | 任意（cycle のみ）。輪の中央に置く16文字までの言葉（`\n` で改行可） |
| cues | targetのblockを表示する時刻。0以上、昇順、各blockにつき1件 |
| animation | 任意。`{ "type": "subtle" }`（短い出現）／`preview`（点線で全体を予告）／`focus`（説明中に注目）／`flow`（矢印→要素）／`limit`（上限で停止）／`none`（即時表示）。カテゴリにかかわらず指定でき、再生位置・手動送り・無音確認・MP4で共通の状態を描く。未指定のAI Topic基本レイアウトは短い動き、医療系は従来の表示 |
| animation.targets | flowの必須項目。経路順のブロックIDを重複なしで2つ以上。経路外の説明は通常のcueで表示し、血液などの流れには含めない。例 `["out", "filter", "return"]` |
| animation.stagger | 任意のboolean。同時cueの項目だけ0.09秒ずらす。既定true。falseなら同時。noneでは指定しない |
| animation.verdicts | 任意。`[{ "target": "b", "result": "pass" }]`。指定したブロックの出現後、右上に判定を表示。resultはpass（✓）／fail（×）、targetは重複しない |
| animation.links | flowの任意項目（preview/focusを選んだflowにも可）。`[{ "target": "b", "style": "dashed", "result": "fail" }]`。到着先のIDで線を指定。styleはsolid／dashed、任意のresultはpass／fail。経路の最初のブロックは指定不可 |
| animation.limit | limitの必須項目（barsだけ）。0より大きく、グラフのmax以下の数値。棒の表示とカウントはここで止め、要求値は併記。元のblocks[].valueは変更しない |
| animation.blockedTargets | limitの任意項目。超過判定後に35%へ薄くするブロックIDの配列。指定しなければ他項目へ影響しない |

cueの秒数は**WAVファイル先頭からの再生時間**です。発話開始からの相対秒ではありません。発話開始位置は音声メタデータの `speechStart` で確認できます。cueの時刻以降は表示を維持し、巻き戻すと表示前の状態に戻ります。

`gapAfter` を含めた合計が完成動画の予定尺です。プレイヤーの読み込みにわずかな時間がかかる場合があるため、フレーム単位で固定された動画尺は保証しません。音声生成後の実測を優先してください。

レイアウトは12種類です。chat・bars と AI Topic の flow には動きがあります（docs/DESIGN.md の「アニメーション」）。複雑な図解・画像・グラフが必要な講義では、共通プレイヤーを維持しながら `renderSlide` とCSSにレイアウトを追加できます。自動で専門的な図解を生成する機能は含みません。

## 編集画面の配置情報（任意）

## 追加した図形・文字（任意）

編集画面で足した図形・文字は `slides[].shapes` に保存します。位置と大きさは1920×1080キャンバス上の**絶対座標**（px）です。

```json
"shapes": [
  { "id": "shape-1", "kind": "text", "x": 1290, "y": 810, "width": 220, "size": 28, "color": "strong", "text": "**要注意**" },
  { "id": "shape-2", "kind": "rect", "x": 1250, "y": 780, "width": 520, "height": 130, "color": "accent" },
  { "id": "shape-3", "kind": "arrow", "x": 1000, "y": 830, "width": 220, "angle": 0, "color": "accent" }
]
```

| kind | 項目 | 色（color） |
|---|---|---|
| text（文字） | x, y, width（64〜）, text, size（28 / 40） | strong（濃いグレー）/ text（薄いグレー） |
| rect（四角）・circle（丸） | x, y, width, height（32〜） | primary（紺）/ accent（オレンジ） |
| arrow（矢印）・line（線） | x, y, width（長さ48〜）, angle（−180〜180） | primary / accent |

- 1枚に12個まで。スライドの外（x＋width＞1920 など）や、上の表にない項目は保存できません。id は英数字で、本文・人物の id と重複させません。
- cue は任意です。`cues` に `{ "at": 秒, "target": "shape-1" }` があればその時刻に表示し、なければ最初から表示します。
- 音声には影響しません（TTSの生成条件は原稿・声・話し方だけ）。足した文字を読ませる場合は原稿に書き足します。
- **Claudeが lecture.json を書き直すときも shapes と、その cue は消さずに残します。**

ナレーションは操作画面で確認できますが、録画画面の字幕表示は初期仕様に含みません。字幕が必要な講義では、字幕データと同期表示を追加します。

## 血液透析の回路図（hdCircuit）

`statement` に `hdCircuit: {model:"hd-circuit-v1", targets:[…]}` を指定すると、血液回路と透析液回路の固定の模式図を本文の上に表示します。`targets` は説明順（脱血・透析液・拡散・除水・返血）の本文ID5つで、cueは時刻順です。各cueのあと順に管が満ち（先頭の光る点と部品の波紋つき）、拡散のcueで拡大図がズームし、返血のcueの7〜12秒後に気泡検知で血流が止まる場面を表示します。cueごとの動きの長さは6／5.5／2／3／12秒です。流れはスライドの最後まで再生位置から計算して続き、再生前・再生後・全画面の発表中はプレイヤーが流れだけを続けます（一時停止中と書き出しでは止まります。`src/hd-circuit-motion.js`）。

音声が1枚もない講義は、再生画面を開くと無音リハーサルが自動でオンになります。
