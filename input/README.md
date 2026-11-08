# input：元資料を置く場所

スライドにしたいPDF・Word（.docx）・PowerPoint（.pptx）をこのフォルダーに置き、Claude Codeに「input の資料でスライドを作って」と依頼してください。

1. `npm run inputs` で、置いた資料と作成状況（未作成 / 作成済み → lectures/<slug>）を確認できます。
2. Claude が資料を全ページ読み取り（Word・PowerPointは `npm run extract -- "input/<ファイル名>"` で本文を抽出。PowerPointは表・グラフの数値・発表者ノートも取り出します）、内容から12枚の構成（サムネイル・アジェンダ・本編・一文スライド2枚・フロー図・Take Home Message 4つ）を作ります。
3. 作成した講義の `lecture.json` には `"source": "input/<ファイル名>"` が記録されます。
4. 画像が必要な箇所は `lectures/<slug>/images/REQUEST.md` に生成依頼書が出ます。Codexに渡して生成してもらいます。

- 資料にない数値・事実はスライドに加えません。不明な点は `[要確認]` として報告します。
- PowerPointは中身（文字・数値・ノート）だけを使い、SAKUSURA標準の12枚とカテゴリの配色で作り直します。元の見た目（配置・色）は引き継ぎません。
- 元の資料は削除・変更しません。
