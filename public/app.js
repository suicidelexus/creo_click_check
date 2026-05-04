(() => {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const processBtn = document.getElementById('processBtn');
  const queueSection = document.getElementById('queue');
  const queueList = document.getElementById('queueList');
  const resultsSection = document.getElementById('results');
  const resultList = document.getElementById('resultList');
  const downloadAll = document.getElementById('downloadAll');

  /** @type {File[]} */
  let queued = [];

  function fmtSize(bytes) {
    if (!Number.isFinite(bytes)) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function renderQueue() {
    queueList.innerHTML = '';
    if (queued.length === 0) {
      queueSection.hidden = true;
      processBtn.disabled = true;
      return;
    }
    queueSection.hidden = false;
    processBtn.disabled = false;
    for (const f of queued) {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="row">
          <span class="name"></span>
          <span class="size"></span>
        </div>`;
      li.querySelector('.name').textContent = f.name;
      li.querySelector('.size').textContent = fmtSize(f.size);
      queueList.appendChild(li);
    }
  }

  function addFiles(fileList) {
    const incoming = Array.from(fileList).filter((f) => /\.zip$/i.test(f.name));
    queued = queued.concat(incoming);
    renderQueue();
  }

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => addFiles(e.target.files));

  ['dragenter', 'dragover'].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    })
  );
  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  processBtn.addEventListener('click', async () => {
    if (queued.length === 0) return;
    processBtn.disabled = true;
    processBtn.textContent = 'Обработка…';
    try {
      const fd = new FormData();
      for (const f of queued) fd.append('files', f, f.name);
      const resp = await fetch('/api/clean', { method: 'POST', body: fd });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(err.error || 'Не удалось обработать архивы');
      }
      const data = await resp.json();
      renderResults(data);
      queued = [];
      renderQueue();
    } catch (e) {
      alert(`Ошибка: ${e.message}`);
    } finally {
      processBtn.textContent = 'Обработать архивы';
      processBtn.disabled = queued.length === 0;
    }
  });

  function renderResults(data) {
    resultList.innerHTML = '';
    resultsSection.hidden = false;
    downloadAll.hidden = !(data.results && data.results.some((r) => !r.error));
    downloadAll.href = data.bulkDownloadUrl;

    for (const r of data.results) {
      const li = document.createElement('li');
      const isErr = !!r.error;
      const statusClass = isErr ? 'err' : 'ok';
      const statusLabel = isErr ? 'ошибка' : 'готово';

      const head = document.createElement('div');
      head.className = 'row';
      head.innerHTML = `
        <span class="name"></span>
        <span class="status"></span>`;
      head.querySelector('.name').textContent = r.originalName;
      head.querySelector('.status').textContent = statusLabel;
      head.querySelector('.status').classList.add(statusClass);
      li.appendChild(head);

      if (isErr) {
        const msg = document.createElement('div');
        msg.className = 'report';
        msg.textContent = r.error;
        li.appendChild(msg);
      } else {
        const bottom = document.createElement('div');
        bottom.className = 'row';

        const size = document.createElement('span');
        size.className = 'size';
        size.textContent = `${fmtSize(r.bytesIn)} → ${fmtSize(r.bytesOut)}`;
        bottom.appendChild(size);

        const actions = document.createElement('span');
        actions.className = 'actions';

        if (r.previewUrl) {
          const previewBtn = document.createElement('button');
          previewBtn.type = 'button';
          previewBtn.className = 'link-btn';
          previewBtn.textContent = 'Превью';
          actions.appendChild(previewBtn);
          actions.appendChild(document.createTextNode(' · '));

          previewBtn.addEventListener('click', () => togglePreview(li, r));
        }

        if (r.textFiles && r.textFiles.length) {
          const codeBtn = document.createElement('button');
          codeBtn.type = 'button';
          codeBtn.className = 'link-btn';
          codeBtn.textContent = 'Что удалено';
          codeBtn.addEventListener('click', () => toggleDiff(li, r));
          actions.appendChild(codeBtn);
          actions.appendChild(document.createTextNode(' · '));
        }

        const dl = document.createElement('a');
        dl.href = r.downloadUrl;
        dl.setAttribute('download', r.cleanedName);
        dl.textContent = `Скачать ${r.cleanedName}`;
        actions.appendChild(dl);
        bottom.appendChild(actions);
        li.appendChild(bottom);

        const report = document.createElement('div');
        report.className = 'report';
        report.appendChild(buildReportNode(r.report));
        li.appendChild(report);
      }

      resultList.appendChild(li);
    }
  }

  function togglePreview(li, r) {
    const existing = li.querySelector('.preview');
    if (existing) {
      existing.remove();
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'preview';

    const sizeLabel = r.adSize
      ? `${r.adSize.width} × ${r.adSize.height}`
      : 'размер из meta не определён, показываю 320 × 480';

    const head = document.createElement('div');
    head.className = 'preview-meta';
    head.innerHTML = `
      <span>Side-by-side${r.primaryHtml ? ' (' + r.primaryHtml + ')' : ''} — ${sizeLabel}</span>
      <span class="preview-actions"></span>`;
    wrap.appendChild(head);

    const w = (r.adSize && r.adSize.width) || 320;
    const h = (r.adSize && r.adSize.height) || 480;

    const grid = document.createElement('div');
    grid.className = 'preview-grid';

    const originalCol = buildColumn('Оригинал', r.originalPreviewUrl, w, h);
    const cleanedCol = buildColumn('После очистки', r.previewUrl, w, h);
    grid.appendChild(originalCol.col);
    grid.appendChild(cleanedCol.col);
    wrap.appendChild(grid);

    const actions = head.querySelector('.preview-actions');
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'link-btn';
    reload.textContent = 'Перезагрузить оба';
    reload.addEventListener('click', () => {
      originalCol.reload();
      cleanedCol.reload();
    });
    actions.appendChild(reload);

    li.appendChild(wrap);
  }

  function buildColumn(label, url, w, h) {
    const col = document.createElement('div');
    col.className = 'preview-col';

    const cap = document.createElement('div');
    cap.className = 'preview-caption';
    cap.innerHTML = `
      <span class="cap-label"></span>
      <span class="cap-actions"></span>`;
    cap.querySelector('.cap-label').textContent = label;
    col.appendChild(cap);

    const stage = document.createElement('div');
    stage.className = 'preview-stage';
    stage.style.width = w + 'px';
    stage.style.height = h + 'px';

    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.width = w;
    iframe.height = h;
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('loading', 'lazy');
    stage.appendChild(iframe);
    col.appendChild(stage);

    const open = document.createElement('a');
    open.href = url;
    open.target = '_blank';
    open.rel = 'noopener';
    open.textContent = 'В новой вкладке';
    cap.querySelector('.cap-actions').appendChild(open);

    return { col, reload: () => { iframe.src = url + '?t=' + Date.now(); } };
  }

  function toggleDiff(li, r) {
    const existing = li.querySelector('.diff');
    if (existing) {
      existing.remove();
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'diff';

    const head = document.createElement('div');
    head.className = 'diff-head';
    head.innerHTML = `
      <span class="diff-title">Было удалено</span>
      <span class="diff-controls">
        <select class="diff-file"></select>
      </span>`;
    wrap.appendChild(head);

    const select = head.querySelector('.diff-file');
    const sorted = [...r.textFiles].sort((a, b) => {
      if (a.modified !== b.modified) return a.modified ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
    for (const tf of sorted) {
      const opt = document.createElement('option');
      opt.value = tf.path;
      opt.textContent = `${tf.modified ? '● ' : '  '}${tf.path}  (${tf.kind}, ${fmtSize(tf.bytes)})`;
      select.appendChild(opt);
    }

    const body = document.createElement('div');
    body.className = 'diff-body';
    body.innerHTML = '<div class="diff-loading">Загрузка…</div>';
    wrap.appendChild(body);

    const loadFile = async () => {
      const tf = sorted.find((x) => x.path === select.value);
      if (!tf) return;
      body.innerHTML = '<div class="diff-loading">Загрузка…</div>';
      try {
        const [origText, cleanText] = await Promise.all([
          fetch(tf.originalUrl).then((x) => x.text()),
          fetch(tf.cleanedUrl).then((x) => x.text()),
        ]);
        body.innerHTML = '';
        body.appendChild(renderRemovalsList(origText, cleanText));
      } catch (e) {
        body.innerHTML = `<div class="diff-loading">Ошибка: ${e.message}</div>`;
      }
    };

    select.addEventListener('change', loadFile);

    li.appendChild(wrap);
    loadFile();
  }

  /**
   * Find lines that are present in the original but absent from the cleaned
   * file — ignoring leading/trailing whitespace differences. This filters out
   * the noise that cheerio's HTML serializer adds (re-indented whitespace
   * lines look like "removals" in a strict line-diff but carry no semantic
   * change).
   */
  function findTrueRemovals(originalText, cleanedText) {
    const cleanedSet = new Set();
    for (const line of cleanedText.split('\n')) {
      const t = line.trim();
      if (t) cleanedSet.add(t);
    }
    const removed = [];
    const origLines = originalText.split('\n');
    for (let i = 0; i < origLines.length; i++) {
      const line = origLines[i];
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (!cleanedSet.has(trimmed)) {
        removed.push({ lineNo: i + 1, content: line });
      }
    }
    return removed;
  }

  function renderRemovalsList(originalText, cleanedText) {
    const removed = findTrueRemovals(originalText, cleanedText);

    const container = document.createElement('div');
    container.className = 'removals';

    if (removed.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'removals-empty';
      empty.textContent = 'Ничего не удалено.';
      container.appendChild(empty);
      return container;
    }

    const stat = document.createElement('div');
    stat.className = 'removals-stat';
    stat.textContent = `Удалено строк: ${removed.length}`;
    container.appendChild(stat);

    // Group consecutive line numbers into blocks for readability.
    const blocks = [];
    let cur = null;
    for (const r of removed) {
      if (cur && r.lineNo === cur.end + 1) {
        cur.lines.push(r);
        cur.end = r.lineNo;
      } else {
        cur = { start: r.lineNo, end: r.lineNo, lines: [r] };
        blocks.push(cur);
      }
    }

    for (const block of blocks) {
      const blk = document.createElement('div');
      blk.className = 'removals-block';

      const header = document.createElement('div');
      header.className = 'removals-block-head';
      header.textContent = block.start === block.end
        ? `строка ${block.start}`
        : `строки ${block.start}–${block.end}`;
      blk.appendChild(header);

      const pre = document.createElement('pre');
      pre.className = 'removals-code';
      for (const r of block.lines) {
        const row = document.createElement('div');
        row.className = 'removals-row';
        row.innerHTML = '<span class="ln"></span><span class="src"></span>';
        row.querySelector('.ln').textContent = String(r.lineNo);
        row.querySelector('.src').textContent = r.content;
        pre.appendChild(row);
      }
      blk.appendChild(pre);
      container.appendChild(blk);
    }
    return container;
  }

  function buildReportNode(report) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    const totalChanges = (report.changes || []).reduce(
      (n, c) => n + ((c.actions || []).length || (c.error ? 1 : 0)),
      0
    );
    summary.textContent =
      `Файлов: ${report.totalFiles} · HTML: ${report.htmlFiles} · ` +
      `JS: ${report.jsFiles} · CSS: ${report.cssFiles} · Изменений: ${totalChanges}`;
    details.appendChild(summary);

    if (!report.changes || report.changes.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'Запрещённой кликовой логики не найдено.';
      details.appendChild(p);
      return details;
    }

    for (const c of report.changes) {
      const sec = document.createElement('div');
      sec.className = 'file-section';
      const head = document.createElement('div');
      head.className = 'fn';
      head.textContent = `${c.file} [${c.kind}]${c.error ? ' — ошибка' : ''}`;
      sec.appendChild(head);
      const ul = document.createElement('ul');
      const items = c.error ? [c.error] : (c.actions || []);
      for (const a of items) {
        const li = document.createElement('li');
        li.textContent = a;
        ul.appendChild(li);
      }
      if (c.warning) {
        const li = document.createElement('li');
        li.textContent = c.warning;
        ul.appendChild(li);
      }
      sec.appendChild(ul);
      details.appendChild(sec);
    }
    return details;
  }
})();
