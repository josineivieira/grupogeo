import { readFileSync, writeFileSync } from 'node:fs';
const edit = (path, fn) => writeFileSync(path, fn(readFileSync(path, 'utf8')));
edit('backend/package.json', (s) => {
  const p = JSON.parse(s);
  p.scripts.dev = 'node ../scripts/dev-api.mjs';
  return JSON.stringify(p, null, 2);
});
edit('package.json', (s) => {
  const p = JSON.parse(s);
  Object.assign(p.scripts, {
    format: 'prettier --write .',
    'format:check': 'prettier --check .',
    'test:integration': 'node scripts/integration.mjs',
    'test:browser': 'node scripts/browser.mjs',
  });
  return JSON.stringify(p, null, 2);
});
edit('frontend/src/components/app.tsx', (s) =>
  s
    .replace('QueryClientProvider, useQuery', 'QueryClientProvider, useQuery, useQueryClient')
    .replace(
      'function Workspace(){const router=',
      'function Workspace(){const cache=useQueryClient();const router=',
    )
    .replace(
      "setToken(null);setActor(null);router.push('/');",
      "setToken(null);setActor(null);cache.clear();router.push('/');",
    ),
);
