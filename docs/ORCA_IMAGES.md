# Orcaで画像Taskを往復する

Claude Codeが制作の進行役、Codexが画像担当です。画像仕様の正本は `lectures/<slug>/images/REQUEST.md`、担当・実行状態・完了通知の正本はOrcaのRun / Task / Dispatchです。GitHubやLinearは使いません。現在のフォルダー型ワークスペースのまま動きます。

## Claude Codeの手順

通常のClaude Codeセッションを進行役にします。別のTaskの担当として起動されたClaudeからさらにCodexを起動すると、OrcaのNested worker depth設定によって拒否される場合があります。Runを作り直しても階層制限は変わりません。設定を勝手に変更せず、通常の進行役セッションから実行してください。

1. AGENTS.mdに従って講義を作り、画像のprompt / labels / checklist / revisionを整えます。
2. `npm run images:task -- --lecture <slug> --check` で依頼する枚数と対象を確認し、ユーザーへ簡潔に伝えます。これは画像生成もOrcaの変更も行いません。
3. `npm run images:task -- --lecture <slug>` を実行します。REQUEST.md作成、専用Run作成、Task登録、同じフォルダーでのCodex起動と依頼送信まで行います。OrcaのChat UI設定に従って起動します。モデルはユーザーの既定設定を使います。
4. **制作のターンを終了せず**、`npm run images:task -- --lecture <slug> --wait` を繰り返して完了・質問を待ちます。1回の待機は最大55秒です。時間切れは待機の区切りであり、失敗・完了・再起動の根拠ではありません。同じ講義のlecture.jsonとREQUEST.mdは待機中に変更しません。
5. 戻り値の `delivery` を全件処理します。typeによる待機フィルターは、古い質問や通知を読み飛ばす許可ではありません。
   - `question` は内容を読み、`orca orchestration reply --id <message_id> --body "回答" --json` で回答します。必須の判断だけユーザーへ確認します。
   - `worker_done` は、保存済み `images/ORCA_TASK.json` のstartReceiptにある実際のTask / Dispatchと一致すること、明示されたoutcome、実在する画像結果JSON、画像、ラベル、検査結果を確認します。完了通知だけで医療図の正しさを断定しません。
   - 成功・失敗ともにsettledな担当だけ `orca orchestration worker-release --dispatch <dispatch_id> --json` で後処理します。成功のworker_doneがOrcaのTaskも完了させるので、task-updateで重ねて完了にしません。
   - **バッチの全メッセージを処理し、担当の後処理を決めた後**、`orca orchestration check --run <run_id> --terminal <coordinator_handle> --ack <delivery_id> --json` でバッチを確認済みにします。この応答が次のバッチを含む場合も全件処理します。
6. `npm run images:task -- --lecture <slug> --record` を実行します。Orcaの完了状態、担当の後処理、未処理通知なし、依頼のハッシュ、PNG寸法、ラベル形式、今回のQA、目視確認レポートを照合して作業記録を確定します。成功後、Claudeが画像を確認してimage.revisionを外し、TTS・cue・Harnessなど残りの制作を続けます。失敗なら原因を報告し、未完成のまま制作を進めません。

この待機ループが完了通知を受け取って同じClaudeの作業を再開します。単に入力待ちで放置したClaudeへの通知だけに頼りません。Orca本体の再起動も不要です。

`--wait`・Deliveryのack・`--record` は依頼を起動した同じClaudeのセッションで行います。他の端末からその進行役の受信箱を操作すると `consumer_fenced` で拒否されます。保存済みハンドルを別の端末のものへ書き換えず、元の進行役へ戻ってください。`--status` は状態確認に使えます。

## 状態と重複防止

`npm run images:task -- --lecture <slug> --status` でRun・Task・担当の現在の状態を確認します。`images/ORCA_TASK.json` は起動前から保存されるローカルの連携記録です。実行中・起動不明の依頼を繰り返しても新しいCodexは起動しません。同じ内容の完了済み依頼も再生成しません。変更が不要ならTaskを作りません。

変更・再依頼はClaudeがimage.revisionなどを更新してから行います。生成済み画像を一括で再生成するオプションはありません。起動結果不明・失敗・Orca再起動後は、記録を消して最初からやり直さず、`orca skills get orchestration --reference references/recovery-and-cleanup.md --json` の現行手順と保存済みreceiptを確認します。空の待機が3回続いた場合も `--status` とworker-readで実際の状態を調べます。

Orcaが起動していない・接続できない場合は処理を止め、そのエラーを確認します。接続拒否を理由に別ホストや別のCLIへ切り替えません。CLIは `ORCA_CLI_COMMAND`、開発環境の `orca-dev`、通常のWindowsでは `orca` を使います。

Orcaが `effectsApplied:false` を明示した起動前の拒否は `refused` として記録します。原因を解消した後に限り `--retry-refused` で再依頼できます。前のRunのTask・担当が両方0件であることを照合し、前の記録を保存してから起動します。起動結果不明・通信断・既に担当が作られた失敗には使えません。

`outcome_unknown` / `turn_start_unobserved` は既存Dispatchの識別子を保存して待機を続けます。このWindows端末では、貼り付けた依頼が入力欄に残り送信されないことが繰り返し起きています。そのため `--wait` は、起動から60秒を過ぎても担当が `turn_start_unobserved` のままなら、Codexの画面を読みます。依頼文が未送信で残り（入力欄の `draft`、または依頼の最後の一文の後に `›` の入力行がない）、しかも実行中（Working）・承認待ちでない場合に限り、**Dispatchごとに1回だけ** Enterを送ります。送った記録は `ORCA_TASK.json` の `nudge` に残り、`--wait` の結果にも `nudged` として出ます。依頼文の再送や別担当の起動はしません。自動送信の後も動き出さない場合や判断できない場合は、`orca terminal read --terminal <agent handle> --screen` で画面を確認し、待機・状態確認を続けます。

### Codexが起動に失敗したとき

Codexが起動時のエラー（例：`account/read failed during TUI bootstrap: workspace routing discovery timed out`）で終了すると、端末はPowerShellに戻り、依頼文はシェルの入力に流れ込みます。`--wait` は画面の最後がPowerShellのプロンプト（`PS C:\...>` や継続の `>>`）ならEnterを送らず、結果に `codexExited` を出します。このときは同じDispatchのまま次の手順で立て直します（新しいRun・Task・担当は作りません）。

1. シェルに残った入力を取り消す：`orca terminal send --terminal <agent handle> --text "<Ctrl+C>" --interrupt --json`（Bashでは `$'\x03'`）。
2. 同じ端末でCodexを起動する：`orca terminal send --terminal <agent handle> --text codex --enter --json`。画面に `› Ask Codex to do anything` が出るまで待つ。
3. 依頼文を送り直す：`orca orchestration dispatch-show --task <task_id> --preamble --json` の `preamble`（前文とTASKの全文）を `orca terminal send --terminal <agent handle> --text <preamble> --enter --wait-submit 20 --json` で送る。画面が `• Working` になれば以降は通常どおり `--wait` で待つ。

## Codexの作業範囲

Taskの実行前文とREQUEST.mdを全文読み、imagegenスキルと内蔵画像生成を使います。内蔵ツールが利用できなければ失敗を返し、別の有料API経路へ切り替えません。

変更するのは対象画像・ラベル座標と講義のreportsだけです。lecture.json、CSS、台本、音声、REQUEST.md、ORCA_TASK.jsonは変更しません。指定のフォルダーへ保存してから既定のcheck / qa:browserと目視確認を行い、Taskに指定された固有の結果JSONへ依頼ハッシュ・保存ファイル・目視確認内容を記録します。最後に実行前文の正確なworker_doneを一度だけ送り、ターンを終了します。

## 検証

`tests/orca-images.test.mjs` は重複起動、起動不明時の抑止、待機通知を勝手にackしないこと、未完了・未処理・古いQAを成功扱いしないことを検査します。実際のOrca往復の検証記録は `reports/orca-images/` に保存します。実際の画像生成・Claude再開の確認結果は、その記録と区別して報告します。
