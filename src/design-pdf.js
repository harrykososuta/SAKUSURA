const $ = id => document.getElementById(id);

// アップロード・表示はこのPC内で完結する。ファイルを選んだだけでは外部APIへ送らない。
export function createPdfReference({ onChange = () => {}, onBusy = () => {}, canPreviewSlide = () => true } = {}) {
  let metadata = null, busy = false;
  const fileInput = $('reference-pdf-input');
  $('choose-reference-pdf').addEventListener('click', () => { if (!busy) fileInput.click(); });
  function setBusy(value) { busy = value; fileInput.disabled = value; $('choose-reference-pdf').disabled = value; $('remove-reference').disabled = value; onBusy(); }
  function show(mode) {
    if (mode === 'slide' && !canPreviewSlide()) mode = metadata ? 'pdf' : 'empty';
    $('import-preview-empty').hidden = mode !== 'empty';
    $('slide-preview-pane').hidden = mode !== 'slide';
    $('reference-preview-pane').hidden = mode !== 'pdf';
    $('show-slide-preview').setAttribute('aria-selected', String(mode === 'slide'));
    $('show-reference-pdf').setAttribute('aria-selected', String(mode === 'pdf'));
  }
  function display(value, open = false) {
    metadata = value;
    $('reference-info').hidden = !value; $('reference-tabs').hidden = !value;
    $('reference-filename').textContent = value?.name ?? '';
    $('reference-size').textContent = value ? (value.size < 1024 * 1024 ? `${Math.ceil(value.size / 1024)} KB` : `${(value.size / 1024 / 1024).toFixed(2)} MB`) : '';
    if (value) {
      const url = `/api/design-pdfs/file?id=${encodeURIComponent(value.id)}`;
      $('reference-pdf-frame').src = `${url}#view=${document.body.classList.contains('pdf-import-mode') ? 'Fit' : 'FitH'}`;
      $('open-reference-pdf').href = url;
    } else { $('reference-pdf-frame').removeAttribute('src'); show('slide'); }
    if (open) show('pdf');
  }
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]; if (!file || busy) return;
    $('reference-error').hidden = true;
    if (!/\.pdf$/i.test(file.name) || file.size > 10 * 1024 * 1024 || !file.size) {
      $('reference-error').textContent = '10MB以内のPDFファイルを選んでください。'; $('reference-error').hidden = false; fileInput.value = ''; return;
    }
    setBusy(true); $('reference-status').textContent = 'PDFをアップロードしています…';
    try {
      const response = await fetch('/api/design-pdfs', { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-Studio-Editor': '1', 'X-File-Name': encodeURIComponent(file.name) }, body: file });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'PDFを追加できません。');
      display(result, true); $('reference-status').textContent = document.body.classList.contains('pdf-import-mode') ? 'PDFを追加しました。「取り込んで編集する」で編集を始められます。' : 'PDFを追加しました。保存するとデザインに紐づきます。';
      onChange(metadata);
    } catch (failure) { $('reference-error').textContent = failure.message; $('reference-error').hidden = false; $('reference-status').textContent = ''; }
    finally { setBusy(false); fileInput.value = ''; }
  });
  $('remove-reference').addEventListener('click', () => { if (busy) return; display(null); $('reference-status').textContent = '参考PDFの選択を外しました。'; onChange(null); });
  $('show-slide-preview').addEventListener('click', () => show('slide'));
  $('show-reference-pdf').addEventListener('click', () => { if (metadata) show('pdf'); });
  return {
    get id() { return metadata?.id ?? null; }, get name() { return metadata?.name ?? ''; }, get busy() { return busy; }, show,
    async restore(id) {
      if (!id) { display(null); return; }
      const response = await fetch(`/api/design-pdfs?id=${encodeURIComponent(id)}`, { cache: 'no-store' }), result = await response.json();
      if (!response.ok) throw new Error(result.error || '参考PDFを読み込めません。');
      display(result); $('reference-status').textContent = '保存済みの参考PDFです。';
    },
  };
}
