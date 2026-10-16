// A small, defensive ZIP reader (Y-8). It only reads: it lists entries and extracts one entry into memory. It never writes to disk, so a
// hostile archive cannot escape a folder, but it still refuses the usual tricks: huge expansion, too many entries, unsafe names, links.
import { inflateRawSync } from 'node:zlib';

export const ZIP_LIMITS = Object.freeze({ compressed: 50 * 1024 * 1024, expanded: 200 * 1024 * 1024, entries: 500 });
const EOCD = 0x06054b50; const CEN = 0x02014b50; const LOC = 0x04034b50;

const refuse = (message) => new TypeError(`Archive refused: ${message}`);

/** True when a stored name could climb out of its folder or is absolute. */
export function unsafeName(name) {
  return !name || name.startsWith('/') || name.startsWith('\\') || /^[A-Za-z]:/.test(name) || name.includes('\0') || name.split(/[\\/]/).some((part) => part === '..');
}

/** Lists the entries of a zip held in memory. Throws a plain TypeError for anything unsafe or malformed. */
export function listZip(buffer, limits = ZIP_LIMITS) {
  if (!Buffer.isBuffer(buffer)) throw refuse('not a byte buffer');
  if (buffer.length > limits.compressed) throw refuse(`bigger than ${Math.round(limits.compressed / 1048576)} MB`);
  let at = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i -= 1) if (buffer.readUInt32LE(i) === EOCD) { at = i; break; }
  if (at < 0) throw refuse('not a zip file');
  const count = buffer.readUInt16LE(at + 10);
  if (count > limits.entries) throw refuse(`more than ${limits.entries} files`);
  let offset = buffer.readUInt32LE(at + 16);
  const entries = []; let expanded = 0;
  for (let n = 0; n < count; n += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CEN) throw refuse('damaged directory');
    const flags = buffer.readUInt16LE(offset + 8); const method = buffer.readUInt16LE(offset + 10);
    const csize = buffer.readUInt32LE(offset + 20); const size = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28); const extraLen = buffer.readUInt16LE(offset + 30); const commentLen = buffer.readUInt16LE(offset + 32);
    const external = buffer.readUInt32LE(offset + 38); const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;
    if (unsafeName(name)) throw refuse(`unsafe file name "${name.slice(0, 80)}"`);
    if (flags & 1) throw refuse('encrypted files are not supported');
    if (csize === 0xffffffff || size === 0xffffffff) throw refuse('zip64 archives are not supported');
    const mode = (external >>> 16) & 0o170000;
    if (mode === 0o120000) throw refuse(`"${name.slice(0, 80)}" is a link`);
    expanded += size;
    if (expanded > limits.expanded) throw refuse(`would expand beyond ${Math.round(limits.expanded / 1048576)} MB`);
    entries.push({ name, size, compressedSize: csize, method, local, directory: name.endsWith('/') });
  }
  return entries;
}

/** The bytes of one listed entry. The result is checked against the size the directory promised. */
export function readEntry(buffer, entry) {
  if (entry.directory) throw refuse(`"${entry.name}" is a folder`);
  const at = entry.local;
  if (at + 30 > buffer.length || buffer.readUInt32LE(at) !== LOC) throw refuse('damaged file header');
  const start = at + 30 + buffer.readUInt16LE(at + 26) + buffer.readUInt16LE(at + 28);
  const raw = buffer.subarray(start, start + entry.compressedSize);
  if (raw.length !== entry.compressedSize) throw refuse('file is cut short');
  let out;
  if (entry.method === 0) out = raw;
  else if (entry.method === 8) {
    try { out = inflateRawSync(raw, { maxOutputLength: entry.size + 1 }); } catch { throw refuse(`"${entry.name}" does not unpack to its stated size`); }
  } else throw refuse(`unsupported compression in "${entry.name}"`);
  if (out.length !== entry.size) throw refuse(`"${entry.name}" does not match its stated size`);
  return out;
}

/** True when the bytes look like text (no NUL bytes in the first 4 KB, valid UTF-8 round trip). */
export function looksLikeText(bytes) {
  const head = bytes.subarray(0, 4096);
  if (head.includes(0)) return false;
  return Buffer.from(head.toString('utf8'), 'utf8').length >= head.length - 3;
}
