// All calls go to the BFF (/auth, /api). The browser never sees a token.
async function call(path, opts = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...opts });
  let body = null;
  try { body = await res.json(); } catch { /* empty or non-JSON body */ }
  if (!res.ok) {
    const err = new Error((body && body.error) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

export const getPersonas = () => call('/auth/personas');
export const getMe = () => call('/auth/me');
export const login = (persona) => call('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona }) });
export const logout = () => call('/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });

export function list(endpoint, params = {}) {
  const qs = new URLSearchParams({ limit: '500', ...params }).toString();
  return call(`/api/v1/${endpoint}?${qs}`);
}
export const decide = (id, verdict) =>
  call(`/api/v1/approvals/${id}/${verdict}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });

// Which pages each role may open. The API and database enforce this too; this only hides dead links.
export const ACCESS = {
  owner: ['overview', 'signals', 'repairs', 'leases', 'money', 'risk'],
  property_manager: ['overview', 'signals', 'repairs', 'leases', 'money', 'risk', 'inbox'],
  maintenance_coordinator: ['overview', 'signals', 'repairs', 'risk', 'inbox'],
  leasing_manager: ['overview', 'signals', 'leases', 'risk'],
  data_owner: ['overview', 'signals', 'repairs', 'leases', 'money', 'risk'],
};
