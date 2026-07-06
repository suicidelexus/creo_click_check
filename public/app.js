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
      </span>
      <button class="row-x" type="button" title="Убрать из очереди" aria-label="Убрать из очереди"><svg class="ic"><use href="#ic-x"/></svg></button>`;
    li.querySelector('.row-name').textContent = f.name;
    li.querySelector('.row-meta').textContent = fmtSize(f.size);
    li.querySelector('.row-x').addEventListener('click', (e) => { e.stopPropagation(); removeQueued(f); });
    return li;
  }

  // Drop a not-yet-processed file from the queue.
  function removeQueued(f) {
    queued = queued.filter((x) => x !== f);
    renderList();
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
      </span>
      <button class="row-x" type="button" title="Убрать из сервиса" aria-label="Убрать из сервиса"><svg class="ic"><use href="#ic-x"/></svg></button>`;
    li.querySelector('.row-name').textContent = r.originalName;
    li.querySelector('.row-meta').textContent = isErr
      ? 'ошибка'
      : `${fmtSize(r.bytesIn)} → ${fmtSize(r.bytesOut)}`;
    li.addEventListener('click', () => selectResult(r.id));
    li.querySelector('.row-x').addEventListener('click', (e) => { e.stopPropagation(); removeResult(r.id); });
    return li;
  }

  // Drop a processed creative from the session: recompute the summary, keep a
  // sensible selection, and hide download-all if nothing downloadable remains.
  function removeResult(id) {
    const idx = results.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const wasSelected = selectedId === id;
    results.splice(idx, 1);

    batchSummary = results.length
      ? {
          creatives: results.filter((r) => !r.error).length,
          clicksRemoved: results.reduce((n, r) => n + countClicksRemoved(r), 0),
        }
      : null;

    if (!results.some((r) => !r.error)) downloadAll.hidden = true;

    if (wasSelected) {
      const next = results.find((r) => !r.error) || results[0] || null;
      selectedId = next ? next.id : null;
    }

    renderList();
    renderSummary();
    renderDetail();
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

  const KIND_BADGES = {
    'a-to-div': { label: 'replace', cls: 'b-replace' },
    'attr-removed': { label: 'attr', cls: 'b-remove' },
    'inline-script-edit': { label: 'js', cls: 'b-remove' },
    'inline-style-edit': { label: 'css', cls: 'b-remove' },
    'inline-script-parse-error': { label: 'parse', cls: 'b-warn' },
    'js-edit': { label: 'js', cls: 'b-remove' },
    'css-rule-removed': { label: 'css', cls: 'b-remove' },
    'warning': { label: 'warn', cls: 'b-warn' },
    'error': { label: 'error', cls: 'b-warn' },
    'legacy': { label: 'edit', cls: 'b-remove' },
  };

  function normalizeAction(a) {
    if (typeof a === 'string') return { kind: 'legacy', reason: a, snippet: '', replacement: '' };
    return {
      kind: a.kind || 'edit',
      reason: a.reason || '',
      snippet: a.snippet || '',
      replacement: a.replacement || '',
    };
  }

  function actionsByFileMap(r) {
    const map = new Map();
    for (const change of (r.report && r.report.changes) || []) {
      if (!map.has(change.file)) map.set(change.file, []);
      const bucket = map.get(change.file);
      for (const a of (change.actions || [])) bucket.push(normalizeAction(a));
      if (change.warning) bucket.push({ kind: 'warning', reason: change.warning, snippet: '', replacement: '' });
      if (change.error) bucket.push({ kind: 'error', reason: change.error, snippet: '', replacement: '' });
    }
    return map;
  }

  function actionCard(a) {
    const card = document.createElement('div');
    card.className = 'act-card';
    const meta = KIND_BADGES[a.kind] || { label: a.kind || 'edit', cls: 'b-remove' };
    const head = document.createElement('div');
    head.className = 'act-head';
    head.innerHTML = `<span class="badge ${meta.cls}"></span><span class="act-title"></span>`;
    head.querySelector('.badge').textContent = meta.label;
    head.querySelector('.act-title').textContent = a.reason || a.kind || 'edit';
    card.appendChild(head);
    if (a.snippet) {
      const row = document.createElement('div'); row.className = 'snip snip-rm';
      const code = document.createElement('pre'); code.className = 'snip-code'; code.textContent = a.snippet;
      row.innerHTML = '<span class="snip-sign">−</span>'; row.appendChild(code);
      card.appendChild(row);
    }
    if (a.replacement) {
      const row = document.createElement('div'); row.className = 'snip snip-add';
      const code = document.createElement('pre'); code.className = 'snip-code'; code.textContent = a.replacement;
      row.innerHTML = '<span class="snip-sign">+</span>'; row.appendChild(code);
      card.appendChild(row);
    }
    return card;
  }

  function buildColumn(label, url, w, h) {
    const col = document.createElement('div'); col.className = 'pv-col';
    const cap = document.createElement('div'); cap.className = 'pv-cap';
    cap.innerHTML = '<span class="pv-label"></span><a class="pv-open" target="_blank" rel="noopener">в новой вкладке</a>';
    cap.querySelector('.pv-label').textContent = label;
    cap.querySelector('.pv-open').href = url;
    col.appendChild(cap);
    const stage = document.createElement('div'); stage.className = 'pv-stage';
    stage.style.width = w + 'px'; stage.style.height = h + 'px';
    const iframe = document.createElement('iframe');
    iframe.src = url; iframe.width = w; iframe.height = h;
    iframe.setAttribute('sandbox', 'allow-scripts'); iframe.setAttribute('loading', 'lazy');
    stage.appendChild(iframe); col.appendChild(stage);
    return { col, reload: () => { iframe.src = url + '?t=' + Date.now(); } };
  }

  function renderDetail() {
    const r = results.find((x) => x.id === selectedId);
    detailPane.innerHTML = '';
    if (!r) {
      detailPane.innerHTML = `
        <div class="empty-state">
          <svg class="ic ic-xl"><use href="#ic-scissors"/></svg>
          <p class="empty-title">Здесь появится разбор креатива</p>
          <p class="empty-hint">Выберите креатив из списка слева.</p>
        </div>`;
      return;
    }
    if (r.error) {
      detailPane.innerHTML = `
        <div class="empty-state">
          <svg class="ic ic-xl" style="color:var(--danger)"><use href="#ic-alert"/></svg>
          <p class="empty-title"></p>
          <p class="empty-hint"></p>
        </div>`;
      detailPane.querySelector('.empty-title').textContent = r.originalName;
      detailPane.querySelector('.empty-hint').textContent = r.error;
      return;
    }

    // header row: name + download
    const head = document.createElement('div'); head.className = 'detail-head';
    head.innerHTML = `<div class="detail-title"></div>
      <a class="btn btn-primary" download><svg class="ic"><use href="#ic-download"/></svg> Скачать</a>`;
    head.querySelector('.detail-title').textContent = r.originalName;
    const dl = head.querySelector('a.btn'); dl.href = r.downloadUrl; dl.setAttribute('download', r.cleanedName);
    detailPane.appendChild(head);

    // preview
    if (r.previewUrl) {
      const w = (r.adSize && r.adSize.width) || 320;
      const h = (r.adSize && r.adSize.height) || 480;
      const block = document.createElement('section'); block.className = 'pv-block';
      const cap = document.createElement('div'); cap.className = 'block-cap';
      cap.innerHTML = `<span><svg class="ic"><use href="#ic-eye"/></svg> Превью</span><span class="block-sub"></span>`;
      cap.querySelector('.block-sub').textContent = `${w} × ${h}`;
      block.appendChild(cap);
      const grid = document.createElement('div'); grid.className = 'pv-grid';
      grid.appendChild(buildColumn('Оригинал', r.originalPreviewUrl, w, h).col);
      grid.appendChild(buildColumn('После очистки', r.previewUrl, w, h).col);
      block.appendChild(grid);
      detailPane.appendChild(block);
    }

    // diff
    const diff = document.createElement('section'); diff.className = 'diff-block';
    const dcap = document.createElement('div'); dcap.className = 'block-cap';
    dcap.innerHTML = `<span><svg class="ic"><use href="#ic-scissors"/></svg> Что вырезано</span>`;
    diff.appendChild(dcap);

    const map = actionsByFileMap(r);
    const files = [...(r.textFiles || [])].sort((a, b) => {
      const am = map.has(a.path), bm = map.has(b.path);
      if (am !== bm) return am ? -1 : 1;
      return a.path.localeCompare(b.path);
    });

    const select = document.createElement('select'); select.className = 'diff-file';
    for (const tf of files) {
      const opt = document.createElement('option'); opt.value = tf.path;
      const count = (map.get(tf.path) || []).length;
      opt.textContent = `${count > 0 ? '● ' + count + ' ' : '  '}${tf.path} (${tf.kind}, ${fmtSize(tf.bytes)})`;
      select.appendChild(opt);
    }
    if (files.length > 1) diff.appendChild(select);

    const body = document.createElement('div'); body.className = 'diff-body';
    diff.appendChild(body);

    const renderFor = () => {
      const path = select.value || (files[0] && files[0].path);
      const acts = map.get(path) || [];
      body.innerHTML = '';
      if (!acts.length) {
        const e = document.createElement('p'); e.className = 'diff-empty';
        e.textContent = 'В этом файле ничего не вырезано.'; body.appendChild(e); return;
      }
      const stat = document.createElement('p'); stat.className = 'diff-stat';
      stat.textContent = `Действий: ${acts.length}`; body.appendChild(stat);
      for (const a of acts) body.appendChild(actionCard(a));
    };
    select.addEventListener('change', renderFor);
    detailPane.appendChild(diff);
    renderFor();
  }

  function selectResult(id) {
    selectedId = id;
    renderList();
    renderDetail();
  }

  renderList();
})();
