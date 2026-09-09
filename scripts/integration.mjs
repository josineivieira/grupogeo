import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import pg from 'pg';
const config = JSON.parse(readFileSync('.local/config.json', 'utf8'));
const database = `geo_test_${Date.now()}`;
const admin = new pg.Client({
  host: '127.0.0.1',
  port: 55432,
  user: 'geo',
  password: config.password,
  database: 'postgres',
});
await admin.connect();
await admin.query(`CREATE DATABASE "${database}"`);
await admin.end();
const env = {
  ...process.env,
  DATABASE_URL: `postgresql://geo:${config.password}@127.0.0.1:55432/${database}?schema=public`,
  JWT_SECRET: config.jwtSecret,
  DATA_ENCRYPTION_KEY:config.dataKey,
  CORS_ORIGIN: 'http://localhost:3000',
  PORT: '3002',
  UPLOAD_DIR: resolve('.local/test-uploads'),
};
const run = (entry, args) =>
  new Promise((accept, reject) => {
    const c = spawn(process.execPath, [entry, ...args], { env, stdio: 'pipe', windowsHide: true });
    let output = '';
    c.stdout.on('data', (d) => (output += d));
    c.stderr.on('data', (d) => (output += d));
    c.on('exit', (code) => (code === 0 ? accept() : reject(new Error(output))));
  });
await run(resolve('node_modules/prisma/build/index.js'), [
  'migrate',
  'deploy',
  '--schema',
  resolve('backend/prisma/schema.prisma'),
]);
await run(resolve('node_modules/tsx/dist/cli.mjs'), [resolve('backend/prisma/seed.ts')]);
const server = spawn(process.execPath, [resolve('backend/dist/main.js')], {
  env,
  stdio: 'pipe',
  windowsHide: true,
});
let logs = '';
server.stdout.on('data', (d) => (logs += d));
server.stderr.on('data', (d) => (logs += d));
const base = 'http://127.0.0.1:3002/api';
let token;
const results = [];
async function call(path, method = 'GET', body, expected = 200, authorization = token) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
  return data;
}
async function test(name, fn) {
  await fn();
  results.push(name);
  console.log(`PASS ${name}`);
}
try {
  for (let n = 0; n < 60; n++) {
    try {
      if ((await fetch(base + '/healthz')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  await test('Rotas privadas recusam acesso anônimo', () =>
    call('/employees', 'GET', undefined, 401, null));
  const login = await call(
    '/auth/login',
    'POST',
    { email: 'admin@georh.local', password: 'Admin@123' },
    201,
  );
  token = login.data.accessToken;
  await test('Senha temporária bloqueia módulos', () => call('/employees', 'GET', undefined, 403));
  await call(
    '/auth/change-password',
    'POST',
    { currentPassword: 'Admin@123', newPassword: 'Integration@1234' },
    201,
  );
  const company = (
    await call(
      '/catalogs/companies',
      'POST',
      { name: 'Empresa de teste', legalName: 'Empresa de teste Ltda', cnpj: '11222333000181' },
      201,
    )
  ).data;
  const branch = (
    await call(
      '/catalogs/branches',
      'POST',
      { companyId: company.id, name: 'Filial teste', code: '001', cnpj: '11444777000161' },
      201,
    )
  ).data;
  const department = (
    await call(
      '/catalogs/departments',
      'POST',
      { companyId: company.id, name: 'Operações', code: 'OPS' },
      201,
    )
  ).data;
  const position = (
    await call(
      '/catalogs/positions',
      'POST',
      { departmentId: department.id, name: 'Analista' },
      201,
    )
  ).data;
  let employee;
  await test('Cadastro persiste estrutura e funcionário', async () => {
    employee = (
      await call(
        '/employees',
        'POST',
        {
          registration: 'T001',
          name: 'Funcionário de teste',
          cpf: '52998224725',
          birthDate: '1990-01-01',
          admissionDate: '2023-01-01',
          contractType: 'CLT',
          salary: '4500.00',
          companyId: company.id,
          branchId: branch.id,
          departmentId: department.id,
          jobPositionId: position.id,
        },
        201,
      )
    ).data;
    assert.equal(employee.name, 'Funcionário de teste');
  });
  await test('CPF duplicado é rejeitado', () =>
    call(
      '/employees',
      'POST',
      {
        registration: 'T002',
        name: 'Duplicado',
        cpf: '52998224725',
        birthDate: '1990-01-01',
        admissionDate: '2023-01-01',
        contractType: 'CLT',
        salary: '4500.00',
        companyId: company.id,
        branchId: branch.id,
        departmentId: department.id,
        jobPositionId: position.id,
      },
      409,
    ));
  await test('Salário não pode ser sobrescrito pelo CRUD', () =>
    call(`/employees/${employee.id}`, 'PATCH', { salary: '5000' }, 400));
  await test('Movimentação salarial preserva os valores anteriores', async () => {
    await call(
      `/employees/${employee.id}/movements`,
      'POST',
      {
        type: 'ALTERACAO_SALARIAL',
        effectiveDate: '2026-01-01',
        reason: 'Reajuste de teste',
        salary: '5000',
      },
      201,
    );
    const rows = (await call(`/employees/${employee.id}/salary-history`)).data;
    assert.equal(rows.length, 2);
    assert.equal(Number(rows[0].previousSalary), 4500);
    assert.equal(Number(rows[0].newSalary), 5000);
  });
  await call(`/vacations/accruals/${employee.id}/generate`, 'POST', undefined, 201);
  const accrual = (await call(`/vacations/accruals/${employee.id}`)).data.find((r) =>
    String(r.startDate).startsWith('2025'),
  );
  let vacation;
  await test('Férias em parcelas reservam saldo', async () => {
    vacation = (
      await call(
        '/vacations',
        'POST',
        { employeeId: employee.id, accrualId: accrual.id, startDate: '2026-10-01', days: 14 },
        201,
      )
    ).data;
    await call(
      '/vacations',
      'POST',
      { employeeId: employee.id, accrualId: accrual.id, startDate: '2026-11-01', days: 8 },
      201,
    );
    const p = (await call(`/vacations/accruals/${employee.id}`)).data.find(
      (r) => r.id === accrual.id,
    );
    assert.equal(p.balance, 8);
  });
  await test('Sobreposição de férias é rejeitada', () =>
    call(
      '/vacations',
      'POST',
      { employeeId: employee.id, accrualId: accrual.id, startDate: '2026-10-10', days: 8 },
      400,
    ));
  await test('Saldo insuficiente é rejeitado', () =>
    call(
      '/vacations',
      'POST',
      { employeeId: employee.id, accrualId: accrual.id, startDate: '2026-12-01', days: 9 },
      400,
    ));
  await test('Aprovação exige duas etapas', async () => {
    const a = await call(
      `/vacations/${vacation.id}/approve`,
      'POST',
      { comment: 'Aprovado pelo gestor' },
      201,
    );
    assert.equal(a.data.status, 'MANAGER_APPROVED');
    const b = await call(
      `/vacations/${vacation.id}/approve`,
      'POST',
      { comment: 'Aprovado pelo RH' },
      201,
    );
    assert.equal(b.data.status, 'APPROVED');
  });
  const roles = (await call('/admin/roles')).data;
  const viewer = (
    await call(
      '/admin/users',
      'POST',
      {
        name: 'Consulta Teste',
        email: 'consulta@test.local',
        password: 'Consulta@1234',
        roleIds: [roles.find((r) => r.name === 'Consulta').id],
        companyIds: [company.id],
        branchIds: [],
        allCompanies: false,
        isActive: true,
      },
      201,
    )
  ).data;
  const viewerLogin = await call(
    '/auth/login',
    'POST',
    { email: 'consulta@test.local', password: 'Consulta@1234' },
    201,
  );
  const viewerToken = viewerLogin.data.accessToken;
  await call(
    '/auth/change-password',
    'POST',
    { currentPassword: 'Consulta@1234', newPassword: 'Consulta@5678' },
    201,
    viewerToken,
  );
  await test('Consulta não recebe salário, CPF ou PIS', async () => {
    const e = (await call(`/employees/${employee.id}`, 'GET', undefined, 200, viewerToken)).data;
    assert.ok(!('salary' in e));
    assert.ok(!('cpf' in e));
    assert.ok(!('pis' in e));
  });
  await test('Permissões bloqueiam alteração e relatório salarial', async () => {
    await call(`/employees/${employee.id}`, 'PATCH', { name: 'Indevido' }, 403, viewerToken);
    await call('/reports/salaries', 'GET', undefined, 403, viewerToken);
  });
  await test('Exportações CSV, Excel e PDF são arquivos reais', async () => {
    for (const format of ['csv', 'xlsx', 'pdf']) {
      const r = await fetch(`${base}/reports/employees?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(r.status, 200);
      const buf = Buffer.from(await r.arrayBuffer());
      assert.ok(buf.length > 50);
      if (format === 'pdf') assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
      if (format === 'xlsx') assert.equal(buf.subarray(0, 2).toString(), 'PK');
    }
  });
  await test('Importação informa linha e campo inválidos', async () => {
    const r = await call(
      '/imports/validate',
      'POST',
      { kind: 'companies', rows: [{ name: 'Teste', legalName: 'Teste', cnpj: '123' }] },
      201,
    );
    assert.equal(r.data.valid, false);
    assert.equal(r.data.errors[0].line, 2);
  });
  await test('Auditoria registra exportação e salário', async () => {
    const r = await call('/admin/audit-logs?limit=100');
    assert.ok(r.data.some((a) => a.action === 'EXPORTACAO'));
    assert.ok(r.data.some((a) => a.action === 'ALTERACAO_SALARIAL'));
  });
  await test('Desligamento conclui checklist e preserva ficha', async () => {
    const t = (
      await call(
        '/workflows/terminations',
        'POST',
        {
          employeeId: employee.id,
          communicationDate: '2026-08-01',
          effectiveDate: '2026-09-01',
          type: 'Acordo',
          reason: 'Encerramento de teste',
          initiative: 'ACORDO',
        },
        201,
      )
    ).data;
    await call(`/workflows/terminations/${t.id}/complete`, 'POST', undefined, 400);
    for (const item of t.checklist)
      await call(
        `/workflows/terminations/${t.id}/checklist/${item.id}`,
        'PATCH',
        { completed: true },
        200,
      );
    await call(`/workflows/terminations/${t.id}/complete`, 'POST', undefined, 201);
    assert.equal((await call(`/employees/${employee.id}`)).data.status, 'TERMINATED');
  });
  await test('Logout revoga o access token', async () => {
    await call('/auth/logout', 'POST', undefined, 201, viewerToken);
    await call('/auth/me', 'GET', undefined, 401, viewerToken);
  });
  writeFileSync(
    '.local/integration-results.json',
    JSON.stringify(
      { date: new Date().toISOString(), database, passed: results.length, tests: results },
      null,
      2,
    ),
  );
  console.log(`${results.length} testes de integração passaram.`);
} finally {
  server.kill();
  writeFileSync('.local/integration-server.log', logs);
}
