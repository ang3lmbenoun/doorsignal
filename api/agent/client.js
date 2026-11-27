// Tier T0: read-only access to the DoorSignal API. GET only. The agent receives a ready-made token from the
// operator; it never holds JWT_SECRET and cannot mint or change a token.
export function createApiClient({ baseUrl, token, transport = (...a) => fetch(...a) }) {
  async function get(path) {
    const res = await transport(`${baseUrl}${path}`, { method: 'GET', headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`API GET ${path.split('?')[0]} failed with status ${res.status}`);
    return res.json();
  }

  // Follows limit/offset paging until a short page.
  async function getAll(path, query = {}) {
    const rows = [];
    for (let offset = 0; offset <= 100000; offset += 500) {
      const qs = new URLSearchParams({ ...query, limit: '500', offset: String(offset) });
      const body = await get(`${path}?${qs}`);
      rows.push(...body.rows);
      if (body.rows.length < 500) return rows;
    }
    throw new Error('too many pages');
  }

  return { get, getAll };
}
