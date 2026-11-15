// Lists the model ids a provider currently offers, filtered by a substring. Needs the provider key in .env.
//   node eval/catalog.js nvidia nemotron
// Prints ids only (never the key). Used to verify exact model ids before running the eval.
import { listModels, providerFor } from '../agent/llm.js';

try {
  process.loadEnvFile?.('../.env');
} catch {
  /* rely on the process environment */
}
const [name = 'nvidia', ...filters] = process.argv.slice(2);
const provider = providerFor(name, 'catalog-check');
if (!provider) {
  console.error(`no key configured for ${name}, or LLM_DATA_CLASS is not "synthetic"`);
  process.exit(2);
}
const ids = await listModels(provider);
const wanted = filters.length ? ids.filter((id) => filters.some((f) => id.toLowerCase().includes(f.toLowerCase()))) : ids;
console.log(wanted.sort().join('\n'));
console.error(`${wanted.length} of ${ids.length} models`);
