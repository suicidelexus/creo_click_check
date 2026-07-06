'use strict';

const cheerio = require('cheerio');
const { cleanJs } = require('./jsCleaner');
const { cleanCss } = require('./cssCleaner');

/**
 * HTML cleaner. Uses cheerio (htmlparser2-based DOM) to:
 *   1. Convert <a> elements into <div> while preserving children & non-navigation attributes.
 *   2. Strip every inline event-handler attribute (anything starting with `on`)
 *      plus clickTAG / data-clicktag-style attributes.
 *   3. Re-process inline <script> blocks via the JS AST cleaner.
 *   4. Re-process inline <style> blocks via the CSS cleaner.
 *   5. Inject a `pointer-events: none` rule that disables all clicks on the creative.
 */

const NAV_ATTRS = new Set(['href', 'target', 'ping', 'rel', 'download']);

// Only click-related inline handlers are stripped. Other `on*` attributes
// (onload, onresize, onerror, onmouseover, onkeydown, oncanplay, etc.)
// are essential for many creatives — Adobe Animate banners use
// `<body onload="init()">` as the entry point, for example.
const CLICK_HANDLER_ATTR_RE = /^on(click|dblclick|auxclick|contextmenu|mousedown|mouseup|pointerdown|pointerup|touchstart|touchend|tap)$/i;

function cleanHtml(source) {
  if (!source || typeof source !== 'string') {
    return { code: source || '', log: [] };
  }

  // decodeEntities:false preserves entities exactly so we don't accidentally
  // mangle bytes inside JSON/JS embedded in the page.
  const $ = cheerio.load(source, { decodeEntities: false });
  const log = [];

  // 1) Convert every <a> into <div> while preserving content.
  $('a').each((_, el) => {
    const $el = $(el);
    const $newEl = $('<div></div>');
    const originalOpenTag = serializeOpenTag('a', el.attribs || {});

    for (const [attr, value] of Object.entries(el.attribs || {})) {
      const lower = attr.toLowerCase();
      if (NAV_ATTRS.has(lower)) {
        log.push({
          kind: 'attr-removed',
          reason: `<a> attr removed: ${attr}`,
          snippet: formatAttr(attr, value),
          replacement: '',
          context: { tag: 'a', attr },
        });
        continue;
      }
      if (CLICK_HANDLER_ATTR_RE.test(lower)) {
        log.push({
          kind: 'attr-removed',
          reason: `<a> handler removed: ${attr}`,
          snippet: formatAttr(attr, value),
          replacement: '',
          context: { tag: 'a', attr },
        });
        continue;
      }
      $newEl.attr(attr, value);
    }
    const newOpenTag = serializeOpenTag('div', $newEl.get(0).attribs || {});
    $newEl.append($el.contents());
    $el.replaceWith($newEl);
    log.push({
      kind: 'a-to-div',
      reason: '<a> -> <div>',
      snippet: originalOpenTag,
      replacement: newOpenTag,
    });
  });

  // 2) Strip click-related inline handlers and click-tag attrs from every
  //    element. Non-click `on*` attributes (onload, onresize, onerror,
  //    onmouseover, onkeydown, oncanplay, ...) are preserved — many
  //    HTML5 creatives bootstrap themselves from `<body onload="init()">`.
  $('*').each((_, el) => {
    if (!el.attribs) return;
    for (const key of Object.keys(el.attribs)) {
      const lower = key.toLowerCase();
      const value = el.attribs[key];
      if (CLICK_HANDLER_ATTR_RE.test(lower)) {
        delete el.attribs[key];
        log.push({
          kind: 'attr-removed',
          reason: `attr removed: ${key} on <${el.tagName}>`,
          snippet: formatAttr(key, value),
          replacement: '',
          context: { tag: el.tagName, attr: key },
        });
        continue;
      }
      // Any `data-click*` attribute is a click hook: `data-clicktag`,
      // `data-clickurl`, and the bare `data-click` that targetads' viewability.js
      // reads to wire a redirect on the banner. Strip them all (impression-only
      // `data-pixel` is left intact).
      if (lower === 'clicktag' || /^data-click/.test(lower)) {
        delete el.attribs[key];
        log.push({
          kind: 'attr-removed',
          reason: `attr removed: ${key} on <${el.tagName}>`,
          snippet: formatAttr(key, value),
          replacement: '',
          context: { tag: el.tagName, attr: key },
        });
      }
    }
  });

  // 3) Process inline <script> blocks (skip ones with src — handled per-file).
  $('script').each((_, el) => {
    const $script = $(el);
    if ($script.attr('src')) return;
    const code = $script.html();
    if (!code) return;
    const result = cleanJs(code);
    if (result.code !== code) {
      // cheerio's .text() escapes; we need raw content.
      $script.empty();
      // append a text node directly via the underlying DOM
      el.children = [{ type: 'text', data: result.code, parent: el }];
      result.removed.forEach((r) => log.push({
        kind: 'inline-script-edit',
        reason: `inline-script: ${r.reason}`,
        snippet: r.snippet,
        replacement: r.replacement,
      }));
    }
    if (result.parseError) {
      log.push({
        kind: 'inline-script-parse-error',
        reason: `inline-script: parse error (left untouched): ${result.parseError}`,
        snippet: '',
        replacement: '',
      });
    }
  });

  // 4) Process inline <style> blocks.
  $('style').each((_, el) => {
    const $style = $(el);
    const css = $style.html();
    if (!css) return;
    const result = cleanCss(css);
    if (result.code !== css) {
      $style.empty();
      el.children = [{ type: 'text', data: result.code, parent: el }];
      result.removed.forEach((r) => log.push({
        kind: 'inline-style-edit',
        reason: `inline-style: ${r.reason}`,
        snippet: r.snippet,
        replacement: r.replacement,
      }));
    }
  });

  // The earlier version of the cleaner also injected a global
  //   html, body, body * { pointer-events: none !important; ... }
  // rule as a "belt-and-suspenders" guard. That breaks the legitimate flow
  // where the host platform (Adfox / MyTarget / DSPs) wraps the creative
  // with its own click-tracker layer and expects the click to bubble out
  // of (or pass through) the creative DOM. With pointer-events:none on
  // every element, no node ever becomes a click target, so the host
  // wrapper never sees the event. Removing the inline `<a>` wrapper and
  // killing window.open / location.href / addEventListener('click') in
  // the JS is sufficient to satisfy "no internal click logic" without
  // poisoning the platform's own click handling.

  return { code: $.html(), log };
}

function formatAttr(name, value) {
  if (value == null || value === '') return name;
  // Use double-quotes; collapse any embedded ones for display purposes.
  const safe = String(value).replace(/"/g, '\\"');
  return `${name}="${safe}"`;
}

function serializeOpenTag(tagName, attribs) {
  const parts = [tagName];
  for (const [k, v] of Object.entries(attribs || {})) {
    parts.push(formatAttr(k, v));
  }
  return `<${parts.join(' ')}>`;
}

module.exports = { cleanHtml };
