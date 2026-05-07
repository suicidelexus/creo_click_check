'use strict';

const parser = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const traverse = traverseModule.default || traverseModule;

/**
 * Surgical JS cleaner. We parse to AST, locate forbidden click-related nodes,
 * collect (start, end) ranges of source to remove or replace, and apply the
 * edits to the original source string from end to start. This preserves the
 * original formatting (no minification, no reformatting).
 */

const CLICK_EVENT_RE = /^(click|dblclick|mousedown|mouseup|pointerdown|pointerup|touchstart|touchend|tap)$/i;
const CLICK_HANDLER_PROP_RE = /^on(click|dblclick|mousedown|mouseup|pointerdown|pointerup|touchstart|touchend|tap)$/i;
const CLICK_VAR_RE = /^click(tag|url)\d*$/i;
const NAVIGATION_OBJ = new Set(['window', 'self', 'top', 'parent']);
const EVENT_BIND_METHODS = new Set([
  'addEventListener', 'removeEventListener',
  // CreateJS/jQuery/etc.
  'on', 'off', 'bind', 'unbind', 'one', 'live', 'delegate',
  'addListener', 'removeListener'
]);

function cleanJs(source, opts = {}) {
  if (!source || typeof source !== 'string') {
    return { code: source || '', removed: [] };
  }

  let ast;
  try {
    ast = parser.parse(source, {
      sourceType: 'unambiguous',
      ranges: true,
      errorRecovery: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowImportExportEverywhere: true,
      plugins: [],
    });
  } catch (e) {
    // Don't touch unparseable code; report parse error to caller.
    return { code: source, removed: [], parseError: e.message };
  }

  /** @type {Array<{start:number,end:number,replacement:string,reason:string}>} */
  const edits = [];

  const removeStmtOrReplace = (path, reason, replaceWith = 'void 0') => {
    const stmt = path.findParent((p) => p.isStatement());
    if (stmt && stmt.isExpressionStatement() && stmt.node.expression === path.node) {
      edits.push({ start: stmt.node.start, end: stmt.node.end, replacement: '', reason });
    } else {
      edits.push({ start: path.node.start, end: path.node.end, replacement: replaceWith, reason });
    }
  };

  traverse(ast, {
    CallExpression(path) {
      const node = path.node;
      const callee = node.callee;
      if (!callee) return;

      // foo.addEventListener('click', handler) and similar binding methods
      if (callee.type === 'MemberExpression' && callee.property) {
        const methName = callee.property.name || callee.property.value;
        if (EVENT_BIND_METHODS.has(methName) && node.arguments.length >= 1) {
          const firstArg = node.arguments[0];
          const eventName = literalString(firstArg);
          if (eventName && CLICK_EVENT_RE.test(eventName)) {
            removeStmtOrReplace(path, `${methName}("${eventName}")`);
            return;
          }
        }
      }

      // window.open(...), self.open(...), top.open(...), parent.open(...)
      if (callee.type === 'MemberExpression' && callee.property && callee.property.name === 'open') {
        const objName = identifierName(callee.object);
        if (objName && NAVIGATION_OBJ.has(objName)) {
          removeStmtOrReplace(path, `${objName}.open()`);
          return;
        }
      }

      // Bare identifier calls: getClickURL(), getClickTag(), getClickURLNum()
      if (callee.type === 'Identifier' && /^get(click|clk)(url|tag)\w*$/i.test(callee.name)) {
        removeStmtOrReplace(path, `${callee.name}()`);
        return;
      }

      // Member calls whose property name looks click-related:
      // *.getClickURL(), *.getClickURLNum(N), *.getClickTag(), api.click(...)
      if (callee.type === 'MemberExpression' && callee.property) {
        const propName = callee.property.name || callee.property.value;
        if (propName && /^(get)?click(url|tag)\w*$/i.test(propName)) {
          removeStmtOrReplace(path, `*.${propName}()`);
          return;
        }
      }

      // location.assign(...) / location.replace(...)
      if (callee.type === 'MemberExpression' && callee.property) {
        const propName = callee.property.name;
        const objName = identifierName(callee.object);
        if ((propName === 'assign' || propName === 'replace') &&
            (objName === 'location' || isLocationLike(callee.object))) {
          removeStmtOrReplace(path, `location.${propName}()`);
          return;
        }
      }
    },

    AssignmentExpression(path) {
      const node = path.node;
      const left = node.left;
      if (!left) return;

      // el.onclick = ..., el.onmousedown = ...
      if (left.type === 'MemberExpression' && left.property) {
        const propName = left.property.name || left.property.value;
        if (propName && CLICK_HANDLER_PROP_RE.test(propName)) {
          removeStmtOrReplace(path, `*.${propName} = ...`);
          return;
        }
        // el.style.cursor = 'pointer'
        if (propName === 'cursor' && left.object && left.object.type === 'MemberExpression' &&
            left.object.property && left.object.property.name === 'style') {
          const value = literalString(node.right);
          if (value && /pointer/i.test(value)) {
            removeStmtOrReplace(path, `style.cursor = "${value}"`);
            return;
          }
        }
        // location.href = ..., window.location = ..., document.location = ...
        if (propName === 'href' && left.object) {
          const objName = identifierName(left.object);
          if (objName === 'location' || isLocationLike(left.object)) {
            removeStmtOrReplace(path, `*.location.href = ...`);
            return;
          }
        }
        if (propName === 'location' && left.object) {
          const objName = identifierName(left.object);
          if (objName && (NAVIGATION_OBJ.has(objName) || objName === 'document')) {
            removeStmtOrReplace(path, `${objName}.location = ...`);
            return;
          }
        }
        // el.href = '...' on anchor-like elements: remove to be safe
        if (propName === 'href' && left.object && left.object.type !== 'Identifier') {
          removeStmtOrReplace(path, `*.href = ...`);
          return;
        }
      }

      // Bare clickTag = '...', clickTAG = '...', clickURL = '...'
      if (left.type === 'Identifier' && CLICK_VAR_RE.test(left.name)) {
        removeStmtOrReplace(path, `${left.name} = ...`);
        return;
      }
    },

    VariableDeclarator(path) {
      const node = path.node;
      // var clickTag = '...' -> keep var, blank out value (some hosts inject value)
      if (node.id && node.id.type === 'Identifier' && CLICK_VAR_RE.test(node.id.name)) {
        if (node.init && node.init.start != null) {
          edits.push({
            start: node.init.start,
            end: node.init.end,
            replacement: '""',
            reason: `var ${node.id.name} = ...`,
          });
        }
      }
    },
  });

  // When edits nest (e.g. addEventListener("click", ...) contains window.open),
  // we want the OUTERMOST edit to win — removing the whole statement subsumes
  // any inner replacement. Sort by (start asc, end desc) so the widest range
  // at each starting position is first, then drop anything contained in it.
  edits.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  let coveredEnd = -1;
  for (const e of edits) {
    if (e.start >= coveredEnd) {
      kept.push(e);
      coveredEnd = e.end;
    }
  }

  // Apply from end to start so offsets in untouched prefix remain valid.
  kept.sort((a, b) => b.start - a.start);
  let result = source;
  const log = [];
  for (const edit of kept) {
    log.push({
      kind: 'js-edit',
      reason: edit.reason,
      snippet: source.slice(edit.start, edit.end),
      replacement: edit.replacement || '',
    });
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  // Apply order is end→start, but the user reads the log top→bottom; flip it
  // back to source order so removals appear in the order they appear in code.
  log.reverse();

  return { code: result, removed: log };
}

function literalString(node) {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.quasis.length === 1) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

function identifierName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'ThisExpression') return 'this';
  return null;
}

function isLocationLike(node) {
  // matches window.location, document.location, top.location, etc.
  if (!node || node.type !== 'MemberExpression') return false;
  const propName = node.property && node.property.name;
  const objName = identifierName(node.object);
  return propName === 'location' && (NAVIGATION_OBJ.has(objName) || objName === 'document');
}

module.exports = { cleanJs };
