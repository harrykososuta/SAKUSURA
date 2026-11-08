import { argumentValue } from './lib/project.mjs';
import { createDesignStore } from './lib/design-store.mjs';
import { createPdfDesignStore, pdfSourceFor } from './lib/pdf-design-store.mjs';
try {
  const store = createDesignStore(), entry = await store.get(argumentValue(process.argv, '--theme'));
  if (entry.builtin || !entry.referencePdfId) throw Object.assign(new Error('参考PDFのある保存済みプリセットを指定してください。'), { status: 422 });
  const manifest = await createPdfDesignStore().prepare(entry.referencePdfId);
  if (entry.design.pdfSource?.pdfId === entry.referencePdfId) { console.log('PDF原本の取り込みは完了済みです。保存済みの文字とページの編集を保持しました。'); process.exit(0); }
  const design = structuredClone(entry.design); design.pdfSource = pdfSourceFor(entry.referencePdfId, manifest);
  design.description = '元PDFの各ページの配置・図版・罫線・文字を保持。ページごとに文字を差し替え、位置とサイズを編集できるPDF原本デザイン。';
  await store.change({ op: 'update', id: entry.id, revision: entry.revision, design });
  console.log(`PDF原本の${manifest.pages.length}ページに切り替えました。変更前のプリセットはbackupsに保存しています。`);
} catch (error) { console.error(error.status ? error.message : 'PDFのデザインを取り込めません。変換環境と元ファイルを確認してください。'); process.exitCode = 1; }
