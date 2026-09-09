import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { hash } from 'bcrypt';
import { z } from 'zod';
import { Permission } from './auth';
import { AuthRequest, Database, audit, ok, pagination, parse, json } from './core';
import { vacationRules } from './vacations';
import { securitySchema } from './security';
export const userDto = z
  .object({
    name: z.string().trim().min(3, 'Informe um nome com pelo menos 3 caracteres.'),
    email: z.email('Informe um e-mail válido.').transform((v) => v.toLowerCase()),
    password: z
      .string()
      .min(10, 'A senha deve ter pelo menos 10 caracteres.')
      .max(72, 'A senha deve ter no máximo 72 caracteres.')
      .regex(/[A-Z]/, 'Inclua uma letra maiúscula na senha.')
      .regex(/[a-z]/, 'Inclua uma letra minúscula na senha.')
      .regex(/\d/, 'Inclua um número na senha.')
      .regex(/[^A-Za-z0-9]/, 'Inclua um símbolo na senha.')
      .optional(),
    roleIds: z.array(z.uuid()).min(1, 'Selecione pelo menos um perfil na seção Perfis, além dos acessos por ambiente.'),
    environmentRoles: z.array(z.object({ environmentId: z.uuid(), roleIds: z.array(z.uuid()).min(1) })).default([]),
    companyIds: z.array(z.uuid()),
    branchIds: z.array(z.uuid()),
    allCompanies: z.boolean(),
    employeeId: z.uuid().optional(),
    isActive: z.boolean().default(true),
  })
  .strict();
@ApiTags('Administração')
@ApiBearerAuth()
@Controller('admin')
export class AdminController {
  constructor(private readonly db: Database) {}
  private full(req: AuthRequest) {
    if (!req.actor.allCompanies)
      throw new BadRequestException(
        'A administração de acessos exige abrangência organizacional total.',
      );
  }
  @Get('users') @Permission('users.view') async users(
    @Query() query: unknown,
    @Req() req: AuthRequest,
  ) {
    this.full(req);
    const q = parse(pagination, query),
      where = {
        deletedAt: null,
        ...(q.search ? { name: { contains: q.search, mode: 'insensitive' as const } } : {}),
      };
    const [data, total] = await Promise.all([
      this.db.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          allCompanies: true,
          employeeId: true,
          lastLoginAt: true,
          roles: { include: { role: { select: { id: true, name: true } } } },
          environmentAccesses: { include: { environment: true } },
          environmentRoles: { include: { role: { select: { id: true, name: true } } } },
          companies: true,
          branches: true,
        },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { name: 'asc' },
      }),
      this.db.user.count({ where }),
    ]);
    return ok(data, 'Usuários consultados.', {
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.ceil(total / q.limit),
    });
  }
  @Get('environments') @Permission('users.view') async environments(@Req() req: AuthRequest) {
    this.full(req);
    return ok(await this.db.environment.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }));
  }
  @Get('roles') @Permission('users.view') async roles(@Req() req: AuthRequest) {
    this.full(req);
    return ok(
      await this.db.role.findMany({
        include: { permissions: { include: { permission: true } } },
        orderBy: { name: 'asc' },
      }),
    );
  }
  @Get('permissions') @Permission('roles.view') async permissions() {
    return ok(await this.db.permission.findMany({ orderBy: { code: 'asc' } }));
  }
  @Post('users') @Permission('users.create') async createUser(
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    this.full(req);
    const dto = parse(userDto, body);
    if (!dto.password) throw new BadRequestException('Informe uma senha temporária.');
    return this.db.$transaction(async (tx) => {
      const environmentRoleIds = dto.environmentRoles.flatMap((environment) => environment.roleIds);
      const granted = await tx.rolePermission.findMany({
        where: { roleId: { in: [...new Set([...dto.roleIds, ...environmentRoleIds])] } },
        include: { permission: true },
      });
      if (granted.some((p) => !req.actor.permissions.includes(p.permission.code)))
        throw new BadRequestException('Não é permitido conceder permissões superiores às suas.');
      const { password, roleIds, companyIds, branchIds, environmentRoles, ...data } = dto;
      const row = await tx.user.create({
        data: {
          ...data,
          passwordHash: await hash(password!, 12),
          roles: { create: roleIds.map((roleId) => ({ roleId })) },
          environmentAccesses: { create: dto.environmentRoles.map((environment) => ({ environmentId: environment.environmentId })) },
          environmentRoles: { create: dto.environmentRoles.flatMap((environment) => environment.roleIds.map((roleId) => ({ environmentId: environment.environmentId, roleId }))) },
          companies: { create: companyIds.map((companyId) => ({ companyId })) },
          branches: { create: branchIds.map((branchId) => ({ branchId })) },
        },
        select: { id: true, name: true, email: true },
      });
      await audit(tx, req, 'CRIACAO', 'users', row.id, undefined, row);
      return ok(row, 'Usuário criado com troca de senha obrigatória.');
    });
  }
  @Patch('users/:id') @Permission('users.update') async updateUser(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    this.full(req);
    parse(z.uuid(), id);
    if (id === req.actor.id)
      throw new BadRequestException(
        'Use Meu perfil para alterar seus dados. Acesso próprio não pode ser reduzido nesta tela.',
      );
    const dto = parse(userDto.omit({ password: true }), body);
    return this.db.$transaction(async (tx) => {
      const target = await tx.user.findUniqueOrThrow({
        where: { id },
        include: { roles: { include: { role: true } } },
      });
      if (target.roles.some((r) => r.role.name === 'Superadministrador'))
        throw new BadRequestException(
          'A conta de superadmin está protegida contra alterações por esta rotina.',
        );
      const environmentRoleIds = dto.environmentRoles.flatMap((environment) => environment.roleIds);
      const granted = await tx.rolePermission.findMany({
        where: { roleId: { in: [...new Set([...dto.roleIds, ...environmentRoleIds])] } },
        include: { permission: true },
      });
      if (granted.some((p) => !req.actor.permissions.includes(p.permission.code)))
        throw new BadRequestException('Não é permitido conceder permissões superiores às suas.');
      const { roleIds, companyIds, branchIds, environmentRoles, ...data } = dto;
      await tx.user.update({
        where: { id },
        data: {
          ...data,
          roles: { deleteMany: {}, create: roleIds.map((roleId) => ({ roleId })) },
          companies: { deleteMany: {}, create: companyIds.map((companyId) => ({ companyId })) },
          branches: { deleteMany: {}, create: branchIds.map((branchId) => ({ branchId })) },
          environmentAccesses: { deleteMany: {}, create: environmentRoles.map((environment) => ({ environmentId: environment.environmentId })) },
          environmentRoles: { deleteMany: {}, create: environmentRoles.flatMap((environment) => environment.roleIds.map((roleId) => ({ environmentId: environment.environmentId, roleId }))) },
        },
      });
      await tx.session.updateMany({ where: { userId: id }, data: { revokedAt: new Date() } });
      await audit(tx, req, 'EDICAO', 'users', id, undefined, dto);
      return ok(null, 'Acesso atualizado. Sessões anteriores encerradas.');
    });
  }
  @Post('roles') @Permission('roles.create') async createRole(
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    this.full(req);
    const dto = parse(
      z.object({ name: z.string().min(3), permissions: z.array(z.string()) }).strict(),
      body,
    );
    if (dto.permissions.some((p) => !req.actor.permissions.includes(p)))
      throw new BadRequestException('Permissão fora do seu perfil.');
    return this.db.$transaction(async (tx) => {
      const permissions = await tx.permission.findMany({
        where: { code: { in: dto.permissions } },
      });
      const role = await tx.role.create({
        data: {
          name: dto.name,
          permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
        },
      });
      await audit(tx, req, 'CRIACAO', 'roles', role.id, undefined, dto);
      return ok(role, 'Perfil criado.');
    });
  }
  @Get('settings') async settings(@Req() req: AuthRequest) {
    const rows = await this.db.systemSetting.findMany({
      where: req.actor.permissions.includes('settings.view')
        ? {}
        : { key: { in: ['general', 'documentTypes', 'benefitTypes'] } },
    });
    return ok(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  }
  @Patch('settings/:key') @Permission('settings.update') async saveSetting(
    @Param('key') key: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const schemas: Record<string, z.ZodType> = {
      security:securitySchema,
      general: z
        .object({
          name: z.string().min(2).max(70),
          locale: z.literal('pt-BR'),
          timezone: z.literal('America/Sao_Paulo'),
          currency: z.literal('BRL'),
          primaryColor: z.string().regex(/^#[a-fA-F0-9]{6}$/),
          logoId:z.uuid().nullable().optional(),
          faviconId:z.uuid().nullable().optional(),
        })
        .strict(),
      vacations: vacationRules.strict(),
      alerts: z.object({ days: z.array(z.number().int().min(0).max(365)).min(1).max(20) }).strict(),
    };
    if (!schemas[key]) throw new BadRequestException('Parâmetro não editável nesta rotina.');
    const value = json(parse(schemas[key], body));
    if(key==='general'&&typeof value==='object'&&value!==null&&!Array.isArray(value))for(const field of ['logoId','faviconId']){
      const assetId=(value as Record<string, unknown>)[field];if(typeof assetId==='string'&&!await this.db.visualAsset.findFirst({where:{id:assetId,category:{in:['LOGO','FAVICON']}}}))throw new BadRequestException('Arquivo de identidade visual inválido.');
    }
    return this.db.$transaction(async (tx) => {
      const before = await tx.systemSetting.findUnique({ where: { key } });
      const after = await tx.systemSetting.upsert({
        where: { key },
        create: { key, value, updatedBy: req.actor.id },
        update: { value, updatedBy: req.actor.id },
      });
      await audit(tx, req, 'CONFIGURACAO', 'settings', key, before, after);
      return ok(after, 'Configuração salva.');
    });
  }
  @Get('audit-logs') @Permission('audit.view') async logs(
    @Query() query: unknown,
    @Req() req: AuthRequest,
  ) {
    this.full(req);
    const q = parse(
      pagination.extend({
        module: z.string().optional(),
        action: z.string().optional(),
        userId: z.uuid().optional(),
      }),
      query,
    );
    const where = {
      ...(q.module ? { module: q.module } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lt: new Date(new Date(q.to).getTime() + 86400000) } : {}),
            },
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.db.auditLog.count({ where }),
    ]);
    return ok(data, 'Auditoria consultada.', {
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.ceil(total / q.limit),
    });
  }
}
