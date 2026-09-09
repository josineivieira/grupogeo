import EmbeddedPostgres from 'embedded-postgres';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
const base = resolve('.local');
mkdirSync(base, { recursive: true });
const configFile = resolve(base, 'config.json');
if (!existsSync(configFile))
  writeFileSync(
    configFile,
    JSON.stringify({
      password: randomBytes(24).toString('hex'),
      jwtSecret: randomBytes(48).toString('hex'),
    }),
  );
const config = JSON.parse(readFileSync(configFile, 'utf8'));
if(!config.dataKey){config.dataKey=randomBytes(32).toString('hex');writeFileSync(configFile,JSON.stringify(config));}
const db = new EmbeddedPostgres({
  databaseDir: resolve(base, 'postgres'),
  user: 'geo',
  password: config.password,
  port: 55432,
  persistent: true,
  authMethod: 'scram-sha-256',
  postgresFlags: ['-h', '127.0.0.1'],
  onLog: () => {},
  onError: (message) => {
    if (String(message).includes('FATAL')) console.error(String(message));
  },
});
if (!existsSync(resolve(base, 'postgres', 'PG_VERSION'))) await db.initialise();
await db.start();
const pg = db.getPgClient();
await pg.connect();
const check = await pg.query("SELECT 1 FROM pg_database WHERE datname='geo_rh'");
await pg.end();
if (!check.rowCount) await db.createDatabase('geo_rh');
const env = {
  ...process.env,
  DATABASE_URL: `postgresql://geo:${config.password}@127.0.0.1:55432/geo_rh?schema=public`,
  JWT_SECRET: config.jwtSecret,
  DATA_ENCRYPTION_KEY:config.dataKey,
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  WEB_URL: 'http://localhost:3000',
  PORT: '3001',
  COOKIE_SECURE: 'false',
  UPLOAD_DIR: resolve(base, 'uploads'),
};
const run = (entry, args, cwd = process.cwd()) =>
  new Promise((accept, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd,
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('exit', (code) =>
      code === 0 ? accept() : reject(new Error(`Comando terminou com código ${code}`)),
    );
  });
try {
  await run(resolve('node_modules/prisma/build/index.js'), [
    'migrate',
    'deploy',
    '--schema',
    resolve('backend/prisma/schema.prisma'),
  ]);
  await run(resolve('node_modules/tsx/dist/cli.mjs'), [resolve('backend/prisma/seed.ts')]);
  const api = spawn(process.execPath, [resolve('backend/dist/main.js')], {
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  const web = spawn(
    process.execPath,
    [resolve('node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '-p', '3000'],
    { cwd: resolve('frontend'), env, stdio: 'inherit', windowsHide: true },
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    api.kill();
    web.kill();
    await db.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  console.log('GEO RH local: http://localhost:3000 | API: http://localhost:3001/api/docs');
} catch (error) {
  await db.stop();
  throw error;
}
