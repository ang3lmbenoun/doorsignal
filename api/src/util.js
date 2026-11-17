export const MAX_LIMIT = 500;
export const MAX_OFFSET = 100000;

// limit/offset from the query string, or null when malformed or out of range.
export function parsePaging(query) {
  const out = { limit: 100, offset: 0 };
  for (const key of ['limit', 'offset']) {
    if (query[key] === undefined) continue;
    const v = query[key];
    if (typeof v !== 'string' || !/^\d{1,7}$/.test(v)) return null;
    out[key] = Number.parseInt(v, 10);
  }
  if (out.limit < 1 || out.limit > MAX_LIMIT || out.offset > MAX_OFFSET) return null;
  return out;
}

export const reply = (res, status, error) => res.status(status).json({ error });
