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

  // processBtn handler added in Task 3.
  renderList();
})();
