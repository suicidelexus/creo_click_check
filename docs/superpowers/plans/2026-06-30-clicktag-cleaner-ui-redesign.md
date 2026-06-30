# ClickTag Cleaner — UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default GitHub-dark single-page UI with a polished, light, two-pane "workspace" interface (FocusFlow style: lime/indigo, soft cards, glass background), keeping all behavior and the backend untouched.

**Architecture:** Pure frontend rewrite of the three files in `public/` (`index.html`, `style.css`, `app.js`). The Express backend, cleaner logic, API contract, and Render deploy stay exactly as-is. No build step, no new dependencies. Verification is manual (run server + observe browser) plus keeping the backend test suite green.

**Tech Stack:** Vanilla HTML/CSS/JS, served statically by Express. System font stack. Inline SVG icons. No frameworks, no bundler, no external fonts.

## Global Constraints

- DO NOT modify `server.js`, `src/cleaner/*`, `tests/*`, or `package.json`. No new dependencies, no build step.
- Light theme. Base background: white-mint. Primary: indigo `#6c5ce7`. Success/accent: lime-green `#a3e635` (soft badge bg `#d9f99d`). Danger: coral `#fb7185`.
- Background image `public/assets/bg-creo.png` (already in repo, 2.5MB) used as `position: fixed`, full-bleed, ~12–18% opacity, with a white-ish gradient overlay so content stays readable.
- Cards: white (optionally light glass via `backdrop-filter: blur`), border-radius `20px`, soft shadow `0 4px 24px rgba(80,70,160,.08)`, hairline border `1px solid rgba(0,0,0,.04)`.
- System font stack only: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`. No Google Fonts.
- Layout: two-pane workspace. Left column fixed ~340px (dropzone + `Обработать (N)` button + creative list + sticky "download all"). Right column flexible (preview side-by-side + "что вырезано" diff + download + empty state). Header on top.
- Flow: manual trigger — user drops/selects zips, then clicks `Обработать`. NO auto-process on drop. Skeletons during processing. Inline errors (no `alert()`). Auto-select first ready creative after processing.
- Copy must reflect true purpose: cleaning HTML5 creatives to meet programmatic-DSP (Hybrid) requirements — removing click-through events — NOT "for Yandex".
- API contract (unchanged), consumed by `app.js`:
  - `POST /api/clean` (multipart `files`) → `{ batchId, bulkDownloadUrl, results[] }`, whole batch at once.
  - result: `{ id, originalName, cleanedName, bytesIn, bytesOut, error?, downloadUrl, previewUrl, originalPreviewUrl, primaryHtml, adSize:{width,height}?, textFiles:[{path,kind,bytes,originalUrl,cleanedUrl}], report:{totalFiles,htmlFiles,jsFiles,cssFiles,primaryHtml,adSize,changes:[{file,kind,actions[],warning,error}]} }`
  - `GET /api/download/:batchId/:archiveId`, `GET /api/download-all/:batchId`, `GET /api/preview[-original]/:batchId/:archiveId/*`
- Responsive: at `<900px` columns stack vertically (list on top, detail below). Desktop is the priority; layout must not break on narrow.

---

## File Structure

- **Modify:** `public/index.html` — new two-pane markup, header with copy + batch-summary chips, left column (dropzone/button/list/download-all), right column (detail), inline SVG icon `<symbol>` sprite, empty-state markup.
- **Modify:** `public/style.css` — full light design system: tokens, fixed background + overlay, layout grid, cards, dropzone, buttons, list rows + status chips, skeletons, preview, diff cards, responsive.
- **Modify:** `public/app.js` — state model (queued files + processed results + selected id), queue rendering, process flow (fetch + skeletons + inline errors), list rendering with statuses, detail-pane rendering (preview + diff), selection handling, batch summary.
- **Use (already present):** `public/assets/bg-creo.png`.

State shape used across `app.js` tasks (defined in Task 2, consumed by 3 & 4):

```js
// module-level state
let queued = [];        // File[] awaiting processing
let results = [];       // server result objects (with extra _status field)
let selectedId = null;  // results[].id currently shown in detail pane
let batchSummary = null;// { creatives: number, clicksRemoved: number }
```

Key functions (names are the cross-task contract):
- `renderList()` — Task 2 (pending-only), REPLACED in Task 3 (unified). Renders the single left list = processed `results` rows first, then `queued` pending rows; also toggles the process button text/disabled. There is ONE list container (`#queueList`); queue and results never use separate containers.
- `addFiles(fileList)` — Task 2. Appends `.zip` files to `queued`, calls `renderList()`.
- `processBatch()` — Task 3. POSTs the `queued` files, sets skeletons, APPENDS new server results to `results`, clears `queued`, calls `renderList()` + `renderSummary()` + `selectResult(firstReadyId)`. On error: keeps `queued` and `results` intact, shows the error inline in the detail pane.
- `selectResult(id)` — Task 4. Sets `selectedId`, calls `renderDetail()`, updates active row.
- `renderDetail()` — Task 4. Renders right pane for `selectedId` (preview + diff + download) or empty state.
- `renderSummary()` — Task 3. Renders header chips from `batchSummary`.
- `fmtSize(bytes)` — Task 2. Reused size formatter (port verbatim from current app.js).
- `countClicksRemoved(result)` — Task 3. Sums `report.changes[].actions.length` across results.

---

## Pre-flight: branch

- [ ] **Step 0: Create a working branch** (repo default branch should not receive direct commits)

```bash
cd ~/Desktop/GitHub/creo_click_check
git checkout -b ui-redesign
```

---

## Task 1: Layout shell — HTML structure + CSS design system (static)

Deliverable: page loads with the new two-pane shell, fixed glass background visible, header copy correct, empty states in both columns. No JS behavior yet (old app.js still loaded but harmless against new IDs — we replace markup so old handlers no-op; we fully rewrite app.js in Task 2). Backend untouched.

**Files:**
- Modify: `public/index.html`
- Modify: `public/style.css`

**Interfaces:**
- Produces (DOM IDs consumed by later tasks): `#dropzone`, `#fileInput`, `#processBtn`, `#queueList`, `#creativeList`, `#downloadAll`, `#detailPane`, `#summaryChips`.

- [ ] **Step 1: Rewrite `public/index.html`**

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ClickTag Cleaner — очистка HTML5-креативов под требования DSP</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <!-- Inline SVG sprite: all icons referenced via <use href="#ic-..."> -->
  <svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <symbol id="ic-logo" viewBox="0 0 24 24"><path fill="currentColor" d="M5 5l14 14M19 5L5 19" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></symbol>
    <symbol id="ic-drop" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 16V4m0 0l-4 4m4-4l4 4M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2"/></symbol>
    <symbol id="ic-download" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 18v1a1 1 0 001 1h14a1 1 0 001-1v-1"/></symbol>
    <symbol id="ic-scissors" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5L20 18M8 16.5L20 6"/></g></symbol>
    <symbol id="ic-check" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></symbol>
    <symbol id="ic-alert" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 8v5m0 3h.01M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></symbol>
    <symbol id="ic-eye" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></g></symbol>
  </svg>

  <header class="topbar">
    <div class="brand">
      <span class="brand-mark"><svg class="ic"><use href="#ic-logo"/></svg></span>
      <span class="brand-text">
        <span class="brand-name">ClickTag Cleaner</span>
        <span class="brand-sub">Чистим HTML5-креативы под требования программатик-DSP (Hybrid): убираем переходы по клику на баннер</span>
      </span>
    </div>
    <div class="summary" id="summaryChips" hidden></div>
  </header>

  <main class="workspace">
    <!-- LEFT -->
    <aside class="col-left">
      <section class="dropzone" id="dropzone">
        <svg class="ic ic-lg"><use href="#ic-drop"/></svg>
        <p class="dz-text">Перетащите ZIP-архивы сюда<br>или нажмите, чтобы выбрать</p>
        <p class="dz-hint">Несколько архивов сразу · до 50 МБ каждый</p>
        <input type="file" id="fileInput" accept=".zip,application/zip,application/x-zip-compressed" multiple hidden>
      </section>

      <button class="btn btn-primary btn-block" id="processBtn" disabled>Обработать</button>

      <div class="creative-list" id="creativeList">
        <ul id="queueList"></ul>
      </div>

      <a class="btn btn-ghost btn-block downloadall" id="downloadAll" href="#" hidden>
        <svg class="ic"><use href="#ic-download"/></svg> Скачать всё одним архивом
      </a>
    </aside>

    <!-- RIGHT -->
    <section class="col-right">
      <div class="detail" id="detailPane">
        <div class="empty-state">
          <svg class="ic ic-xl"><use href="#ic-scissors"/></svg>
          <p class="empty-title">Здесь появится разбор креатива</p>
          <p class="empty-hint">Закиньте архивы слева и нажмите «Обработать», затем выберите креатив из списка.</p>
        </div>
      </div>
    </section>
  </main>

  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Rewrite `public/style.css` — tokens, background, layout shell, header, dropzone, buttons, empty state**

```css
:root {
  --bg: #f4faf6;
  --card: #ffffff;
  --card-glass: rgba(255,255,255,.92);
  --border: rgba(20,20,40,.06);
  --text: #1c2230;
  --muted: #6b7280;
  --primary: #6c5ce7;
  --primary-d: #5a4bd4;
  --primary-soft: #efedff;
  --accent: #a3e635;
  --accent-soft: #d9f99d;
  --danger: #fb7185;
  --danger-soft: #ffe4e6;
  --radius: 20px;
  --radius-sm: 12px;
  --shadow: 0 4px 24px rgba(80,70,160,.08);
  --shadow-sm: 0 2px 10px rgba(80,70,160,.06);
}

* { box-sizing: border-box; }

html, body {
  margin: 0; padding: 0;
  min-height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 15px; line-height: 1.5;
}

/* Fixed glass background image + readability overlay */
body::before {
  content: "";
  position: fixed; inset: 0;
  background: url("/assets/bg-creo.png") center/cover no-repeat;
  opacity: .15;
  z-index: -2;
}
body::after {
  content: "";
  position: fixed; inset: 0;
  background: linear-gradient(180deg, rgba(255,255,255,.55), rgba(244,250,246,.8));
  z-index: -1;
}

.ic { width: 20px; height: 20px; display: inline-block; vertical-align: middle; }
.ic-lg { width: 34px; height: 34px; }
.ic-xl { width: 56px; height: 56px; }

/* Header */
.topbar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; padding: 18px 28px;
  max-width: 1320px; margin: 0 auto;
}
.brand { display: flex; align-items: center; gap: 14px; }
.brand-mark {
  width: 44px; height: 44px; border-radius: 14px;
  display: grid; place-items: center; color: #fff;
  background: linear-gradient(135deg, #7b6cf6, #6c5ce7);
  box-shadow: var(--shadow-sm);
}
.brand-text { display: flex; flex-direction: column; }
.brand-name { font-size: 18px; font-weight: 700; letter-spacing: -0.01em; }
.brand-sub { font-size: 12.5px; color: var(--muted); max-width: 560px; }
.summary { display: flex; gap: 8px; flex-wrap: wrap; }
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 999px;
  font-size: 13px; font-weight: 600;
  background: var(--primary-soft); color: var(--primary-d);
}
.chip.accent { background: var(--accent-soft); color: #3f6212; }

/* Workspace grid */
.workspace {
  max-width: 1320px; margin: 0 auto; padding: 8px 28px 40px;
  display: grid; grid-template-columns: 340px 1fr; gap: 22px;
  align-items: start;
}
.col-left { display: flex; flex-direction: column; gap: 14px;
  position: sticky; top: 12px; }

/* Dropzone */
.dropzone {
  background: var(--card-glass); backdrop-filter: blur(6px);
  border: 2px dashed rgba(108,92,231,.35); border-radius: var(--radius);
  padding: 26px 18px; text-align: center; cursor: pointer;
  color: var(--primary); transition: border-color .15s, background .15s, transform .15s;
  box-shadow: var(--shadow-sm);
}
.dropzone:hover { border-color: var(--primary); }
.dropzone.dragover { border-color: var(--primary); background: var(--primary-soft); transform: scale(1.01); }
.dz-text { margin: 10px 0 4px; font-size: 14.5px; font-weight: 600; color: var(--text); }
.dz-hint { margin: 0; font-size: 12px; color: var(--muted); }

/* Buttons */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 12px 18px; border-radius: var(--radius-sm);
  font-size: 14px; font-weight: 600; font-family: inherit;
  border: 1px solid transparent; cursor: pointer; text-decoration: none;
  transition: background .15s, opacity .15s, box-shadow .15s;
}
.btn-block { width: 100%; }
.btn-primary { background: var(--primary); color: #fff; box-shadow: var(--shadow-sm); }
.btn-primary:hover:not([disabled]) { background: var(--primary-d); }
.btn-primary[disabled] { opacity: .45; cursor: not-allowed; }
.btn-ghost { background: var(--card); color: var(--primary); border-color: var(--border); }
.btn-ghost:hover { background: var(--primary-soft); }
.downloadall { margin-top: auto; }

/* Right column / detail card */
.col-right { min-height: 60vh; }
.detail {
  background: var(--card-glass); backdrop-filter: blur(6px);
  border: 1px solid var(--border); border-radius: var(--radius);
  box-shadow: var(--shadow); padding: 24px; min-height: 60vh;
}
.empty-state {
  height: 56vh; display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center;
  color: var(--muted); gap: 10px;
}
.empty-state .ic { color: rgba(108,92,231,.35); }
.empty-title { font-size: 16px; font-weight: 600; color: var(--text); margin: 6px 0 0; }
.empty-hint { font-size: 13px; max-width: 340px; margin: 0; }

/* Responsive: stack columns */
@media (max-width: 900px) {
  .workspace { grid-template-columns: 1fr; }
  .col-left { position: static; }
  .brand-sub { display: none; }
}
```

- [ ] **Step 3: Run server and verify shell renders**

Run:
```bash
cd ~/Desktop/GitHub/creo_click_check && npm install >/dev/null 2>&1; node server.js &
sleep 1; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/; curl -s http://localhost:3000/assets/bg-creo.png -o /dev/null -w "bg:%{http_code}\n"; kill %1
```
Expected: `200` for page and `bg:200` for the background asset.

- [ ] **Step 4: Visual check in browser**

Open http://localhost:3000 (start with `node server.js`). Confirm: white-mint background with faint lime glass image behind; header with indigo logo tile + "ClickTag Cleaner" + DSP subtitle; left column has dropzone + disabled "Обработать" button; right column shows scissors empty-state. No console errors except possibly from the old app.js referencing removed elements — that's fine, replaced next task.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat(ui): two-pane layout shell + light design system"
```

---

## Task 2: Upload queue + process button behavior

Deliverable: dropping/selecting `.zip` files lists them in the left column with size; the "Обработать (N)" button shows the count and enables/disables correctly. No API call yet.

**Files:**
- Modify: `public/app.js` (full rewrite begins here)

**Interfaces:**
- Consumes: DOM IDs from Task 1.
- Produces: `queued`, `addFiles()`, `renderList()` (pending-only here; replaced in Task 3), `fmtSize()` (consumed by Tasks 3–4).

- [ ] **Step 1: Replace `public/app.js` with the queue layer**

```js
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
```

- [ ] **Step 2: Add list-row + status-dot styles to `public/style.css`**

```css
.creative-list { display: flex; flex-direction: column; }
.creative-list ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.row-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: var(--radius-sm);
  background: var(--card); border: 1px solid var(--border);
  cursor: pointer; transition: background .12s, border-color .12s, transform .12s;
  animation: fade .22s ease both;
}
@keyframes fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.row-item:hover { border-color: rgba(108,92,231,.35); }
.row-item.is-active { background: var(--primary-soft); border-color: var(--primary); }
.row-status { flex: 0 0 auto; display: grid; place-items: center; width: 20px; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.dot-pending { background: #cbd5e1; }
.dot-ok { background: var(--accent); }
.dot-err { background: var(--danger); }
.row-main { display: flex; flex-direction: column; min-width: 0; }
.row-name { font-weight: 600; font-size: 13.5px; word-break: break-all; }
.row-meta { font-size: 12px; color: var(--muted); }
```

- [ ] **Step 3: Verify queue behavior in browser**

Start `node server.js`, open http://localhost:3000. Select two `.zip` files (any zips). Confirm: both appear in the left list with gray pending dots and sizes; button reads "Обработать (2)" and is enabled. Selecting a non-zip is ignored. No console errors.

- [ ] **Step 4: Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat(ui): file queue + process button state"
```

---

## Task 3: Process flow — API call, skeletons, list with statuses, summary, download-all

Deliverable: clicking "Обработать" POSTs the batch, shows skeleton rows, then renders the creative list with ok/error statuses, fills header summary chips, enables "Скачать всё", auto-selects the first ready creative, and shows inline errors without `alert()`.

**Files:**
- Modify: `public/app.js`
- Modify: `public/style.css` (skeleton + chip-in-row styles)

**Interfaces:**
- Consumes: `queued`, `addFiles`, `renderList` (pending version), `pendingRow`, `fmtSize`, state vars (Task 2).
- Produces: `results`, `processBatch()`, unified `renderList()` (replaces Task 2 version), `resultRow()`, `renderSummary()`, `countClicksRemoved()`, `selectResult()` stub (real impl in Task 4).

- [ ] **Step 1: Add the process flow to `public/app.js`** (insert before the final `renderList();` line)

```js
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
```

- [ ] **Step 2: Add a temporary `selectResult` stub to `public/app.js`** (replaced in Task 4; lets Task 3 be tested independently)

```js
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
```

- [ ] **Step 3: Add skeleton + in-row chip styles to `public/style.css`**

```css
.sk { display: block; border-radius: 6px;
  background: linear-gradient(90deg, #eef0f5 25%, #f7f8fb 37%, #eef0f5 63%);
  background-size: 400% 100%; animation: sk 1.2s ease-in-out infinite; }
.sk-line { height: 10px; width: 70%; margin-top: 6px; }
@keyframes sk { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
.row-item.is-err .row-meta { color: var(--danger); }
```

- [ ] **Step 4: Build a tiny test creative + verify end-to-end**

Create a throwaway creative zip with click logic, then process it via the UI.

Run (creates `/tmp/creo-test/click.zip`):
```bash
mkdir -p /tmp/creo-test && cd /tmp/creo-test
cat > index.html <<'HTML'
<!doctype html><html><head><style>.b{cursor:pointer}</style></head>
<body><a id="click_area" href="https://example.com" target="_blank" onclick="t()">
<canvas id="c" width="300" height="250"></canvas></a>
<script>var clickTag="https://example.com";
document.getElementById('click_area').addEventListener('click',function(){window.open(clickTag);});</script>
</body></html>
HTML
cd /tmp/creo-test && zip -q click.zip index.html && echo "made $(pwd)/click.zip"
```

Then start `node server.js`, open http://localhost:3000, drag `/tmp/creo-test/click.zip`, click "Обработать". Confirm: skeleton appears briefly → list row turns green (ok dot), meta shows `in → out`; header chips show "креосов: 1" and "кликов вырезано: N" (N>0); "Скачать всё одним архивом" appears; detail pane shows the JSON stub for the auto-selected creative. No `alert()`, no console errors.

- [ ] **Step 5: Verify error path is inline**

Process a non-creative/garbage zip (e.g. `zip -q bad.zip <some text file>` that the cleaner errors on, or trigger a 400 by other means). Confirm an error row (coral dot) and/or the inline error empty-state — never a browser `alert()`.

- [ ] **Step 6: Verify backend tests still pass (regression guard)**

Run: `cd ~/Desktop/GitHub/creo_click_check && npm test`
Expected: all existing cleaner tests PASS (we changed no backend code).

- [ ] **Step 7: Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat(ui): batch processing, statuses, skeletons, summary chips"
```

---

## Task 4: Detail pane — side-by-side preview + "что вырезано" diff

Deliverable: selecting a creative renders the right pane with side-by-side original/cleaned iframes (sized from `adSize`), the diff cards (badge + −/+ snippets) with a per-file selector when there are multiple text files, a download button, and an error view for failed creatives. Replaces the Task 3 stub.

**Files:**
- Modify: `public/app.js` (replace `selectResult` stub with full `selectResult` + `renderDetail`)
- Modify: `public/style.css` (preview + diff styles)

**Interfaces:**
- Consumes: `results`, `selectedId`, `renderList`, `fmtSize`, DOM `#detailPane`, API fields `previewUrl`, `originalPreviewUrl`, `adSize`, `primaryHtml`, `textFiles[]`, `report.changes[]`, `downloadUrl`, `cleanedName`.
- Produces: final `selectResult(id)`, `renderDetail()`.

- [ ] **Step 1: Remove the temporary stub from `public/app.js`**

Delete the `// Temporary stub …` `selectResult` function added in Task 3, Step 2.

- [ ] **Step 2: Add the full detail renderer to `public/app.js`** (insert before the final `renderList();` line)

```js
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
```

- [ ] **Step 3: Add preview + diff styles to `public/style.css`**

```css
.detail-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
.detail-title { font-size: 17px; font-weight: 700; word-break: break-all; }
.detail-head .btn { width: auto; }

.block-cap { display: flex; align-items: center; justify-content: space-between;
  font-size: 14px; font-weight: 600; margin: 0 0 12px; color: var(--text); }
.block-cap .ic { color: var(--primary); }
.block-sub { font-size: 12px; color: var(--muted); font-weight: 500; }

.pv-block { margin-bottom: 24px; }
.pv-grid { display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-start; }
.pv-col { display: flex; flex-direction: column; gap: 8px; }
.pv-cap { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  font-size: 12px; color: var(--muted); }
.pv-label { font-weight: 600; color: var(--text); }
.pv-open { color: var(--primary); text-decoration: none; }
.pv-open:hover { text-decoration: underline; }
.pv-stage { background: #fff; border: 1px solid var(--border); border-radius: 10px;
  overflow: auto; max-width: 100%; box-shadow: var(--shadow-sm); }
.pv-stage iframe { display: block; border: 0; background: #fff; }

.diff-block { border-top: 1px solid var(--border); padding-top: 18px; }
.diff-file { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px;
  padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--card); color: var(--text); max-width: 100%; margin-bottom: 12px; }
.diff-stat { font-size: 12px; color: var(--muted); margin: 0 0 10px; }
.diff-empty { font-size: 13px; color: var(--muted); }

.act-card { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; margin-bottom: 10px; background: var(--card); }
.act-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 13px; }
.badge { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; font-weight: 700;
  padding: 3px 8px; border-radius: 999px; flex: 0 0 auto; }
.b-remove { background: var(--danger-soft); color: #be123c; }
.b-replace { background: var(--primary-soft); color: var(--primary-d); }
.b-warn { background: #fef3c7; color: #92660a; }
.act-title { font-weight: 500; word-break: break-word; }
.snip { display: flex; font: 12px/1.55 ui-monospace, Menlo, Consolas, monospace; }
.snip + .snip { border-top: 1px solid var(--border); }
.snip-rm { background: rgba(251,113,133,.08); }
.snip-add { background: rgba(163,230,53,.12); }
.snip-sign { flex: 0 0 auto; width: 1.8em; text-align: center; padding: 6px 0; font-weight: 700; user-select: none; }
.snip-rm .snip-sign { color: #be123c; }
.snip-add .snip-sign { color: #3f6212; }
.snip-code { flex: 1 1 auto; margin: 0; padding: 6px 10px 6px 0; white-space: pre-wrap; word-break: break-word; }
```

- [ ] **Step 4: Verify the full detail pane end-to-end**

Start `node server.js`, open http://localhost:3000, process `/tmp/creo-test/click.zip` (from Task 3, Step 4). After auto-select, confirm the right pane shows:
- Title = `click.zip` + indigo "Скачать" button (clicking downloads `click_cleaned.zip`).
- Preview block: two iframes side by side ("Оригинал" / "После очистки"), sized 300×250, each with "в новой вкладке" link. The cleaned one renders the canvas without click logic.
- "Что вырезано" block: diff cards with badges (`replace` for a→div, `attr`/`js` for removals) and red `−` / green `+` snippet rows. With a single text file the `<select>` is hidden.
Click between multiple list rows (process 2+ zips) and confirm the active row highlights (indigo) and detail updates. No console errors.

- [ ] **Step 5: Verify responsive stacking**

Narrow the window below 900px. Confirm columns stack (list above, detail below), subtitle hides, nothing overflows horizontally.

- [ ] **Step 6: Backend tests still green**

Run: `cd ~/Desktop/GitHub/creo_click_check && npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat(ui): detail pane with side-by-side preview and diff cards"
```

---

## Task 5: Copy fixes + final polish pass

Deliverable: all user-facing copy reflects the DSP purpose; footer note about 30-min retention is present; final visual once-over (spacing, hover states, animations) is consistent.

**Files:**
- Modify: `public/index.html` (footer note; verify title/subtitle copy)
- Modify: `public/style.css` (footer style + any polish)

**Interfaces:** none new.

- [ ] **Step 1: Add a footer note inside `<main>` (after `.col-right`) in `public/index.html`**

```html
    </section>
  </main>
  <footer class="foot">Архивы хранятся в памяти и удаляются через 30 минут после загрузки.</footer>
```

- [ ] **Step 2: Add footer style to `public/style.css`**

```css
.foot { max-width: 1320px; margin: 0 auto; padding: 8px 28px 28px;
  font-size: 12px; color: var(--muted); text-align: center; }
```

- [ ] **Step 3: Copy audit**

Grep for stale "Yandex"/"Яндекс"/"для самых маленьких" in `public/`:
```bash
grep -rniE "яндекс|yandex|самых маленьких" ~/Desktop/GitHub/creo_click_check/public/
```
Expected: no matches. If any remain in `index.html`, replace with DSP-framed copy.

- [ ] **Step 4: Final visual once-over**

Start `node server.js`, open http://localhost:3000. Walk the whole flow (drop → process → select → preview → diff → download → download-all). Confirm: hover states on rows/buttons, skeleton animation, fade-ins feel consistent; background glass visible but content fully readable; no layout jumps; no console errors.

- [ ] **Step 5: Final regression + commit**

```bash
cd ~/Desktop/GitHub/creo_click_check && npm test
git add public/index.html public/style.css
git commit -m "chore(ui): DSP-accurate copy + footer + final polish"
```

---

## Notes for the executor

- The redesign is frontend-only. If you find yourself editing `server.js`, `src/`, `tests/`, or `package.json`, stop — that's out of scope per Global Constraints.
- Keep `npm test` green after each task as a cheap regression signal that the backend was untouched.
- Background image is large (2.5MB). Optional follow-up (not in this plan): compress to WebP/JPEG to speed first paint. Don't change the filename without updating the `url()` in `style.css`.
- README.md still describes the wrong purpose (Yandex). Updating it is explicitly out of scope here; do it only if the user asks.
