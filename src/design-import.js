const $ = id => document.getElementById(id);

export function createDesignImport({ pdfReference, getDraft, onComplete, onSaved }) {
  let task = null, checking = false, timer, creating = false, completed = false;
  const button = $('save-design');
  function steps(active) {
    ['upload', 'cli', 'done'].forEach((name, index) => {
      const step = $(`import-step-${name}`);
      if (index === active) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
      step.dataset.done = String(index < active);
    });
  }
  function updateButton() {
    button.disabled = creating || !!task || pdfReference.busy || !pdfReference.id;
    document.body.dataset.importPreview = completed ? 'complete' : 'pending';
    $('editor-preview-overline').textContent = completed ? 'LIVE PREVIEW' : 'PREVIEW';
    $('editor-preview-heading').textContent = completed ? '作成したプリセット' : pdfReference.id ? '参考PDF' : 'プレビュー';
    $('show-slide-preview').hidden = !completed; $('show-slide-preview').disabled = !completed;
    $('draft-state').textContent = completed ? 'プリセット保存済み' : task ? 'CLIの作業完了待ち' : pdfReference.busy ? 'PDF保存中…' : pdfReference.id ? 'プリセット未作成' : 'PDF未選択';
  }
  function display(value) {
    task = value; completed = value.status === 'complete';
    $('import-handoff').hidden = false;
    $('import-prompt').value = value.prompt;
    $('import-folder').textContent = value.folder;
    $('import-progress').textContent = completed ? `「${value.entry.design.name}」を保存しました。スライドの見本に反映しました。` : 'PDFの保存が完了しました。次は、依頼文をCLIに貼り付けてプリセットを作成してください。';
    steps(completed ? 2 : 1);
    button.textContent = completed ? '保存完了' : 'PDF保存済み'; updateButton();
    $('reference-pdf-input').disabled = true; $('remove-reference').hidden = true;
    $('reference-pdf-input').closest('label').hidden = true; $('reference-upload-hint').hidden = true;
    $('reference-status').textContent = 'PDFと依頼書をデザイン用フォルダーに保存済みです。';
    $('editor-cancel').textContent = 'デザイン一覧へ';
    $('draft-state').textContent = completed ? 'プリセット保存済み' : 'CLIの作業完了待ち';
    if (completed) {
      $('import-instructions').hidden = true;
      clearTimeout(timer);
      $('import-result-link').href = `/design/detail?theme=${encodeURIComponent(value.entry.id)}`;
      $('import-result-link').hidden = false;
      $('refresh-import').hidden = true;
      $('copy-import-prompt').hidden = true;
      onComplete(value.entry);
    } else pdfReference.show('pdf');
  }
  async function check(manual = false) {
    if (!task || checking || completed) return;
    checking = true; clearTimeout(timer);
    try {
      const response = await fetch(`/api/design-imports?id=${encodeURIComponent(task.id)}`, { cache: 'no-store' });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      if (result.status === 'complete') { display(result); $('import-feedback').textContent = '作成したプリセットを反映しました。'; }
      else if (manual) $('import-feedback').textContent = 'まだ完了していません。CLIで依頼書の最後にある完了コマンドまで実行してください。';
    } catch (error) { $('import-feedback').textContent = error.message || '完了を確認できません。サーバーを確認して「完了を確認」を押してください。'; }
    finally { checking = false; if (!completed) timer = setTimeout(() => check(), 2500); }
  }
  async function start(event) {
    event.preventDefault(); if (creating || task || !pdfReference.id || pdfReference.busy) return;
    creating = true; updateButton(); $('editor-error').hidden = true;
    try {
      $('import-progress').textContent = 'PDFのページと文字を取り込んでいます…';
      button.textContent = '取り込み中…';
      const response = await fetch('/api/design-imports', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Editor': '1' }, body: JSON.stringify({ referencePdfId: pdfReference.id, design: getDraft(), finishPdf: true }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      onSaved(); display(result);
      const url = new URL(location.href); url.searchParams.set('task', result.id); history.replaceState(null, '', url);
      $('import-handoff').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      check();
    } catch (error) { $('editor-error').textContent = error.message || '作業を保存できません。'; $('editor-error').hidden = false; }
    finally { creating = false; if (!task) button.textContent = '取り込んで編集する'; updateButton(); }
  }
  button.removeAttribute('form'); button.type = 'button'; button.textContent = '取り込んで編集する'; button.addEventListener('click', start);
  $('pdf-import-workflow').hidden = false; document.body.classList.add('pdf-import-mode');
  $('editor-lead').textContent = 'PDFを追加すると、そのページの文字・位置・サイズを編集できます。';
  $('import-step-upload').lastChild.textContent = ' PDFを追加'; $('import-step-cli').lastChild.textContent = ' ページを編集'; $('import-step-done').lastChild.textContent = ' デザインを保存';
  $('import-progress').textContent = 'PDFを選び、「取り込んで編集する」を押してください。';
  $('reference-upload-hint').textContent = '10MB以内・1〜60ページ。PDFの配置や図版をそのまま使います。';
  $('pdf-reference-section').querySelector('h2').textContent = 'PDFを追加';
  pdfReference.show('slide');
  $('refresh-import').addEventListener('click', () => check(true));
  $('copy-import-prompt').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('import-prompt').value); $('import-feedback').textContent = 'コピーしました。エディターやCLIのAIチャットに貼り付けて実行してください。'; }
    catch { $('import-prompt').focus(); $('import-prompt').select(); $('import-feedback').textContent = '依頼文を選択しました。Ctrl+C（Macは⌘C）でコピーしてください。'; }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('pagehide', () => clearTimeout(timer));
  return {
    updateButton,
    async restore(id) {
      const response = await fetch(`/api/design-imports?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || '作業を読み込めません。');
      await pdfReference.restore(result.referencePdfId); onSaved(); display(result); if (!completed) check();
    },
  };
}
