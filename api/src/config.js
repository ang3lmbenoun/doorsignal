// Configuration comes only from the environment (or a gitignored .env loaded by the caller).
export function loadConfig(env = process.env) {
  const databaseUrl = (env.API_DATABASE_URL || '').trim();
  const jwtSecret = env.JWT_SECRET || '';
  if (!databaseUrl) throw new Error('API_DATABASE_URL is not set');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be set and at least 32 characters');
  const port = Number.parseInt(env.PORT || '3000', 10);
  return { databaseUrl, jwtSecret, port: Number.isInteger(port) ? port : 3000 };
}
