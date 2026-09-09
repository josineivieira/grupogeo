import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const child = spawn(
  process.execPath,
  ['--watch', '-r', 'ts-node/register', resolve('src/main.ts')],
  { stdio: 'inherit', windowsHide: true, env: process.env },
);
process.on('SIGINT', () => child.kill());
child.on('exit', (code) => process.exit(code ?? 0));
