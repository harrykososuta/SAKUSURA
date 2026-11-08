import { join } from 'node:path';
import { ROOT, loadTtsConfig, argumentValue, writeJson } from './lib/project.mjs';
import { listVoices } from './lib/gemini.mjs';

try {
  const config = await loadTtsConfig();
  const voices = await listVoices();
  for (const voice of voices) console.log(`${voice.display_name} | ${voice.id} | ${voice.type}`);
  if (process.argv.includes('--resolve')) {
    const requested = argumentValue(process.argv, '--name', config.voice.displayName);
    const normalize = value => value.toLowerCase().replace(/[\s_-]/g, '');
    const matches = voices.filter(voice => normalize(voice.display_name ?? '') === normalize(requested));
    if (matches.length !== 1) throw new Error(`「${requested}」に一致するボイスが${matches.length}件です。名前を指定し直してください。`);
    const voice = matches[0];
    config.voice = { alias: 'clonevoice', displayName: voice.display_name, id: voice.id, type: voice.type };
    await writeJson(join(ROOT, 'config', 'tts.json'), config);
    console.log('config/tts.json を更新しました。サーバーを再起動してください。');
  } else {
    if (!voices.some(voice => voice.id === config.voice.id)) throw new Error('設定中のカスタムボイスがこのAPIプロジェクトにありません');
    console.log(`設定確認OK: ${config.voice.alias} → ${config.voice.displayName} (${config.voice.id})`);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
