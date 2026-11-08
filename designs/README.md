# 保存したデザイン

ブラウザの「デザインを追加」で保存したテーマが `design-<UUID>.json` として保存されます。標準のSAKUSURA Standardはアプリ内にあり、このフォルダーのファイルで上書きしません。

編集前のデータは `backups/` に残ります。HTTPでこのフォルダーを直接公開せず、デザインAPIが検証済みの設定だけを画面へ返します。

参考PDFは `references/pdf-<UUID>.pdf`、元のファイル名・サイズ・ハッシュは同名のJSONに保存されます。デザインの `referencePdfId` で紐づけます。PDFを選択した時点で保存され、画面のキャンセル・紐づけ解除でもファイルは残ります。ブラウザから外部APIには送信しません。

「PDFから追加」はPDFの原本の配置・図版・文字を自動で取り込んでプリセットを保存します。作業記録は `imports/import-<UUID>/` に残します。追加の調整をAIへ依頼する場合は編集画面で `REQUEST.md` と `preset.json` を作り、CLIで依頼書を読んで `npm run design:import -- --task import-<UUID>` を実行します。`task.json` は作業の識別情報です。AIを使う場合のPDF読み取りは利用するサービスの設定に従います。

通常の編集画面からも、カテゴリ・構成・ページ別文字サイズと追加の希望をまとめてAIへ依頼できます。依頼時の設定は同じ作業フォルダーの `snapshot.json` に保存します。AIが編集するのは `preset.json` で、完了すると元とは別のプリセットとして登録します。PDFなしの依頼にも対応します。プリセットの任意項目 `categoryNames`・`deck`・`aiInstructions` に表示名・構成・希望を保存します。

形式・使い方は [デザインの閲覧と追加](../docs/DESIGN_VIEWER.md) を参照してください。APIキーやTTS設定は保存しません。

PDFの原本デザインは `pdf-pages/pdf-<UUID>/` のページSVG・書体・manifestと、プリセットの `pdfSource` を使います。原本の見た目を維持して、文字やページの変更だけをプリセットに保存します。カテゴリごとに使うプリセットの対応は `category-presets.json` です。新規PDF変換はPython＋PyMuPDF、変換後の表示と編集はNodeとブラウザで動きます。
