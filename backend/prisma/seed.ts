import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';
import { defaultSecurity } from '../src/security';
const db = new PrismaClient();
async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@georh.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'Admin@123');
  if (adminPassword.length < 12 && process.env.NODE_ENV === 'production')
    throw new Error('Configure SEED_ADMIN_PASSWORD com pelo menos 12 caracteres.');
  const modules = [
    'employees',
    'companies',
    'branches',
    'departments',
    'sectors',
    'positions',
    'cost-centers',
    'work-schedules',
    'contacts',
    'dependents',
    'documents',
    'benefits',
    'allowances',
    'movements',
    'admissions',
    'terminations',
    'experience',
    'vacations',
    'health',
    'leaves',
    'alerts',
    'users',
    'roles',
    'settings',
  ];
  const codes = [
    ...modules.flatMap((m) =>
      ['view', 'create', 'update', 'delete', 'export'].map((a) => `${m}.${a}`),
    ),
    'employees.view_all',
    'employees.view_salary',
    'employees.view_personal',
    'employees.view_bank',
    'employees.view_documents',
    'employees.update_salary',
    'health.view_sensitive',
    'vacations.approve',
    'vacations.approve_manager',
    'vacations.cancel',
    'reports.view',
    'reports.export',
    'audit.view',
    'users.disable',
    'imports.create',
  ];
  for (const code of codes)
    await db.permission.upsert({ where: { code }, create: { code }, update: {} });
  const all = await db.permission.findMany();
  const profiles: Record<string, string[]> = {
    Superadministrador: codes,
    Administrador: codes.filter((c) => c !== 'roles.delete'),
    RH: codes.filter((c) => !['users', 'roles', 'settings', 'audit'].includes(c.split('.')[0])),
    Gestor: [
      'employees.view',
      'vacations.view',
      'vacations.approve_manager',
      'leaves.view',
      'alerts.view',
    ],
    Consulta: ['employees.view'],
    Funcionário: ['employees.view', 'vacations.view'],
  };
  for (const [name, permissions] of Object.entries(profiles)) {
    const role = await db.role.upsert({ where: { name }, create: { name }, update: {} });
    for (const p of all.filter((p) => permissions.includes(p.code)))
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } },
        create: { roleId: role.id, permissionId: p.id },
        update: {},
      });
  }
  const role = await db.role.findUniqueOrThrow({ where: { name: 'Superadministrador' } });
  const environments = [
    { code: 'GOVERNANCE', slug: 'governanca', name: 'Governança Geo', description: 'Governança, riscos, compliance e processos.', icon: 'ShieldCheck', sortOrder: 1 },
    { code: 'HR', slug: 'rh', name: 'Recursos Humanos Geo', description: 'Gestão de pessoas e Recursos Humanos.', icon: 'Users', sortOrder: 2 },
    { code: 'MAINTENANCE', slug: 'manutencao', name: 'Manutenção Geo', description: 'Gestão de ativos, equipamentos e manutenção.', icon: 'Wrench', sortOrder: 3 },
  ];
  for (const environment of environments)
    await db.environment.upsert({ where: { code: environment.code }, create: environment, update: environment });
  await db.user.upsert({
    where: { email: adminEmail },
    create: {
      name: 'Administrador',
      email: adminEmail,
      passwordHash: await hash(adminPassword, 12),
      allCompanies: true,
      mustChangePassword: true,
      roles: { create: { roleId: role.id } },
    },
    update: {},
  });
  const users = await db.user.findMany({ include: { roles: true } });
  const hr = await db.environment.findUniqueOrThrow({ where: { code: 'HR' } });
  for (const user of users) {
    await db.userEnvironmentAccess.upsert({
      where: { userId_environmentId: { userId: user.id, environmentId: hr.id } },
      create: { userId: user.id, environmentId: hr.id },
      update: { isActive: true },
    });
    for (const userRole of user.roles)
      await db.userEnvironmentRole.upsert({
        where: { userId_environmentId_roleId: { userId: user.id, environmentId: hr.id, roleId: userRole.roleId } },
        create: { userId: user.id, environmentId: hr.id, roleId: userRole.roleId },
        update: {},
      });
  }
  const settings = {
    security:defaultSecurity,
    general: {
      name: 'GRUPO GEO',
      locale: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      currency: 'BRL',
      primaryColor: '#16324f',
    },
    vacations: {
      defaultDays: 30,
      maxInstallments: 3,
      minDays: 5,
      minLongPeriod: 14,
      maxSoldDays: 10,
      managerApproval: true,
    },
    alerts: { days: [90, 60, 30, 15, 7, 0] },
    documentTypes: [
      'RG',
      'CPF',
      'CNH',
      'Comprovante de residência',
      'Carteira de trabalho',
      'Certidão de nascimento',
      'Certidão de casamento',
      'Título de eleitor',
      'Reservista',
      'Escolaridade',
      'Certificados',
      'Contrato',
      'Outros',
    ],
    benefitTypes: [
      'Vale-transporte',
      'Vale-refeição',
      'Vale-alimentação',
      'Cesta básica',
      'Plano de saúde',
      'Plano odontológico',
      'Seguro de vida',
      'Auxílio combustível',
      'Auxílio creche',
      'Outros',
    ],
    movementTypes: [
      'Admissão',
      'Transferência',
      'Promoção',
      'Alteração salarial',
      'Afastamento',
      'Retorno',
      'Férias',
      'Desligamento',
      'Recontratação',
    ],
  };
  for (const [key, value] of Object.entries(settings))
    await db.systemSetting.upsert({ where: { key }, create: { key, value }, update: {} });
  console.log(
    'Seed concluído. O administrador deve trocar a senha no primeiro acesso. Nenhum funcionário fictício foi criado.',
  );
}
main().finally(() => db.$disconnect());
