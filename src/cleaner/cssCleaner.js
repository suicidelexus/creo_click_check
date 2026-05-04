'use strict';

/**
 * CSS cleaner. Strips `cursor: pointer` declarations.
 * Regex-based since CSS click-related rules are simple property removals
 * and a full CSS parser dependency is not justified here.
 */
function cleanCss(source) {
  if (!source || typeof source !== 'string') {
    return { code: source || '', removed: [] };
  }
  const log = [];

  // Match `cursor : pointer` followed by ; or end-of-block.
  // Preserves surrounding whitespace minimally.
  const result = source.replace(
    /cursor\s*:\s*pointer\s*(?:!important\s*)?(;|(?=\s*\}))/gi,
    (match) => {
      log.push(`removed: ${match.trim()}`);
      // If the match ended with ';' we drop the whole thing; otherwise we
      // need to leave nothing so the closing brace stays valid.
      return match.endsWith(';') ? '' : '';
    }
  );

  return { code: result, removed: log };
}

module.exports = { cleanCss };
