// スライド作成前にユーザーへ示すデザインの一覧。npm run designs（--json で機械向け）。
import { designChoices, formatDesignChoices } from './lib/design-choices.mjs';

try {
  const choices = await designChoices();
  if (process.argv.includes('--json')) console.log(JSON.stringify(choices, null, 2));
  else console.log(`使えるデザイン（${choices.length}件）:\n${formatDesignChoices(choices)}\n\n作成時は npm run new -- ... --design <id> で指定します。`);
} catch (error) { console.error(`デザインの一覧を読めません: ${error.message}`); process.exitCode = 1; }
