// Claude Code PostToolUse フック：lectures/<slug>/lecture.json を編集した直後に構成・デザイン規格・cueを検査する。
// エラーは終了コード2で返し、Claudeがその場で修正できるようにする。APIは呼ばない。
import { checkLecture } from '../qa.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
try {
  const path = JSON.parse(input || '{}').tool_input?.file_path ?? '';
  const match = path.replaceAll('\\', '/').match(/\/lectures\/([a-z0-9][a-z0-9_-]{0,63})\/lecture\.json$/);
  if (match) {
    const report = await checkLecture(match[1]);
    if (!report.passed) {
      console.error(`lecture.json の検査で ${report.errors.length} 件のエラー（lectures/${match[1]}）:\n${report.errors.map(message => `- ${message}`).join('\n')}`);
      process.exitCode = 2;
    }
  }
} catch (error) {
  console.error(`lecture.json を検査できません: ${error.message}`);
  process.exitCode = 2;
}
