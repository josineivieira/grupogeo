// Keep a small per-process pool so overlapping deployments leave room for migrations.
export function databaseUrlWithPoolLimit(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL inválida. Configure uma conexão PostgreSQL válida.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('DATABASE_URL deve usar PostgreSQL.');
  if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '3');
  return url.toString();
}
