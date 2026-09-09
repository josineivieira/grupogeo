// Read-only comparison against the local development database, never the deployed database.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import EmbeddedPostgres from 'embedded-postgres';
import { resolve } from 'node:path';
const config = JSON.parse(readFileSync('.local/config.json', 'utf8'));
const localServer = process.argv.includes('--start-local') ? new EmbeddedPostgres({
  databaseDir: resolve('.local/postgres'), user: 'geo', password: config.password,
  port: 55432, persistent: true, authMethod: 'scram-sha-256',
  postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: () => {},
}) : null;
if (localServer) await localServer.start();
const db = new PrismaClient({
  datasources: { db: { url: `postgresql://geo:${encodeURIComponent(config.password)}@127.0.0.1:55432/geo_rh?schema=public` } },
  log: [{ emit: 'event', level: 'query' }],
});
let queries = 0;
db.$on('query', () => { queries++; });
const include = {
  user: { include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } }, companies: true, branches: true } },
  environment: true,
};
function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, canonical(v)]));
  return value;
}
try {
  const sample = await db.session.findFirst({ select: { id: true, userId: true, environmentId: true } });
  assert(sample, 'A local session is required for this comparison.');
  const results = {};
  for (const strategy of ['query', 'join']) {
    queries = 0;
    const session = await db.session.findUniqueOrThrow({ where: { id: sample.id }, include, relationLoadStrategy: strategy });
    const roles = sample.environmentId ? await db.userEnvironmentRole.findMany({
      where: { userId: sample.userId, environmentId: sample.environmentId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
      relationLoadStrategy: strategy,
    }) : [];
    results[strategy] = canonical({ session, roles });
    console.log(`${strategy}: ${queries} SQL statements`);
  }
  assert.deepEqual(results.join, results.query);
  console.log('Session, organization scopes, roles and permissions match. No data modified.');
} catch (error) {
  console.error('Local query comparison failed:', error.code || error.name);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
  if (localServer) await localServer.stop();
}
