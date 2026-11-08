# 構成と設計判断

## 処理の流れ

1. `input/` のPDFをClaude Codeが読み取り、講義データ（`lectures/<slug>/lecture.json`）を作成。保存のたびにフックが構成を検査。
2. 画像が必要なスライドは `npm run images` が依頼書 `images/REQUEST.md` を書き出し、Codexが画像を生成して `images/` に保存。
3. Node.jsの生成ツールがGemini TTSを呼び、スライドごとのWAVと生成条件を保存。
4. ローカルHTTPサーバーがプレイヤー・講義データ・WAV・画像を配信。
5. ブラウザがWAVの再生位置から表示状態を復元。
6. 音声のendedイベント後、指定の余白を経て次へ進行。
7. OBSが映像と音声を収録。

## デザインと検査

スライドの見た目は `src/style.css` の `#stage` 以下に集約しています（規格は `docs/DESIGN.md`）。12枚構成・一文スライド・フロー図などの構成ルールは `src/core.js` の `validateDeckStructure`、文字サイズ・文字色・固定要素の位置はブラウザ検査（`tools/browser-qa.mjs`）が確認します。検証結果と画面PNGは講義ごとに `reports/<slug>/` へ保存し、撮り直しの前に古いPNGを消します。

`/editor` は編集専用画面です。描画は `src/slide-view.js`、任意の配置差分は `src/placement.js` を通常プレイヤーと共有します。同期の状態機械 `LecturePlayer` は従来のままです。
`PUT /api/lecture?name=<slug>` は同一Origin・専用ヘッダー・JSON形式・2MiB上限を要求し、構成検証・SHA-256による版の照合・保存前バックアップ・一時ファイルからの置換を行います。
保存要求は講義ごとに直列化します。バックアップのファイルは直接配信しません。`GET /api/lecture/history?name=<slug>` で最新200件の保存前履歴を返し、`&file=<バックアップ名>` を付けると名前・サイズ・形式を検査した履歴と画像の状態を返します。復元は編集画面のデータを置き換え、通常の保存APIで版の照合とバックアップを行います。1ページだけ戻す場合はIDで対応付け、他ページと現在の並びは保ちます。音声ファイルは戻しません。

`POST /api/lecture/images?name=<slug>` は同一Origin・専用ヘッダー・application/octet-stream・10MiB上限を要求します。PNG/JPEG/WebPのシグネチャを検査し、`images/upload-<UUID>.<拡張子>` に追記して上書きを避けます。講義JSONはこの操作では変更せず、画像の適用後に通常の保存APIを使います。`image.crop` と `image.labelPositions` は元画像に対する割合で保存し、共通の描画処理でトリミング範囲とラベルの表示位置を計算します。編集画面はAPIキーやTTS設定を受け取りません。操作は [EDITOR.md](EDITOR.md) を参照してください。

音声生成は `tools/lib/tts.mjs` をCLIと共有します。`POST /api/tts/plan` は保存済み原稿の差分・枚数・文字数と10分有効の確認トークンを返します。`POST /api/tts/start` は版・設定・トークンを照合してから、確認した原稿のスナップショットで生成します。どちらも保存と同じOrigin・専用ヘッダー制限を使います。
`GET /api/tts/job` で進捗を取得し、完了後に音声一覧を再読み込みします。生成は講義ごとにロックし、再試行は自動では行いません。キー・APIエラー本文は画面へ返しません。更新前のWAV・生成条件は `audio/backups/` へ保存します。

## 講義ライブラリ

`/library` は講義の分類画面です。`tools/lib/library-store.mjs` が講義のカテゴリと保存済み分類を結合し、`GET /api/library` で一覧を返します。
`POST /api/library` は同一Origin・専用ヘッダー・JSON形式を要求し、フォルダー作成・名前変更・移動・講義の分類・選択削除・復元を行います。
分類は `library/index.json` に保存し、版の照合・直列化・更新前バックアップ・一時ファイルからの置換を使います。講義のJSON・音声・画像は移動しません。
削除は同ファイルの `trash` に操作単位で記録します。元ファイルは保持し、一覧から除外します。ごみ箱内の講義への取得・保存・TTS生成・動画書き出しはHTTP 410で止めます。復元時はフォルダー構成と所属を戻し、同名の競合がある場合は上書きしません。
起動時および `/`（講義・録画指定なし）は `/home` のHOMEダッシュボードを開きます。`/?lecture=<slug>`・録画URL・`/player` は従来のプレイヤーを開きます。
`src/lecture-picker.js` は既存の講義選択欄をカテゴリ・フォルダーでグループ表示します。分類データを読み込めない場合も従来の一覧APIへ切り替え、再生を継続できるようにします。
詳しい操作は [LIBRARY.md](LIBRARY.md) を参照してください。

## HOME ダッシュボード

`public/home.html`・`src/home.js`・`src/home.css` は、共通の外観設定、通知ベル、検索パレット、スタジオ更新通知を使います。`tools/lib/lecture-status.mjs` がライブラリの有効講義を読み、画像の有無・共通の音声キャッシュ整合性・Harnessの結果と更新日・書き出し動画から状態を判定します。取り込み情報は講義別の `share.json` を読み取り、HTML単体講義も扱います。ごみ箱・デモは除外します。

`GET /api/home?view=overview` は最近の講義などを先に返し、`GET /api/home` が画像・音声の検証を終えた状態を返します。WAVの検証結果は入力条件・サイズ・更新時刻で無効化する `reports/home/audio-cache.json` を使って再利用します。`tools/lib/tts-usage.mjs` は実際の音声APIリクエストごとに、モデル別・太平洋時間の日付別の試行回数と429応答を `reports/tts-usage.json` に保存します。CLI/サーバー間の更新はファイルロックと原子的置換を使い、キーやAPIエラー本文を記録・公開しません。画面の表示条件と制限は [HOME.md](HOME.md) を参照してください。

## キャッシュ

台本（ttsTextがあればそれを優先）・モデル・ボイスID・話し方・音声形式のSHA-256を保存します。現在の条件に一致し、WAVのファイルハッシュと形式も正常なら再生成しません。cue・レイアウト・見出しの修正は音声キャッシュを無効にしません。

APIキーはローカルのNode.jsだけで使用します。ブラウザへは配信しません。HTTP配信は公開ファイル・講義JSON・音声に限定し、設定・環境変数ファイル・制作ルールを公開しません。画面の部品（`src/` 直下の `.js`・`.css`）は一覧に登録しなくても配信します（部品の追加でサーバーの再起動や登録が要らないように）。サブフォルダーやほかの拡張子は配信しません。`/api/code-status` は、サーバーが import でたどれるファイル（`tools/lib/server-code.mjs`）が起動後に更新されたかを返し、全画面の `src/studio-status.js` が更新のお知らせと読み込み失敗の案内を出します（収録・書き出し・全画面・iframeでは出しません）。`npm start`（`tools/launch.mjs`）から起動したサーバーは、画面の `/api/restart` で終了コード75で終わり、launch.mjs が同じウィンドウで起動し直します（書き出し・音声生成中は断ります）。サーバーは127.0.0.1にバインドします。

## 再生

通常再生では音声のcurrentTimeを参照し、requestAnimationFrameで表示を更新します。独立したアニメーション時計を累積しないため、停止・再開・巻き戻しでも表示を再計算できます。無音リハーサルだけは予定秒数とブラウザ時計を使います。

録画モードは操作UI・カーソルを非表示にします。全画面表示はブラウザのFullscreen APIを使います。音声再生はユーザーの操作から開始します。全画面プレゼン中だけ、マウスを動かすとカーソルを表示し、Lでレーザーポインターを切り替えます（`src/presentation-pointer.js`）。収録に映らないよう、音声付き再生中はカーソルを出しません。Pのペン・Zとホイールの拡大（`src/presentation-tools.js`）も全画面プレゼン中だけの一時的な表示で、lecture.jsonや動画の書き出しには入りません。線はステージ座標で持ち、全画面を抜けると消えます。マウスを動かすと左下に操作バー（`src/presentation-bar.js`）を出し、キーと同じ処理を呼びます。Gのスライド一覧（`src/presentation-overview.js`）は右の一覧と同じ縮小表示の処理を使い、開いた時点で初めて描画します。Sの発表者ビュー（`public/presenter.html`・`src/presenter.js`）は別ウィンドウで、再生画面とBroadcastChannel（`src/presenter-link.js`）でつながります。状態の持ち主は再生画面で、発表者ビューは状態を受けて描き、送り・一覧・黒白画面・再生・レーザー・ペンの線・拡大の要求だけを返します（受け付ける操作と値の範囲は `validCommand` で限定）。動きは受け取った時刻と `settleTo` から発表者ビュー自身が進めます。再生画面が隠れるとChromeが requestAnimationFrame を止めるため、発表者ビューは0.1秒ごとに pulse を送り、再生画面はそれで時計を進めて状態を送り続けます。発表者ビューをつないでいる間は、録画モードの表示でも全画面と同じ発表用の操作になります（Zoomでウィンドウ共有する場合のため）。2画面でChromeの「ウィンドウの管理」が許可済みなら、Window Management APIでスライドを発表者ビューのない画面に全画面表示します。

音声はスライドごとに読み込みます。全素材の先読み・動画のオフライン書き出し・OBSの自動制御は初期実装の範囲外です。ローカル配信で開始前に試し再生し、スライド切り替えに不自然な間が出ないか確認してください。

## 参考にした実装と公式仕様

- 既存の `動画生成/templates/remotion-project/tools/tts.mjs`: シーン別生成・キャッシュ・WAV計測。今回は複製ボイスとHTML再生へ変更。
- [Gemini TTS公式仕様](https://ai.google.dev/gemini-api/docs/speech-generation): Interactions REST API、voice ID、音声生成、ボイス一覧。2026-10-19確認。
- [MDN: currentTime](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime): 音声再生位置。
- [MDN: Autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay): ユーザー操作から音声再生を開始。

ブラウザQAはChrome DevTools Protocolを使い、インストール済みChrome/Edgeを隔離されたテスト用プロファイルで起動します。通常のブラウザプロファイルには触れません。
