# 講義・デザインをほかの SAKUSURA と共有する

作った講義（スライド）やデザインテンプレートを、**ZIPファイル1つ**にして相手に渡し、相手の SAKUSURA で取り込めます。ネットワーク（クラウド・サーバー）は使いません。メール・USB・Googleドライブなど、好きな方法でZIPを渡してください。

## 書き出す（送る側）

```sh
npm run share:export -- --lecture <講義名> --author "送り主の名前"   # 初回だけ --author が必要
npm run share:export -- --lecture <講義名> --no-audio               # 音声を入れない（小さくなる。相手はTTSで作り直す）
npm run share:export -- --design <design-ID>                        # デザインテンプレートだけ
```

ライブラリの講義の行の「共有」からも同じ処理を実行でき、ZIPをダウンロードとして保存します。デザインテンプレートは「デザイン」画面のカードの「···」→「共有ファイルに書き出す」から書き出せます（標準デザインは全員が持っているので対象外、PDFから作ったデザインはまだ書き出せません）。コマンドの出力先は `exports/share/<題名>_v<版>.zip` です（同名があれば `_2` などを付けて上書きしません）。送り主の名前は `library/share-settings.json` に保存され、次回から省略できます。

### ZIPに入るもの

| 入るもの | 入らないもの |
|---|---|
| `lecture.json`（HTML単体の講義は `html-deck.json`・`slides.html`）、`theme.css`、`DESCRIPTION.md` | `backups/`、組み立て用スクリプト（`.mjs` など）、メモ（`.txt`） |
| `images/` の PNG・JPG・WebP と画像の説明JSON | 画像の依頼書（`REQUEST.md`）・Orcaの状態ファイル・SVG |
| `audio/` の WAV と管理JSON（`--no-audio` で省略） | `audio/backups/`、動画（MP4）・PDF |
| 講義が使っているデザインテンプレート（`designs/design-<ID>.json`） | PDFから作ったデザイン（この版では未対応。講義の見た目は `lecture.json` のCSSで再現されます） |

ZIPの先頭には `share.json`（共有ID・版・送り主・SAKUSURAの版・全ファイルのSHA-256）が入ります。

## 共有ID（ナンバープレート）と版

- 講義を初めて書き出したときに **共有ID**（例 `SKS-7F3K-92QD`）を発行し、講義フォルダーの `share.json` に保存します。以後は変わりません。講義名（フォルダー名）は人によって違うことがあるので、同じ講義かどうかは共有IDで判断します。
- **版**（v1, v2 …）は、前回の書き出しから中身（音声以外）が変わったときだけ1つ上がります。変えずに書き出し直しても同じ版です。
- 受け取った講義を **手を加えずに** 書き出すと、同じ共有ID・同じ版・元の送り主のまま転送します。**手を加えてから** 書き出すと新しい共有IDを発行し、`originId` に元の共有IDを残します（改変版として区別できる）。
- デザインテンプレートは、もともと持っている `design-<UUID>` を識別番号に使います。
- 共有IDは「同じ講義か」を見分けるためのもので、本人確認や改ざん防止の機能ではありません。SHA-256 の照合は、受け渡しの途中でファイルが壊れていないかを確かめるものです。

## 取り込む（受け取る側）

```sh
npm run share:import -- <ZIPのパス> --check          # 中身と衝突を確認するだけ（何も書かない）
npm run share:import -- <ZIPのパス>                  # 取り込む
npm run share:import -- <ZIPのパス> --mode update    # 同じ共有IDの講義を新しい版で置き換える
npm run share:import -- <ZIPのパス> --mode copy      # 同じ共有IDの講義があっても別の講義として追加
```

ライブラリと「デザイン」画面の **「共有ファイルを取り込む」** ボタン（ZIPを選ぶ、または画面にドラッグ）でも同じ処理を実行し、衝突があればその場で選べます。どちらの画面でも講義・デザインのどちらのZIPも取り込めます（講義はライブラリの「共有で受け取った」、デザインは「デザイン」画面の一覧に入ります）。

- **初めての共有ID**：新しい講義として追加します。同じ講義名（フォルダー名）がすでにあれば `<講義名>-2` のように別名にします。
- **同じ共有IDの講義が手元にある**：「更新する（update）」か「別に残す（copy）」を選びます。更新では、元の講義を `library/backups/share/<講義名>-<日時>/` へ移してから置き換えます（戻したいときはそのフォルダーを `lectures/` に戻します）。手元の方が新しい版のときは警告します。
- **カテゴリ**：送り主のカテゴリを変えずに残します（カテゴリはデザイン設定とも結びついているため）。手元に同じカテゴリがあればそのタブにも、なければ「カテゴリ未設定」にも表示されます。
- **受け取り箱**：取り込んだ講義は、ライブラリの **「共有で受け取った」** タブに並びます（送り主・版・受け取り日を表示）。「整理」で自分のカテゴリ・フォルダーへ移すと、このタブから外れます。
- **デザイン**：同じIDで中身も同じなら何もしません。講義と一緒に届いたデザインが手元の同じIDのデザインと違う場合は、手元を残します。デザインだけのZIPでは update（更新）か copy（別名で追加）を選べます。同じ名前のデザインがあれば「（受け取り）」を付けます。
- **SAKUSURAの版**：送り主の方が新しい版なら警告します。講義の形式を読めない場合は取り込みません。

## 安全のための制限

他人から受け取ったZIPは、取り込む前にすべて検査し、1つでも問題があれば **1ファイルも書きません**。

- `share.json` の一覧にないファイル、一覧と中身（SHA-256）が違うファイル、許可していない種類のファイル（スクリプト・SVGなど）、`..` を含むパスは断ります。
- 展開後のサイズ（1ファイル300MB・合計2GBまで）、ファイル数（5000件まで）、CRCを確かめます（ZIP爆弾対策）。
- 画像は PNG・JPG・WebP、音声は WAV だけ配信します。HTML単体の講義は従来どおり隔離した状態（スクリプトは外部へ通信できないCSP）で表示します。
- 取り込みは `tmp/share-import/` で組み立てて検査してから `lectures/` へ移すので、途中で失敗しても講義フォルダーに半端なものが残りません。

## 仕組み（開発者向け）

- 本体：`tools/lib/share.mjs`（`createShareStore` の `exportLecture`・`exportDesign`・`inspect`・`importPackage`・`leaveInbox`・`inbox`）。ZIPは `tools/lib/write-zip.mjs` と `tools/lib/zip.mjs`（`maxEntrySize` 指定時にサイズとCRCを照合）。
- 講義フォルダーの `share.json`：`{version, id, revision, author, originId?, contentHash, exportedAt, importedAt?, inbox?}`。`importedAt` があるものが取り込んだ講義で、HOME の「最近取り込んだ講義」もこれを読みます。
- ライブラリ：`tools/lib/library-store.mjs` が各講義の `share` を一覧に載せ、移動（move / assign）した講義の `inbox` を外します。
- 画面：`src/share-ui.js`（書き出し・取り込みのダイアログ。ライブラリ `src/library.js` とデザイン一覧 `src/design-gallery.js` が使う）、見た目は `src/share.css`。API は `tools/lib/share-api.mjs`（`/api/share/export`・`/api/share/export-design`・`/api/share/inspect`・`/api/share/import`・`/api/share/settings`）。
- 画面の確認：`npm run qa:share`（ライブラリの講義の共有と、デザイン一覧のデザインの共有）。
- テスト：`tests/share.test.mjs`。
