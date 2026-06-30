(() => {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const processBtn = document.getElementById('processBtn');
  const queueList = document.getElementById('queueList');
  const downloadAll = document.getElementById('downloadAll');
  const detailPane = document.getElementById('detailPane');
  const summaryChips = document.getElementById('summaryChips');

  // ---- state (contract for later tasks) ----
  let queued = [];         // File[]
  let results = [];        // server results, each tagged with _status
  let selectedId = null;
  let batchSummary = null;

  function fmtSize(bytes) {
    if (!Number.isFinite(bytes)) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function pendingRow(f) {
    const li = document.createElement('li');
    li.className = 'row-item is-pending';
    li.innerHTML = `
      <span class="row-status"><span class="dot dot-pending"></span></span>
      <span class="row-main">
        <span class="row-name"></span>
        <span class="row-meta"></span>
      </span>`;
    li.querySelector('.row-name').textContent = f.name;
    li.querySelector('.row-meta').textContent = fmtSize(f.size);
    return li;
  }

  // Pending-only version. REPLACED by the unified renderer in Task 3.
  function renderList() {
    queueList.innerHTML = '';
    for (const f of queued) queueList.appendChild(pendingRow(f));
    const n = queued.length;
    processBtn.disabled = n === 0;
    processBtn.textContent = n === 0 ? 'Обработать' : `Обработать (${n})`;
  }

  function addFiles(fileList) {
    const incoming = Array.from(fileList).filter((f) => /\.zip$/i.test(f.name));
    queued = queued.concat(incoming);
    renderList();
  }

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => { addFiles(e.target.files); fileInput.value = ''; });

  ['dragenter', 'dragover'].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  function countClicksRemoved(r) {
    if (!r || !r.report || !r.report.changes) return 0;
    return r.report.changes.reduce((n, c) => n + ((c.actions || []).length), 0);
  }

  function renderSummary() {
    if (!batchSummary) { summaryChips.hidden = true; summaryChips.innerHTML = ''; return; }
    summaryChips.hidden = false;
    summaryChips.innerHTML = `
      <span class="chip"><svg class="ic"><use href="#ic-check"/></svg> креосов: ${batchSummary.creatives}</span>
      <span class="chip accent"><svg class="ic"><use href="#ic-scissors"/></svg> кликов вырезано: ${batchSummary.clicksRemoved}</span>`;
  }

  function skeletonRow(name) {
    const li = document.createElement('li');
    li.className = 'row-item is-skeleton';
    li.innerHTML = `
      <span class="row-status"><span class="dot dot-pending"></span></span>
      <span class="row-main">
        <span class="row-name"></span>
        <span class="sk sk-line"></span>
      </span>`;
    li.querySelector('.row-name').textContent = name;
    return li;
  }

  function resultRow(r) {
    const li = document.createElement('li');
    const isErr = !!r.error;
    li.className = 'row-item ' + (isErr ? 'is-err' : 'is-ok');
    if (r.id === selectedId) li.classList.add('is-active');
    li.innerHTML = `
      <span class="row-status"><span class="dot ${isErr ? 'dot-err' : 'dot-ok'}"></span></span>
      <span class="row-main">
        <span class="row-name"></span>
        <span class="row-meta"></span>
      </span>`;
    li.querySelector('.row-name').textContent = r.originalName;
    li.querySelector('.row-meta').textContent = isErr
      ? 'ошибка'
      : `${fmtSize(r.bytesIn)} → ${fmtSize(r.bytesOut)}`;
    li.addEventListener('click', () => selectResult(r.id));
    return li;
  }

  // Unified renderer: processed results first, then pending queued files.
  // Overwrites the pending-only renderList from Task 2.
  renderList = function () {
    queueList.innerHTML = '';
    for (const r of results) queueList.appendChild(resultRow(r));
    for (const f of queued) queueList.appendChild(pendingRow(f));
    const n = queued.length;
    processBtn.disabled = n === 0;
    processBtn.textContent = n === 0 ? 'Обработать' : `Обработать (${n})`;
  };

  async function processBatch() {
    if (queued.length === 0) return;
    const names = queued.map((f) => f.name);
    processBtn.disabled = true;
    processBtn.textContent = 'Обработка…';

    // skeletons
    queueList.innerHTML = '';
    for (const n of names) queueList.appendChild(skeletonRow(n));

    try {
      const fd = new FormData();
      for (const f of queued) fd.append('files', f, f.name);
      const resp = await fetch('/api/clean', { method: 'POST', body: fd });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(err.error || 'Не удалось обработать архивы');
      }
      const data = await resp.json();
      const fresh = data.results.map((r) => ({ ...r, _status: r.error ? 'err' : 'ok' }));
      results = results.concat(fresh);   // append, never wipe previous batches
      queued = [];

      // Summary reflects everything currently on screen (all processed results).
      batchSummary = {
        creatives: results.filter((r) => !r.error).length,
        clicksRemoved: results.reduce((n, r) => n + countClicksRemoved(r), 0),
      };

      // download-all points at the latest batch (server batches are independent).
      downloadAll.hidden = !fresh.some((r) => !r.error);
      downloadAll.href = data.bulkDownloadUrl;

      renderList();
      renderSummary();

      // Auto-select the first ready creative from THIS batch (fallback to first row).
      const firstReady = fresh.find((r) => !r.error) || fresh[0];
      selectResult(firstReady ? firstReady.id : null);
    } catch (e) {
      // inline error: keep queued + previous results intact, show error inline.
      renderList();
      detailPane.innerHTML = `
        <div class="empty-state">
          <svg class="ic ic-xl" style="color:var(--danger)"><use href="#ic-alert"/></svg>
          <p class="empty-title">Не удалось обработать</p>
          <p class="empty-hint"></p>
        </div>`;
      detailPane.querySelector('.empty-hint').textContent = e.message;
    } finally {
      processBtn.textContent = queued.length ? `Обработать (${queued.length})` : 'Обработать';
      processBtn.disabled = queued.length === 0;
    }
  }

  processBtn.addEventListener('click', processBatch);

  // Temporary stub — replaced by full detail renderer in Task 4.
  function selectResult(id) {
    selectedId = id;
    renderList();
    const r = results.find((x) => x.id === id);
    detailPane.innerHTML = '';
    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.textContent = r ? JSON.stringify({ name: r.originalName, error: r.error || null }, null, 2) : 'нет данных';
    detailPane.appendChild(pre);
  }

  renderList();
})();
