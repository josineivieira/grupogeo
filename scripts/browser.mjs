import { chromium } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const config = JSON.parse(readFileSync('.local/config.json', 'utf8'));
const db = new PrismaClient({
  datasources: {
    db: { url: `postgresql://geo:${config.password}@127.0.0.1:55432/geo_rh?schema=public` },
  },
});
const role = await db.role.findUniqueOrThrow({ where: { name: 'Superadministrador' } });
const user = await db.user.create({
  data: {
    name: 'Verificação de interface',
    email: `ui-${Date.now()}@test.local`,
    passwordHash: await hash('Browser@1234', 12),
    allCompanies: true,
    roles: { create: { roleId: role.id } },
  },
});
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
mkdirSync('.local/screenshots', { recursive: true });
try {
  await page.goto('http://localhost:3000');
  await page.getByLabel('E-mail', { exact: true }).fill(user.email);
  await page.getByLabel('Senha', { exact: true }).fill('Browser@1234');
  await page.getByRole('button', { name: 'Entrar no sistema' }).click();
  await page.getByRole('heading', { name: 'Defina sua senha de acesso' }).waitFor();
  await page.getByLabel('Senha temporária').fill('Browser@1234');
  await page.getByLabel('Nova senha', { exact: true }).fill('Browser@5678');
  await page.getByRole('button', { name: 'Alterar senha e continuar' }).click();
  await page.getByRole('heading', { name: 'Visão geral de RH' }).waitFor();
  await page.getByText('Quadro ainda não cadastrado').waitFor();
  await page.screenshot({ path: '.local/screenshots/dashboard-desktop.png', fullPage: true });
  await page.goto('http://localhost:3000/employees');
  await page.getByRole('heading', { name: 'Funcionários', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Novo funcionário', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: 'Salvar registro', exact: true }).click();
  await page.getByText('Nome completo é obrigatório.').waitFor();
  await page.screenshot({ path: '.local/screenshots/employee-form.png', fullPage: true });
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.goto('http://localhost:3000/companies');
  await page.getByRole('heading', { name: 'Empresas', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Novo registro', exact: true }).click();
  await page.getByLabel('Nome fantasia').fill('Rascunho de teste');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.goto('http://localhost:3000/vacations');
  await page.getByRole('heading', { name: 'Gestão de férias' }).waitFor();
  await page.goto('http://localhost:3000/admin/audit-logs');
  await page.getByRole('heading', { name: 'Auditoria', exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://localhost:3000');
  await page.getByRole('heading', { name: 'Visão geral de RH' }).waitFor();
  await page.getByRole('button', { name: 'Recolher ou expandir menu' }).click();
  await page.screenshot({ path: '.local/screenshots/dashboard-mobile.png', fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'A página não deve transbordar horizontalmente',
  );
  await page.getByRole('button', { name: 'Alternar tema' }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.screenshot({ path: '.local/screenshots/dashboard-dark.png', fullPage: true });
  assert.deepEqual(errors, []);
  writeFileSync(
    '.local/browser-results.json',
    JSON.stringify(
      {
        passed: 7,
        checks: [
          'Login real',
          'Troca obrigatória de senha',
          'Dashboard integrado',
          'Validação do formulário',
          'Confirmação de descarte',
          'Navegação nos módulos',
          'Responsividade e tema escuro',
        ],
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log('7 verificações de navegador passaram. Nenhum erro de execução na página.');
} finally {
  await browser.close();
  await db.user.update({
    where: { id: user.id },
    data: { isActive: false, deletedAt: new Date() },
  });
  await db.session.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } });
  await db.$disconnect();
}
