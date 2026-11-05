// Claude Code UserPromptSubmit フック：スライド・講義・資料の作成依頼が来たら、作り始める前に
// 「どのデザインを使うか」と「ナレーション音声（TTS）をどうするか」をユーザーへ確かめるよう、
// 使えるデザインの一覧・合うデザインがないときの代替案・TTSのAPIキーの登録状況と一緒にClaudeへ伝える。
// 依頼でなければ何も出さない。失敗しても依頼は止めない（終了コード0）。キーの値は扱わない（有無だけ）。
import { designChoices, formatDesignChoices } from '../lib/design-choices.mjs';
import { ttsKeyRegistered, TTS_KEY_GUIDE } from '../lib/tts-key.mjs';

// 音声入力の言い回しも拾えるよう、対象（スライド・講義など）と作成の動詞の両方を含むときだけ反応する。
const SUBJECT = /スライド|講義|資料|プレゼン|デッキ|演題|サムネ|lecture|slide|deck/i;
const ACTION = /作成|作って|作る|作り|つく|起こ|化して|まとめて|仕上げ|生成|new\b|create|make/i;

let input = '';
for await (const chunk of process.stdin) input += chunk;
try {
  const prompt = String(JSON.parse(input || '{}').prompt ?? '');
  if (SUBJECT.test(prompt) && ACTION.test(prompt)) {
    let list, registered = null;
    try { list = formatDesignChoices(await designChoices()); } catch { list = '（一覧を読めません。npm run designs で確認してください）'; }
    try { registered = ttsKeyRegistered(); } catch { /* 不明として扱う */ }
    const context = [
      '【スライド作成ルール】新しいスライド・講義・資料を作る依頼なら、構成や lecture.json に着手する前に、次をユーザーに確認してください（AskUserQuestion にまとめて質問する）。既存講義の修正・TTS・検証だけの依頼なら不要です。詳細は AGENTS.md「デザインの確認」「ナレーション音声（TTS）」。',
      '',
      '■ 1. どのデザインで作るか（必須）',
      '下の一覧から選択肢を示します（「LLMにおまかせ」も必ず含める）。依頼文でデザインが明示されたときだけ質問を省きます。選ばれた id は npm run new -- ... --design <id> で記録します。',
      '「LLMにおまかせ」（id: llm）は、テンプレートを使わず内容に合わせてLLMが lectures/<slug>/theme.css に見た目を書き、npm run theme -- --lecture <slug> で取り込みます（セレクターは #stage から）。完成したら「このデザインをテンプレートとして保存するか」を質問し、保存する場合は npm run design:save -- --lecture <slug> --name "名前"（編集画面の「︙」→「デザインをテンプレートとして保存」でも可）。CSSテンプレートを選ぶと、そのCSSが新しい講義に写されます。',
      '使えるデザイン:',
      list,
      '合うデザインがない場合は、デザインを作るよう促し、次の代替案を整理して示します：',
      '  a. 「デザイン」画面で標準を複製し、配色・カテゴリ・文字サイズを調整して新しいデザインを作る（「複製して編集」）',
      '  b. 手元のPDF資料の見た目を取り込む（「デザイン」画面の「PDFから追加」）',
      '  c. 希望を書いてAIにデザインの調整を依頼する（詳細ページの「カスタマイズ・AIに依頼」）',
      '  d. 今回は標準デザイン（SAKUSURA Standard）で作り、デザインはあとで用意する',
      'PDF原本や配色だけのプリセットを講義の見た目へ反映する連携は未実装のため、それらを選んでも表示・動画は標準のままであることも伝えます（LLMにおまかせ・CSSテンプレートは反映されます）。',
      '',
      '■ 1-2. SAKUSURAの構成ルールを守るか（必須・毎回質問）',
      '「守る」＝合計12枚・アジェンダ・一文スライド2枚・フロー図・Take Home Message 4つ（npm run new -- ... --rules sakusura）／「自由」＝枚数・構成も内容に合わせて決める（--rules free。構成の自動検査を外す）。見た目の規格（40/28px・グレー2階調など）は、LLMにおまかせ・CSSテンプレートなら外れます。',
      '',
      '■ 2. ナレーション音声（TTS）',
      registered === true ? 'TTSのAPIキー：登録済み。通常どおり音声付きで作成します（生成前に枚数・文字数を伝えて確認）。'
        : `TTSのAPIキー：${registered === false ? '未登録' : '確認できません（npm run tts:status）'}。キーの登録を促し、「登録してから音声付きで作る」か「無音で作る」かを質問します。登録を選ばない・返事がない場合は無音で作成します。`,
      ...(registered === true ? [] : [TTS_KEY_GUIDE, '無音で作る場合もナレーション原稿は通常どおり全スライドに書き、npm run tts は実行しません。仕上げは npm run timing -- --lecture <slug> → npm run harness -- --lecture <slug> --production --silent --browser → npm run render -- --lecture <slug> --silent。'])
    ].join('\n');
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } }));
  }
} catch { /* フックの失敗で依頼を止めない */ }
