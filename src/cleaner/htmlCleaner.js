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

    for (const [attr, value] of Object.entries(el.attribs || {})) {
      const lower = attr.toLowerCase();
      if (NAV_ATTRS.has(lower)) {
        log.push(`<a> attr removed: ${attr}`);
        continue;
      }
      if (CLICK_HANDLER_ATTR_RE.test(lower)) {
        log.push(`<a> handler removed: ${attr}`);
        continue;
      }
      $newEl.attr(attr, value);
    }
    $newEl.append($el.contents());
    $el.replaceWith($newEl);
    log.push('<a> -> <div>');
  });

  // 2) Strip click-related inline handlers and click-tag attrs from every
  //    element. Non-click `on*` attributes (onload, onresize, onerror,
  //    onmouseover, onkeydown, oncanplay, ...) are preserved — many
  //    HTML5 creatives bootstrap themselves from `<body onload="init()">`.
  $('*').each((_, el) => {
    if (!el.attribs) return;
    for (const key of Object.keys(el.attribs)) {
      const lower = key.toLowerCase();
      if (CLICK_HANDLER_ATTR_RE.test(lower)) {
        delete el.attribs[key];
        log.push(`attr removed: ${key} on <${el.tagName}>`);
        continue;
      }
      if (lower === 'clicktag' || lower === 'data-clicktag' || /^data-click(url|tag)/.test(lower)) {
        delete el.attribs[key];
        log.push(`attr removed: ${key} on <${el.tagName}>`);
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
      result.removed.forEach((r) => log.push(`inline-script: ${r}`));
    }
    if (result.parseError) {
      log.push(`inline-script: parse error (left untouched): ${result.parseError}`);
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
      result.removed.forEach((r) => log.push(`inline-style: ${r}`));
    }
  });

  // 5) Inject a global pointer-events:none rule. We append a <style> as the
  //    last child of <head> so cascade order makes it authoritative; we use
  //    !important so existing rules can't override it.
  const $head = $('head');
  const blockerCss = `\n/* injected by creo-cleaner */\nhtml, body, body * { pointer-events: none !important; cursor: default !important; }\n`;
  if ($head.length) {
    $head.append(`<style data-cleaner="pointer-events">${blockerCss}</style>`);
  } else {
    // Some creatives have no <head>; fall back to body or root prepend.
    const $body = $('body');
    if ($body.length) {
      $body.prepend(`<style data-cleaner="pointer-events">${blockerCss}</style>`);
    } else {
      $.root().prepend(`<style data-cleaner="pointer-events">${blockerCss}</style>`);
    }
  }
  log.push('injected: pointer-events:none rule');

  return { code: $.html(), log };
}

module.exports = { cleanHtml };
