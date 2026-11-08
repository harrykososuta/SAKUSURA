import { pcmToWav, wavInfo } from './wav.mjs';
import { recordTtsAttempt, recordTtsExhausted } from './tts-usage.mjs';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
export async function geminiRequest(path, { key = process.env.GEMINI_API_KEY, body, timeoutMs = 120000, usageFile } = {}) {
  if (!key) throw new Error('GEMINI_API_KEY が未設定です。環境変数または .env に設定してください。');
  let response;
  const ttsModel = path === 'interactions' && body?.response_format?.type === 'audio' ? body.model : null;
  const usageDay = ttsModel ? await recordTtsAttempt(ttsModel, { file: usageFile }) : null;
  try {
    response = await fetch(`${BASE}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-goog-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs),
    });
  } catch { throw new Error('Gemini APIへ接続できません。接続・タイムアウトを確認してください。自動再試行は行っていません。'); }
  if (response.status === 429 && ttsModel) await recordTtsExhausted(ttsModel, { day: usageDay, file: usageFile });
  if (!response.ok) throw new Error(`Gemini API: HTTP ${response.status}。キーの権限・モデル・ボイス・利用枠を確認してください。`);
  return response.json();
}
export async function listVoices(options = {}) {
  const voices = [];
  let token = '';
  const seenTokens = new Set();
  do {
    const query = new URLSearchParams({ page_size: '1000' });
    query.append('type', 'replicated'); query.append('type', 'prompted');
    if (token) query.set('page_token', token);
    const result = await geminiRequest(`voices?${query}`, options);
    voices.push(...(result.voices || []));
    token = result.next_page_token || '';
    if (token && seenTokens.has(token)) throw new Error('ボイス一覧のページング応答が不正です');
    seenTokens.add(token);
  } while (token);
  return voices;
}
export async function synthesize(input, options = {}) {
  const result = await geminiRequest('interactions', {
    ...options,
    body: {
      model: input.model,
      input: [{ type: 'user_input', content: [{ type: 'text', text: input.text, annotations: [{ type: 'speech_metadata', style: input.style }] }] }],
      response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: 24000 },
      generation_config: { speech_config: [{ voice: input.voice }] },
    },
  });
  const audio = (result.steps ?? []).filter(step => step.type === 'model_output').flatMap(step => step.content ?? []).filter(item => item.type === 'audio').at(-1);
  if (!audio?.data) throw new Error('Geminiの応答に音声がありません');
  let buffer = Buffer.from(audio.data, 'base64');
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') {
    if (!/^audio\/(l16|pcm)(;|$)/i.test(audio.mime_type ?? '')) throw new Error('未対応の音声形式です。WAVまたはPCMが必要です');
    buffer = pcmToWav(buffer, audio.sample_rate ?? 24000);
  }
  wavInfo(buffer);
  return buffer;
}
