'use strict';

const path = require('path');
const { unpack, pack } = require('./zipHandler');
const { cleanHtml } = require('./htmlCleaner');
const { cleanJs } = require('./jsCleaner');
const { cleanCss } = require('./cssCleaner');

/**
 * Main pipeline. Takes a ZIP buffer, walks every file inside, runs the
 * appropriate cleaner against HTML/JS/CSS payloads, and returns a freshly
 * packed ZIP plus a structured report.
 */
const MAX_NESTING_DEPTH = 5;

async function cleanZip(zipBuffer, depth = 0) {
  if (depth > MAX_NESTING_DEPTH) {
    throw new Error(`Nested ZIP depth exceeded (${MAX_NESTING_DEPTH}); possible zip bomb`);
  }
  const files = unpack(zipBuffer);
  const report = {
    totalFiles: files.length,
    htmlFiles: 0,
    jsFiles: 0,
    cssFiles: 0,
    nestedZips: 0,
    untouched: 0,
    changes: [],
    primaryHtml: null,
    adSize: null,
    // Per-file metadata for the UI diff-viewer: only textual files are
    // listed; `modified` flips when the cleaned bytes differ from input.
    textFiles: [],
  };

  const noteText = (name, kind, originalBuf, cleanedBuf) => {
    report.textFiles.push({
      path: name,
      kind,
      bytes: cleanedBuf.length,
      modified: !originalBuf.equals(cleanedBuf),
    });
  };

  const cleanedFiles = await Promise.all(files.map(async (file) => {
    const ext = path.extname(file.name).toLowerCase();
    const baseName = path.basename(file.name).toLowerCase();

    // Nested ZIP — recurse. Inner reports are folded into the parent's
    // changes list with the nested archive's path as a prefix so the user
    // sees exactly which file was modified inside which archive.
    if (ext === '.zip') {
      report.nestedZips += 1;
      try {
        const inner = await cleanZip(file.data, depth + 1);
        for (const change of inner.report.changes) {
          report.changes.push({ ...change, file: `${file.name}!${change.file}` });
        }
        for (const tf of inner.report.textFiles || []) {
          report.textFiles.push({ ...tf, path: `${file.name}!${tf.path}` });
        }
        report.htmlFiles += inner.report.htmlFiles;
        report.jsFiles += inner.report.jsFiles;
        report.cssFiles += inner.report.cssFiles;
        report.nestedZips += inner.report.nestedZips;
        report.untouched += inner.report.untouched;
        return { name: file.name, data: inner.buffer };
      } catch (e) {
        report.changes.push({ file: file.name, kind: 'zip', error: e.message });
        return file;
      }
    }

    // HTML
    if (ext === '.html' || ext === '.htm' || baseName === 'index') {
      report.htmlFiles += 1;
      try {
        const source = file.data.toString('utf8');
        const result = cleanHtml(source);
        if (result.log.length) {
          report.changes.push({ file: file.name, kind: 'html', actions: result.log });
        }
        const cleanedBuf = Buffer.from(result.code, 'utf8');
        noteText(file.name, 'html', file.data, cleanedBuf);
        return { name: file.name, data: cleanedBuf };
      } catch (e) {
        report.changes.push({ file: file.name, kind: 'html', error: e.message });
        return file;
      }
    }

    // JS
    if (ext === '.js' || ext === '.mjs') {
      report.jsFiles += 1;
      try {
        const source = file.data.toString('utf8');
        const result = cleanJs(source);
        if (result.parseError) {
          report.changes.push({ file: file.name, kind: 'js', warning: `parse error: ${result.parseError}` });
        }
        if (result.removed.length) {
          report.changes.push({ file: file.name, kind: 'js', actions: result.removed });
        }
        const cleanedBuf = Buffer.from(result.code, 'utf8');
        noteText(file.name, 'js', file.data, cleanedBuf);
        return { name: file.name, data: cleanedBuf };
      } catch (e) {
        report.changes.push({ file: file.name, kind: 'js', error: e.message });
        return file;
      }
    }

    // CSS
    if (ext === '.css') {
      report.cssFiles += 1;
      try {
        const source = file.data.toString('utf8');
        const result = cleanCss(source);
        if (result.removed.length) {
          report.changes.push({ file: file.name, kind: 'css', actions: result.removed });
        }
        const cleanedBuf = Buffer.from(result.code, 'utf8');
        noteText(file.name, 'css', file.data, cleanedBuf);
        return { name: file.name, data: cleanedBuf };
      } catch (e) {
        report.changes.push({ file: file.name, kind: 'css', error: e.message });
        return file;
      }
    }

    // Other textual formats — surfaced for diff viewing but not modified.
    if (ext === '.json' || ext === '.xml' || ext === '.txt' || ext === '.svg') {
      report.untouched += 1;
      noteText(file.name, ext.slice(1), file.data, file.data);
      return file;
    }

    report.untouched += 1;
    return file;
  }));

  // Pick primary HTML for preview: prefer top-level index.html, else the
  // first/shallowest .html file.
  const htmlFiles = cleanedFiles.filter((f) => /\.html?$/i.test(f.name));
  if (htmlFiles.length) {
    const ranked = [...htmlFiles].sort((a, b) => {
      const isIndex = (n) => /(^|\/)index\.html?$/i.test(n) ? 0 : 1;
      const depth = (n) => n.split('/').length;
      return (isIndex(a.name) - isIndex(b.name)) || (depth(a.name) - depth(b.name));
    });
    const primary = ranked[0];
    report.primaryHtml = primary.name;
    report.adSize = parseAdSize(primary.data.toString('utf8'));
  }

  const buffer = pack(cleanedFiles);
  return { buffer, report };
}

function parseAdSize(html) {
  // <meta name="ad.size" content="width=300,height=600">
  const meta = html.match(/<meta[^>]+name=["']ad\.size["'][^>]+content=["']([^"']+)["']/i);
  if (!meta) return null;
  const w = +((meta[1].match(/width\s*=\s*(\d+)/i) || [])[1] || 0);
  const h = +((meta[1].match(/height\s*=\s*(\d+)/i) || [])[1] || 0);
  if (!w || !h) return null;
  return { width: w, height: h };
}

module.exports = { cleanZip };
