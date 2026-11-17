// Shared fixtures for the agent tests. Synthetic data only. Importing this file also disables the network:
// agent unit tests use fake transports, and any stray fetch() fails loudly instead of reaching a provider.
globalThis.fetch = () => {
  throw new Error('network is disabled in agent unit tests');
};

export const mk = (id, { s01 = null, s02 = null, s09 = null, vendor = 'V01', unit = 'U0001', category = 'hvac', severity = 'routine', note } = {}) => ({
  work_order_id: id, unit_id: unit, vendor_id: vendor, category, severity, s01, s02, s09, ...(note ? { tenant_note: note } : {}),
});

export const s01 = (value, band) => ({
  value,
  band: band ?? (value >= 7 ? 'breach_presumed' : value >= 5 ? 'at_risk' : 'ok'),
});

// A fake provider response in the OpenAI-compatible envelope.
export const okResponse = (content) => ({
  ok: true, status: 200, headers: new Headers(),
  json: async () => ({ choices: [{ message: { content } }] }),
});
export const statusResponse = (status, headers = {}) => ({ ok: false, status, headers: new Headers(headers), json: async () => ({}) });

export const json = (flags = [], drafts = []) => JSON.stringify({ flags, drafts });
