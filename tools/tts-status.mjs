// TTSのAPIキーが登録済みかを表示する（キーの値は表示しない）。npm run tts:status（--json で機械向け）
import { ttsKeyRegistered, TTS_KEY_GUIDE } from './lib/tts-key.mjs';

try {
  const registered = ttsKeyRegistered();
  if (process.argv.includes('--json')) console.log(JSON.stringify({ registered }));
  else console.log(registered ? 'TTSのAPIキー：登録済み（GEMINI_API_KEY）。音声付きで作成できます。' : `TTSのAPIキー：未登録\n\n${TTS_KEY_GUIDE}`);
} catch (error) { console.error(`APIキーの登録状況を確認できません: ${error.message}`); process.exitCode = 1; }
