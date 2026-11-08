// 音声生成（TTS）のAPIキーが登録済みかどうか（値は読み出して表示しない）と、未登録の人への登録案内。
// npm run tts:status・UserPromptSubmit フックで共通に使う。
import { loadEnv } from './project.mjs';

export function ttsKeyRegistered() {
  loadEnv();
  return !!process.env.GEMINI_API_KEY?.trim();
}

export const TTS_KEY_GUIDE = [
  'TTS（ナレーション音声）のAPIキーの登録手順:',
  '1. Google AI Studio（https://aistudio.google.com/apikey）で Gemini API キーを作成する',
  '2. このフォルダー直下に .env を作り、GEMINI_API_KEY=<作成したキー> の1行を書く（.env は共有・配布しない）',
  '3. 声を自分のAPIプロジェクトのものにする：npm run voices で一覧を確認し、npm run voices -- --resolve --name "<ボイス名>" で config/tts.json に設定する（配布版のボイスは未設定）',
  '4. スタジオ（npm start）を起動し直す',
  '登録しない場合は無音で作成します：ナレーション原稿はいつもどおり書き、npm run timing で表示時間を合わせ、npm run render -- --silent で無音の動画を書き出します。あとでキーを登録すれば、同じ原稿から音声を生成できます。'
].join('\n');
