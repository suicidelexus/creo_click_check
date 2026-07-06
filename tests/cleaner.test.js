'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');

const { cleanHtml } = require('../src/cleaner/htmlCleaner');
const { cleanJs } = require('../src/cleaner/jsCleaner');
const { cleanCss } = require('../src/cleaner/cssCleaner');
const { cleanZip } = require('../src/cleaner');
const { isUnsafePath } = require('../src/cleaner/zipHandler');

// ---------- HTML ----------

test('htmlCleaner: <a href> wrapping canvas becomes <div>', () => {
  const input = `
    <html><head></head><body>
      <a href="https://example.com" target="_blank" onclick="track()">
        <canvas id="c" width="300" height="250"></canvas>
      </a>
    </body></html>`;
  const { code, log } = cleanHtml(input);
  assert.match(code, /<div[^>]*>\s*<canvas/);
  assert.doesNotMatch(code, /<a\b/i);
  assert.doesNotMatch(code, /href=/i);
  assert.doesNotMatch(code, /onclick=/i);
  assert.ok(log.some((l) => (l.reason || '').includes('<a> -> <div>')));
});

test('htmlCleaner: strips inline event handlers from any tag', () => {
  const input = `<div onclick="x()" onmousedown="y()" data-clicktag="z"><span onmouseup="q()">x</span></div>`;
  const { code } = cleanHtml(input);
  assert.doesNotMatch(code, /onclick|onmousedown|onmouseup|data-clicktag/i);
});

test('htmlCleaner: preserves non-click on* handlers (onload, onresize, etc.)', () => {
  // Adobe Animate / CreateJS banners bootstrap from <body onload="init()">.
  // We must not strip non-click handlers — the regression we got was a fully
  // white canvas because init() never fired.
  const input = `
    <html><body onload="init();">
      <video oncanplay="play()" onerror="fail()" onloadeddata="x()"></video>
      <input onfocus="f()" onblur="b()" onchange="c()" onkeydown="k()">
      <div onmouseover="hover()" onmousemove="move()"></div>
    </body></html>`;
  const { code } = cleanHtml(input);
  assert.match(code, /onload="init\(\);"/);
  assert.match(code, /oncanplay/);
  assert.match(code, /onerror/);
  assert.match(code, /onloadeddata/);
  assert.match(code, /onfocus/);
  assert.match(code, /onblur/);
  assert.match(code, /onchange/);
  assert.match(code, /onkeydown/);
  assert.match(code, /onmouseover/);
  assert.match(code, /onmousemove/);
});

test('htmlCleaner: does NOT inject pointer-events:none', () => {
  // The cleaner used to inject `pointer-events:none !important` on the whole
  // DOM as a paranoia guard. That broke creatives shown on platforms that
  // wrap the creative with their own click layer (Adfox / MyTarget / DSPs):
  // with no element accepting pointer events, the host's click handler
  // never fired. The <a>→<div> + JS-API stripping is enough to kill
  // internal click logic; we leave click bubbling to the host wrapper.
  const input = `<html><head></head><body><div>x</div></body></html>`;
  const { code } = cleanHtml(input);
  assert.doesNotMatch(code, /pointer-events:\s*none/i);
});

test('htmlCleaner: cleans inline <script> blocks', () => {
  const input = `
    <html><body>
      <script>
        document.getElementById('btn').addEventListener('click', function() {
          window.open(getClickURL(), '_blank');
        });
      </script>
    </body></html>`;
  const { code } = cleanHtml(input);
  assert.doesNotMatch(code, /addEventListener\(['"]click/);
  assert.doesNotMatch(code, /window\.open/);
  assert.doesNotMatch(code, /getClickURL\(\)/);
});

// ---------- JS ----------

test('jsCleaner: removes addEventListener("click", ...)', () => {
  const src = `el.addEventListener("click", function(){ window.open(url); });`;
  const { code, removed } = cleanJs(src);
  assert.doesNotMatch(code, /addEventListener/);
  assert.ok(removed.length >= 1);
});

test('jsCleaner: removes window.open call', () => {
  const src = `function go(){ window.open("https://x.test"); }`;
  const { code } = cleanJs(src);
  assert.doesNotMatch(code, /window\.open/);
});

test('jsCleaner: removes getClickURLNum / yandex API call', () => {
  const src = `var u = yandexHTML5BannerApi.getClickURLNum(0); window.open(u);`;
  const { code } = cleanJs(src);
  assert.doesNotMatch(code, /getClickURLNum/);
  assert.doesNotMatch(code, /window\.open/);
});

test('jsCleaner: removes el.onclick assignment', () => {
  const src = `var btn = document.getElementById('b'); btn.onclick = function(){ go(); };`;
  const { code } = cleanJs(src);
  assert.doesNotMatch(code, /\.onclick\s*=/);
});

test('jsCleaner: removes location.href assignment', () => {
  const src = `function nav(){ location.href = clickTag; }`;
  const { code } = cleanJs(src);
  assert.doesNotMatch(code, /location\.href\s*=/);
});

test('jsCleaner: blanks clickTag variable initializer', () => {
  const src = `var clickTag = "https://example.com/track";`;
  const { code } = cleanJs(src);
  assert.match(code, /var\s+clickTag\s*=\s*""/);
});

test('jsCleaner: leaves animation code alone', () => {
  const src = `
    var t = 0;
    function tick() {
      t += 0.016;
      ctx.clearRect(0,0,w,h);
      ctx.drawImage(img, Math.cos(t)*10, Math.sin(t)*10);
      requestAnimationFrame(tick);
    }
    tick();
  `;
  const { code } = cleanJs(src);
  assert.equal(code.trim(), src.trim());
});

test('jsCleaner: gracefully handles unparseable JS', () => {
  const src = `this is :: not valid javascript ((( `;
  const { code, parseError } = cleanJs(src);
  assert.equal(code, src); // untouched
  assert.ok(parseError, 'should report parse error');
});

// ---------- CSS ----------

test('cssCleaner: removes cursor: pointer', () => {
  const css = `.btn { display: block; cursor: pointer; color: red; }`;
  const { code } = cleanCss(css);
  assert.doesNotMatch(code, /cursor\s*:\s*pointer/i);
  assert.match(code, /color:\s*red/);
});

test('cssCleaner: removes cursor: pointer with !important', () => {
  const css = `a { cursor: pointer !important; }`;
  const { code } = cleanCss(css);
  assert.doesNotMatch(code, /pointer/i);
});

// ---------- end-to-end ZIP ----------

function makeZip(files) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(content));
  }
  return zip.toBuffer();
}

function readZip(buffer) {
  const zip = new AdmZip(buffer);
  const out = {};
  for (const e of zip.getEntries()) {
    if (!e.isDirectory) out[e.entryName] = e.getData().toString('utf8');
  }
  return out;
}

test('cleanZip: end-to-end on a sample creative', async () => {
  const inputZip = makeZip({
    'index.html': `<!doctype html><html><head><style>.btn{cursor:pointer;}</style></head>
      <body>
        <a href="https://t.example/c" target="_blank" onclick="track()">
          <canvas id="c"></canvas>
        </a>
        <script src="banner.js"></script>
      </body></html>`,
    'banner.js': `
      var clickTag = "https://t.example/c";
      document.querySelector('a').addEventListener('click', function(){
        window.open(clickTag, '_blank');
      });
      requestAnimationFrame(function tick(){ requestAnimationFrame(tick); });
    `,
    'assets/logo.png': 'PNG-PLACEHOLDER',
  });

  const { buffer, report } = await cleanZip(inputZip);
  const out = readZip(buffer);

  assert.ok(out['index.html'].includes('<div'));
  assert.ok(!/<a\b/i.test(out['index.html']));
  // Cleaner no longer injects pointer-events:none — see the dedicated
  // htmlCleaner test for the rationale.
  assert.ok(!/pointer-events:\s*none/i.test(out['index.html']));

  assert.ok(!/addEventListener/.test(out['banner.js']));
  assert.ok(!/window\.open/.test(out['banner.js']));
  assert.ok(/var\s+clickTag\s*=\s*""/.test(out['banner.js']));
  assert.ok(/requestAnimationFrame/.test(out['banner.js']), 'animation must be preserved');

  assert.equal(out['assets/logo.png'], 'PNG-PLACEHOLDER', 'binary files untouched');

  assert.ok(report.changes.length > 0);
  assert.equal(report.htmlFiles, 1);
  assert.equal(report.jsFiles, 1);
});

test('cleanZip: archive with no clicks returns equivalent content', async () => {
  const inputZip = makeZip({
    'index.html': `<!doctype html><html><body><canvas></canvas><script>var x=1;</script></body></html>`,
  });
  const { buffer, report } = await cleanZip(inputZip);
  const out = readZip(buffer);
  // No JS edits should have been recorded.
  const jsChanges = report.changes.filter((c) => c.kind === 'js' && c.actions);
  assert.equal(jsChanges.length, 0);
});

test('cleanZip: recursively cleans nested ZIPs', async () => {
  const innerZip = makeZip({
    'index.html': `<html><body><a href="https://x.test" onclick="t()"><canvas></canvas></a></body></html>`,
  });
  const outerZip = new AdmZip();
  outerZip.addFile('outer.html', Buffer.from('<html><body><div>wrapper</div></body></html>'));
  outerZip.addFile('inner/banner.zip', innerZip);
  const outerBuf = outerZip.toBuffer();

  const { buffer, report } = await cleanZip(outerBuf);
  const outZip = new AdmZip(buffer);
  const outInner = new AdmZip(outZip.getEntry('inner/banner.zip').getData());
  const innerHtml = outInner.getEntry('index.html').getData().toString('utf8');

  assert.ok(!/<a\b/i.test(innerHtml), 'nested <a> should be removed');
  assert.ok(!/onclick/i.test(innerHtml), 'nested onclick should be removed');
  assert.equal(report.nestedZips >= 1, true);
  assert.ok(report.changes.some((c) => c.file.includes('inner/banner.zip!')),
    'changes should be prefixed with nested archive path');
});

test('cleanZip: rejects pathologically nested zip-bomb structures', async () => {
  // Manually nest 7 ZIPs deep — should hit the depth limit.
  let buf = makeZip({ 'index.html': '<html></html>' });
  for (let i = 0; i < 7; i++) {
    const z = new AdmZip();
    z.addFile('inner.zip', buf);
    buf = z.toBuffer();
  }
  const { report } = await cleanZip(buf);
  // The deepest level should have surfaced an error in the report rather
  // than blowing up.
  const err = JSON.stringify(report.changes);
  assert.match(err, /depth exceeded|zip bomb/i);
});

test('zipHandler: isUnsafePath flags traversal & absolute paths', () => {
  // The unpacker delegates safety checks to isUnsafePath; AdmZip itself
  // normalizes some traversal sequences on .addFile, so we test the guard
  // directly to make sure crafted archives can't slip through.
  assert.equal(isUnsafePath('../evil.html'), true);
  assert.equal(isUnsafePath('foo/../../evil.html'), true);
  assert.equal(isUnsafePath('/etc/passwd'), true);
  assert.equal(isUnsafePath('C:/Windows/System32/x.dll'), true);
  assert.equal(isUnsafePath('index.html'), false);
  assert.equal(isUnsafePath('assets/img/logo.png'), false);
});

test('htmlCleaner: strips bare data-click attr (targetads viewability redirect)', () => {
  // Adobe Animate creatives from targetads carry a viewability.js <script> whose
  // `data-click` attribute makes the banner clickable (the lib reads it and wires
  // a redirect). Bare `data-click` (no url/tag suffix) previously slipped through,
  // so the DSP rejected creatives the cleaner reported as clean. `data-pixel`
  // (impression only) must be preserved.
  const input =
    `<script type="text/javascript" ` +
    `data-pixel="https://eye.targetads.io/view/pixel?pid=1&pl=2" ` +
    `data-click="https://eye.targetads.io/view/click?pid=1&pl=2&erir={erid}" ` +
    `src="https://cdn.targetads.io/viewability/v1/viewability.js"></script>`;
  const { code, log } = cleanHtml(input);
  assert.doesNotMatch(code, /data-click=/i);
  assert.match(code, /data-pixel=/i);
  assert.ok(log.some((l) => /data-click/i.test(l.snippet || '') || /data-click/i.test(l.reason || '')));
});
