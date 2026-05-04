'use strict';

const path = require('path');
const AdmZip = require('adm-zip');

/**
 * In-memory ZIP unpack with zip-slip protection.
 * Returns an array of { name, data } where name is the POSIX-style entry path.
 */
function unpack(zipBuffer) {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    const entryName = entry.entryName.replace(/\\/g, '/');
    if (isUnsafePath(entryName)) {
      throw new Error(`Unsafe entry path (zip-slip): ${entry.entryName}`);
    }

    files.push({
      name: entryName,
      data: entry.getData(),
    });
  }
  return files;
}

/**
 * Pack in-memory files back into a ZIP buffer, preserving entry names exactly.
 */
function pack(files) {
  const zip = new AdmZip();
  for (const f of files) {
    zip.addFile(f.name, Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data));
  }
  return zip.toBuffer();
}

function isUnsafePath(entryName) {
  if (!entryName) return true;
  if (path.isAbsolute(entryName)) return true;
  if (/^[a-zA-Z]:/.test(entryName)) return true;
  const normalized = path.posix.normalize(entryName);
  if (normalized.startsWith('..') || normalized.startsWith('/')) return true;
  return false;
}

module.exports = { unpack, pack, isUnsafePath };
