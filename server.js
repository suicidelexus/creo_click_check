'use strict';

const path = require('path');
const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');

const { cleanZip } = require('./src/cleaner');

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory upload storage. ZIPs are processed and held briefly for
// download; nothing is persisted to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,   // 50 MB per archive
    files: 50,                    // up to 50 archives per request
  },
});

// Short-lived in-memory store of processed batches. Keyed by random id.
// TTL: 30 minutes.
const BATCH_TTL_MS = 30 * 60 * 1000;
const batches = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, batch] of batches.entries()) {
    if (batch.expiresAt < now) batches.delete(id);
  }
}, 60 * 1000).unref();

function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Encode an entry path for use in a URL while preserving '/' and '!'.
// Nested-zip paths look like `outer.zip!inner/file.html`; we want the bang
// to round-trip so the preview endpoint can recognize it later.
function encodeArchivePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

app.use(express.static(path.join(__dirname, 'public')));

/**
 * POST /api/clean
 * Multipart form with one or more `files` parts. Each part must be a ZIP.
 * Returns JSON with per-archive results and a batchId for downloads.
 */
app.post('/api/clean', upload.array('files', 50), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded. Use field name "files".' });
  }

  const batchId = newId();
  const results = [];
  const archives = [];

  for (const file of req.files) {
    try {
      const { buffer, report } = await cleanZip(file.buffer);
      const cleanedName = file.originalname.replace(/\.zip$/i, '') + '_cleaned.zip';
      const archiveId = newId();
      archives.push({
        id: archiveId,
        name: cleanedName,
        buffer,
        originalBuffer: file.buffer,   // kept for side-by-side preview
      });
      const previewPath = report.primaryHtml
        ? report.primaryHtml.split('/').map(encodeURIComponent).join('/')
        : null;
      // Build URLs for each textual file so the diff viewer can fetch
      // (original, cleaned) pairs without further server bookkeeping.
      const textFiles = (report.textFiles || []).map((tf) => ({
        ...tf,
        originalUrl: `/api/preview-original/${batchId}/${archiveId}/${encodeArchivePath(tf.path)}`,
        cleanedUrl: `/api/preview/${batchId}/${archiveId}/${encodeArchivePath(tf.path)}`,
      }));

      results.push({
        id: archiveId,
        originalName: file.originalname,
        cleanedName,
        bytesIn: file.size,
        bytesOut: buffer.length,
        report,
        downloadUrl: `/api/download/${batchId}/${archiveId}`,
        previewUrl: previewPath ? `/api/preview/${batchId}/${archiveId}/${previewPath}` : null,
        originalPreviewUrl: previewPath ? `/api/preview-original/${batchId}/${archiveId}/${previewPath}` : null,
        primaryHtml: report.primaryHtml,
        adSize: report.adSize,
        textFiles,
      });
    } catch (e) {
      results.push({
        originalName: file.originalname,
        error: e.message,
      });
    }
  }

  batches.set(batchId, {
    archives,
    expiresAt: Date.now() + BATCH_TTL_MS,
  });

  res.json({
    batchId,
    bulkDownloadUrl: `/api/download-all/${batchId}`,
    results,
  });
});

app.get('/api/download/:batchId/:archiveId', (req, res) => {
  const batch = batches.get(req.params.batchId);
  if (!batch) return res.status(404).send('Batch expired or not found.');
  const archive = batch.archives.find((a) => a.id === req.params.archiveId);
  if (!archive) return res.status(404).send('Archive not found.');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(archive.name)}"`);
  res.send(archive.buffer);
});

app.get('/api/download-all/:batchId', (req, res) => {
  const batch = batches.get(req.params.batchId);
  if (!batch) return res.status(404).send('Batch expired or not found.');
  if (batch.archives.length === 0) return res.status(404).send('Empty batch.');

  // Bundle all cleaned archives into a single zip-of-zips.
  const zip = new AdmZip();
  for (const a of batch.archives) {
    zip.addFile(a.name, a.buffer);
  }
  const buffer = zip.toBuffer();
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="cleaned_batch_${req.params.batchId}.zip"`);
  res.send(buffer);
});

/**
 * Serve files from a cleaned (or original) archive so the UI can render a
 * live preview inside an iframe. Relative resources inside the creative
 * (.js, .png, .json, fonts) resolve via the wildcard segment of this URL.
 *
 *   /api/preview/...           — cleaned archive
 *   /api/preview-original/...  — original (unmodified) archive
 *
 * Both endpoints share the entry-lookup logic; they differ only in which
 * buffer they read from.
 */
function entriesFromBuffer(buf) {
  const zip = new AdmZip(buf);
  const map = new Map();
  for (const e of zip.getEntries()) {
    if (!e.isDirectory) map.set(e.entryName.replace(/\\/g, '/'), e.getData());
  }
  return map;
}

function lookupEntry(rootEntries, requested) {
  // Support nested-zip paths like `outer.zip!inner/file.html` (any depth).
  // Walk segment-by-segment, each `!` boundary peels another zip layer.
  const segments = requested.split('!');
  let entries = rootEntries;
  for (let i = 0; i < segments.length - 1; i++) {
    const buf = entries.get(segments[i]);
    if (!buf) return null;
    entries = entriesFromBuffer(buf);
  }
  const inner = segments[segments.length - 1];
  let data = entries.get(inner);
  if (!data && (inner === '' || inner.endsWith('/'))) {
    data = entries.get(inner + 'index.html') || entries.get(inner + 'index.htm');
  }
  return data || null;
}

function servePreview(source) {
  return (req, res) => {
    const batch = batches.get(req.params.batchId);
    if (!batch) return res.status(404).send('Batch expired or not found.');
    const archive = batch.archives.find((a) => a.id === req.params.archiveId);
    if (!archive) return res.status(404).send('Archive not found.');

    const cacheKey = source === 'original' ? 'originalEntries' : 'cleanedEntries';
    const bufferKey = source === 'original' ? 'originalBuffer' : 'buffer';
    if (!archive[cacheKey]) archive[cacheKey] = entriesFromBuffer(archive[bufferKey]);

    const requestedRaw = req.params[0] || '';
    const requested = decodeURIComponent(requestedRaw).replace(/\\/g, '/');
    if (requested.includes('..')) return res.status(400).send('Bad path.');

    const data = lookupEntry(archive[cacheKey], requested);
    if (!data) return res.status(404).send(`Not found in archive: ${requested}`);

    res.setHeader('Content-Type', mimeType(requested));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(data);
  };
}

app.get('/api/preview/:batchId/:archiveId/*', servePreview('cleaned'));
app.get('/api/preview-original/:batchId/:archiveId/*', servePreview('original'));

function mimeType(name) {
  const ext = name.toLowerCase().split('.').pop();
  switch (ext) {
    case 'html': case 'htm': return 'text/html; charset=utf-8';
    case 'js': case 'mjs':   return 'text/javascript; charset=utf-8';
    case 'css':              return 'text/css; charset=utf-8';
    case 'json':             return 'application/json; charset=utf-8';
    case 'svg':              return 'image/svg+xml';
    case 'png':              return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'gif':              return 'image/gif';
    case 'webp':             return 'image/webp';
    case 'avif':             return 'image/avif';
    case 'ico':              return 'image/x-icon';
    case 'woff':             return 'font/woff';
    case 'woff2':            return 'font/woff2';
    case 'ttf':              return 'font/ttf';
    case 'otf':              return 'font/otf';
    case 'eot':              return 'application/vnd.ms-fontobject';
    case 'mp3':              return 'audio/mpeg';
    case 'ogg':              return 'audio/ogg';
    case 'mp4':              return 'video/mp4';
    case 'webm':             return 'video/webm';
    case 'xml':              return 'application/xml; charset=utf-8';
    case 'txt':              return 'text/plain; charset=utf-8';
    default:                 return 'application/octet-stream';
  }
}

app.get('/healthz', (_, res) => res.json({ ok: true }));

// Multer error handler — return JSON instead of HTML stack traces.
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message, code: err.code });
  }
  if (err) {
    return res.status(500).json({ error: err.message });
  }
  res.status(500).json({ error: 'Unknown error' });
});

app.listen(PORT, () => {
  console.log(`creo-cleaner listening on http://localhost:${PORT}`);
});
