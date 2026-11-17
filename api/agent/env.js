// Reads only the variables a process needs from the environment and the repo's gitignored .env, and returns them
// as a plain object. It never copies the whole file into process.env, so a process that loads its settings this
// way cannot see the main database URL, owner credentials or other keys that happen to sit in the same .env.
// Real environment variables win over the file.
import fs from 'node:fs';

export function loadEnvAllowlist(file, names, base = process.env) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    /* no file: environment only */
  }
  const parsed = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    parsed[m[1]] = v;
  }
  const out = {};
  for (const n of names) {
    const v = base[n] !== undefined && base[n] !== '' ? base[n] : parsed[n];
    if (v !== undefined && v !== '') out[n] = v;
  }
  return out;
}
