import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Post,
  Req,
  Res,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { compare, hash } from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { sign, verify } from 'jsonwebtoken';
import type { Response } from 'express';
import { createTransport } from 'nodemailer';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { Actor, AuthRequest, Database, audit, ok, parse } from './core';
import { securityPolicy } from './security';

export const Public = () => SetMetadata('public', true);
export const Permission = (code: string) => SetMetadata('permission', code);
const password = z
  .string()
  .min(10)
  .max(72)
  .regex(/[A-Z]/, 'Inclua uma letra maiúscula.')
  .regex(/[a-z]/)
  .regex(/\d/)
  .regex(/[^A-Za-z0-9]/);
const tokenHash = (v: string) => createHash('sha256').update(v).digest('hex');
export function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32)
    throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres.');
  return secret;
}
const actorSessionInclude = {
  user: { include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } }, companies: true, branches: true } },
  environment: true,
} satisfies Prisma.SessionInclude;
type ActorSession = Prisma.SessionGetPayload<{ include: typeof actorSessionInclude }>;
async function buildActor(db: Database, sessionId: string, userId: string, loadedSession?: ActorSession): Promise<Actor> {
  const session = loadedSession ?? await db.session.findFirstOrThrow({
    relationLoadStrategy: 'join',
    where: { id: sessionId, userId },
    include: actorSessionInclude,
  });
  const u = session.user;
  const legacyRoles = u.roles.map((r) => r.role.name);
  const isGlobalSuperAdmin = legacyRoles.includes('Superadministrador');
  const environmentRoles = session.environmentId
    ? await db.userEnvironmentRole.findMany({
        relationLoadStrategy: 'join',
        where: { userId, environmentId: session.environmentId },
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      })
    : [];
  const roles = environmentRoles.length ? environmentRoles.map((r) => r.role.name) : session.environment?.code === 'HR' ? legacyRoles : [];
  const permissions = environmentRoles.length
    ? [...new Set(environmentRoles.flatMap((r) => r.role.permissions.map((p) => p.permission.code)))]
    : session.environment?.code === 'HR'
      ? [...new Set(u.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.code)))]
      : [];
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    permissions,
    roles,
    companyIds: u.companies.map((c) => c.companyId),
    branchIds: u.branches.map((b) => b.branchId),
    allCompanies: u.allCompanies,
    employeeId: u.employeeId,
    mustChangePassword: u.mustChangePassword,
    theme: u.theme,
    sessionId,
    photoId: u.photoId,
    environmentId: session.environmentId,
    environmentCode: session.environment?.code ?? null,
    isGlobalSuperAdmin,
  };
}
async function availableEnvironments(db: Database, userId: string, isGlobalSuperAdmin: boolean) {
  return db.environment.findMany({
    where: { isActive: true, ...(isGlobalSuperAdmin ? {} : { userAccesses: { some: { userId, isActive: true } } }) },
    select: { id: true, code: true, slug: true, name: true, description: true, icon: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' },
  });
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly db: Database,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>('public', [ctx.getHandler(), ctx.getClass()]))
      return true;
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    let claims;
    try {
      claims = verify(req.headers.authorization?.replace(/^Bearer /, '') ?? '', jwtSecret(), {
        algorithms: ['HS256'],
        issuer: 'geo-rh',
        audience: 'geo-web',
      });
    } catch {
      throw new UnauthorizedException('Sessão expirada. Entre novamente.');
    }
    if (
      typeof claims === 'string' ||
      typeof claims.sub !== 'string' ||
      typeof claims.sid !== 'string'
    )
      throw new UnauthorizedException();
    const session = await this.db.session.findFirst({
      relationLoadStrategy: 'join',
      where: { id: claims.sid, userId: claims.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      include: actorSessionInclude,
    });
    if (!session || !session.user.isActive || session.user.deletedAt)
      throw new UnauthorizedException('Sua sessão foi encerrada.');
    const u = session.user;
    const policy=await securityPolicy(this.db);
    if(session.lastSeenAt.getTime()+policy.sessionMinutes*60000<Date.now()){
      await this.db.session.update({where:{id:session.id},data:{revokedAt:new Date()}});
      throw new UnauthorizedException('Sessão encerrada por inatividade. Entre novamente.');
    }
    await this.db.session.update({where:{id:session.id},data:{lastSeenAt:new Date()}});
    if(policy.passwordExpiryDays>0&&u.passwordChangedAt.getTime()+policy.passwordExpiryDays*86400000<Date.now()){
      u.mustChangePassword=true;
      await this.db.user.update({where:{id:u.id},data:{mustChangePassword:true}});
    }
    req.actor = await buildActor(this.db, session.id, u.id, session);
    if (
      u.mustChangePassword &&
      !['/api/auth/me', '/api/auth/change-password', '/api/auth/logout'].includes(req.path)
    )
      throw new ForbiddenException('Altere a senha temporária antes de acessar os módulos.');
    if (!req.actor.environmentId && !req.path.startsWith('/api/auth/'))
      throw new ForbiddenException('Selecione um ambiente para continuar.');
    const p = this.reflector.getAllAndOverride<string>('permission', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (p && !req.actor.permissions.includes(p))
      throw new ForbiddenException('Seu perfil não permite esta operação.');
    return true;
  }
}
@ApiTags('Autenticação')
@Controller('auth')
export class AuthController {
  constructor(private readonly db: Database) {}
  private cookie(res: Response, value: string, days=7) {
    res.cookie('geo_refresh', value, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: days * 86400000,
    });
  }
  private access(userId: string, sessionId: string) {
    return sign({ sid: sessionId }, jwtSecret(), {
      subject: userId,
      expiresIn: '15m',
      issuer: 'geo-rh',
      audience: 'geo-web',
    });
  }
  @Post('login')
  @Public()
  @Throttle({ default: { limit: 8, ttl: 60000 } })
  @ApiOperation({ summary: 'Entrar com e-mail e senha' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'password'],
      properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string', format: 'password' },
      },
    },
  })
  async login(
    @Body() body: unknown,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const dto = parse(
      z
        .object({
          email: z.email().transform((v) => v.toLowerCase()),
          password: z.string().max(72),
        })
        .strict(),
      body,
    );
    const u = await this.db.user.findUnique({ where: { email: dto.email } });
    const valid = await compare(
      dto.password,
      u?.passwordHash ?? '$2b$12$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    );
    if (
      !u ||
      !valid ||
      !u.isActive ||
      u.deletedAt ||
      (u.lockedUntil && u.lockedUntil > new Date())
    ) {
      if (u && (!u.lockedUntil || u.lockedUntil <= new Date())) {
        const policy=await securityPolicy(this.db);
        const attempts = u.lockedUntil && u.lockedUntil <= new Date() ? 1 : u.failedAttempts + 1;
        await this.db.user.update({
          where: { id: u.id },
          data: {
            failedAttempts: attempts,
            lockedUntil: attempts >= policy.maxAttempts ? new Date(Date.now() + policy.lockMinutes * 60000) : null,
          },
        });
      }
      await audit(this.db, req, 'LOGIN_FALHOU', 'auth');
      throw new UnauthorizedException('Credenciais inválidas ou acesso temporariamente bloqueado.');
    }
    const policy=await securityPolicy(this.db);
    const refresh = randomBytes(48).toString('hex');
    const session = await this.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: u.id },
        data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      });
      return tx.session.create({
        data: {
          userId: u.id,
          tokenHash: tokenHash(refresh),
          expiresAt: new Date(Date.now() + policy.refreshDays * 86400000),
          ip: req.ip ?? '',
          userAgent: req.get('user-agent') ?? '',
        },
      });
    });
    const globalSuperAdmin = !!(await this.db.userRole.findFirst({ where: { userId: u.id, role: { name: 'Superadministrador' } } }));
    const environments = await availableEnvironments(this.db, u.id, globalSuperAdmin);
    const environmentId = environments.length === 1 ? environments[0].id : null;
    const sessionWithEnvironment = await this.db.session.update({ where: { id: session.id }, data: { environmentId } });
    req.actor = await buildActor(this.db, sessionWithEnvironment.id, u.id);
    await audit(this.db, req, 'LOGIN', 'auth', session.id);
    this.cookie(res, refresh,policy.refreshDays);
    return ok({
      accessToken: this.access(u.id, session.id),
      mustChangePassword: u.mustChangePassword,
      environmentId,
      environmentCount: environments.length,
    });
  }
  @Get('environments') @ApiBearerAuth() async environments(@Req() req: AuthRequest) {
    return ok(await availableEnvironments(this.db, req.actor.id, req.actor.isGlobalSuperAdmin));
  }
  @Post('environment') @ApiBearerAuth() async selectEnvironment(@Body() body: unknown, @Req() req: AuthRequest) {
    const dto = parse(z.object({ environmentId: z.uuid().optional(), environmentCode: z.string().min(2).optional() }).refine((v) => v.environmentId || v.environmentCode).strict(), body);
    const environment = await this.db.environment.findFirst({ where: { isActive: true, ...(dto.environmentId ? { id: dto.environmentId } : { code: dto.environmentCode }) } });
    if (!environment) throw new ForbiddenException('Ambiente indisponível.');
    const allowed = req.actor.isGlobalSuperAdmin || await this.db.userEnvironmentAccess.findFirst({ where: { userId: req.actor.id, environmentId: environment.id, isActive: true } });
    if (!allowed) throw new ForbiddenException('Você não possui acesso a este ambiente.');
    const previous = req.actor.environmentId;
    await this.db.session.update({ where: { id: req.actor.sessionId }, data: { environmentId: environment.id } });
    req.actor = await buildActor(this.db, req.actor.sessionId, req.actor.id);
    await audit(this.db, req, previous ? 'ENVIRONMENT_SWITCHED' : 'ENVIRONMENT_SELECTED', 'auth', environment.id, undefined, { environmentCode: environment.code });
    return ok({ environment, actor: req.actor }, 'Ambiente selecionado.');
  }
  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Rotacionar refresh token HttpOnly' })
  async refresh(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    if (req.get('origin') !== process.env.CORS_ORIGIN)
      throw new ForbiddenException('Origem de sessão não autorizada.');
    const cookie = (req.cookies as Record<string, string | undefined>).geo_refresh;
    if (!cookie) throw new UnauthorizedException('Sessão não encontrada.');
    const next = randomBytes(48).toString('hex');
    const session = await this.db.$transaction(async (tx) => {
      const old = await tx.session.findUnique({
        where: { tokenHash: tokenHash(cookie) },
        include: { user: true },
      });
      const policy=await securityPolicy(tx);
      if(old&&old.lastSeenAt.getTime()+policy.sessionMinutes*60000<Date.now())throw new UnauthorizedException('Sessão encerrada por inatividade.');
      if (
        !old ||
        old.revokedAt ||
        old.expiresAt < new Date() ||
        !old.user.isActive ||
        old.user.deletedAt
      )
        throw new UnauthorizedException('Sessão expirada.');
      const consumed = await tx.session.updateMany({
        where: { id: old.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (consumed.count !== 1) throw new UnauthorizedException('Sessão já renovada.');
      return tx.session.create({
        data: {
          userId: old.userId,
          environmentId: old.environmentId,
          tokenHash: tokenHash(next),
          expiresAt: old.expiresAt,
          ip: req.ip ?? '',
          userAgent: req.get('user-agent') ?? '',
        },
      });
    });
    this.cookie(res, next);
    return ok({ accessToken: this.access(session.userId, session.id) });
  }
  @Get('me') @ApiBearerAuth() me(@Req() req: AuthRequest) {
    return ok(req.actor);
  }
  @Post('logout') @ApiBearerAuth() async logout(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.db.session.updateMany({
      where: { id: req.actor.sessionId, userId: req.actor.id },
      data: { revokedAt: new Date() },
    });
    res.clearCookie('geo_refresh', { path: '/api/auth' });
    await audit(this.db, req, 'LOGOUT', 'auth');
    return ok(null, 'Sessão encerrada.');
  }
  @Post('change-password') @ApiBearerAuth() async change(
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const dto = parse(
      z.object({ currentPassword: z.string(), newPassword: password }).strict(),
      body,
    );
    const u = await this.db.user.findUniqueOrThrow({ where: { id: req.actor.id } });
    const policy=await securityPolicy(this.db);
    if(dto.newPassword.length<policy.minPasswordLength)throw new ForbiddenException(`A senha deve ter pelo menos ${policy.minPasswordLength} caracteres.`);
    if (!(await compare(dto.currentPassword, u.passwordHash)))
      throw new UnauthorizedException('A senha atual está incorreta.');
    if (await compare(dto.newPassword, u.passwordHash))
      throw new ForbiddenException('A nova senha deve ser diferente da senha atual.');
    await this.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: u.id },
        data: { passwordHash: await hash(dto.newPassword, 12), mustChangePassword: false,passwordChangedAt:new Date() },
      });
      await tx.session.updateMany({
        where: { userId: u.id, id: { not: req.actor.sessionId } },
        data: { revokedAt: new Date() },
      });
      await audit(tx, req, 'ALTERACAO_SENHA', 'auth', u.id);
    });
    return ok(null, 'Senha alterada.');
  }
  @Public() @Post('forgot-password') @Throttle({ default: { limit: 3, ttl: 60000 } }) async forgot(
    @Body() body: unknown,
  ) {
    const { email } = parse(
      z.object({ email: z.email().transform((v) => v.toLowerCase()) }).strict(),
      body,
    );
    const u = await this.db.user.findUnique({ where: { email } });
    if (u && u.isActive && !u.deletedAt && process.env.SMTP_HOST) {
      const token = randomBytes(48).toString('hex');
      await this.db.passwordResetToken.create({
        data: {
          userId: u.id,
          tokenHash: tokenHash(token),
          expiresAt: new Date(Date.now() + 30 * 60000),
        },
      });
      await createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_PORT === '465',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
      }).sendMail({
        from: process.env.SMTP_FROM,
        to: u.email,
        subject: 'Redefinição de senha — GEO RH',
        text: `Redefina sua senha em até 30 minutos: ${process.env.WEB_URL}/?reset=${token}`,
      });
    }
    return ok(
      null,
      'Se o endereço estiver cadastrado e o envio de e-mail estiver configurado, você receberá as instruções.',
    );
  }
  @Public() @Post('reset-password') async reset(@Body() body: unknown) {
    const dto = parse(z.object({ token: z.string().length(96), password }).strict(), body);
    await this.db.$transaction(async (tx) => {
      const r = await tx.passwordResetToken.findUnique({
        where: { tokenHash: tokenHash(dto.token) },
      });
      if (!r || r.usedAt || r.expiresAt < new Date())
        throw new UnauthorizedException('Link expirado ou já utilizado.');
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: r.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) throw new UnauthorizedException('Link já utilizado.');
      await tx.user.update({
        where: { id: r.userId },
        data: {
          passwordHash: await hash(dto.password, 12),
          passwordChangedAt:new Date(),
          mustChangePassword: false,
          failedAttempts: 0,
          lockedUntil: null,
        },
      });
      await tx.session.updateMany({ where: { userId: r.userId }, data: { revokedAt: new Date() } });
    });
    return ok(null, 'Senha redefinida. Faça login.');
  }
  @Post('profile') async profile(@Body() body: unknown, @Req() req: AuthRequest) {
    const dto = parse(
      z.object({ name: z.string().min(3).max(150), theme: z.enum(['light', 'dark']) }).strict(),
      body,
    );
    await this.db.user.update({ where: { id: req.actor.id }, data: dto });
    return ok(null, 'Perfil atualizado.');
  }
  @Get('sessions') async sessions(@Req() req: AuthRequest) {
    return ok(
      await this.db.session.findMany({
        where: { userId: req.actor.id, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, ip: true, userAgent: true, createdAt: true, expiresAt: true },
      }),
    );
  }
  @Post('sessions/revoke') async revoke(@Body() body: unknown, @Req() req: AuthRequest) {
    const { id } = parse(z.object({ id: z.uuid() }).strict(), body);
    await this.db.session.updateMany({
      where: { id, userId: req.actor.id },
      data: { revokedAt: new Date() },
    });
    return ok(null, 'Sessão revogada.');
  }
}
