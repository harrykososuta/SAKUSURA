import { argumentValue } from './lib/project.mjs';
import { createDesignImportStore } from './lib/design-import-store.mjs';

try {
  const task = await createDesignImportStore().complete(argumentValue(process.argv, '--task'));
  console.log(`プリセット「${task.entry.design.name}」を保存しました。ブラウザのPDF追加画面に自動反映されます。`);
  console.log(`/design/detail?theme=${task.entry.id}`);
} catch (error) {
  console.error(error.status ? error.message : 'プリセットを保存できません。作業フォルダーとファイルを確認してください。');
  process.exitCode = 1;
}
