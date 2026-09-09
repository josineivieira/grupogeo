import { afterEach, describe, expect, it, vi } from 'vitest';
import { sign } from 'jsonwebtoken';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth';
import type { Database } from './core';

afterEach(() => vi.unstubAllEnvs());

describe('Authenticated request session loading', () => {
  function setup(mustChangePassword = false, revoked = false) {
    const secret = 'test-secret-only-at-least-32-characters';
    vi.stubEnv('JWT_SECRET', secret);
    const user = {
      id: 'user', name: 'Test', email: 'test@example.com', isActive: true,
      deletedAt: null, passwordChangedAt: new Date(), mustChangePassword,
      roles: [], companies: [], branches: [], allCompanies: false, theme: 'light',
    };
    const session = { id: 'session', user, lastSeenAt: new Date(), environmentId: 'hr', environment: { code: 'HR' } };
    const db = {
      session: { findFirst: vi.fn().mockResolvedValue(revoked ? null : session), update: vi.fn().mockResolvedValue(session), findFirstOrThrow: vi.fn() },
      userEnvironmentRole: { findMany: vi.fn().mockResolvedValue([]) },
      systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const req = { headers: { authorization: `Bearer ${sign({ sid: 'session' }, secret, { subject: 'user', issuer: 'geo-rh', audience: 'geo-web' })}` }, path: '/api/auth/me', actor: undefined as any };
    const ctx = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(undefined) };
    return { db, req, ctx, user, session, reflector, guard: new AuthGuard(db as unknown as Database, reflector as unknown as Reflector) };
  }

  it('reuses the validated session instead of fetching user permissions twice', async () => {
    const { db, req, ctx, guard } = setup();
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(db.session.findFirst).toHaveBeenCalledTimes(1);
    expect(db.session.findFirstOrThrow).not.toHaveBeenCalled();
    expect(req.actor.id).toBe('user');
    expect(req.actor.environmentCode).toBe('HR');
  });

  it('still rejects unavailable or revoked sessions', async () => {
    const { db, ctx, guard } = setup(false, true);
    await expect(guard.canActivate(ctx)).rejects.toThrow();
    expect(db.userEnvironmentRole.findMany).not.toHaveBeenCalled();
  });

  it('still blocks modules until the initial password is changed', async () => {
    const { req, ctx, guard } = setup(true);
    req.path = '/api/catalogs';
    await expect(guard.canActivate(ctx)).rejects.toThrow('Altere a senha temporária');
  });

  it('rejects a disabled user immediately', async () => {
    const { user, ctx, guard } = setup();
    user.isActive = false;
    await expect(guard.canActivate(ctx)).rejects.toThrow('Sua sessão foi encerrada');
  });

  it('rejects expired inactivity and revokes the session', async () => {
    const { session, db, ctx, guard } = setup();
    session.lastSeenAt = new Date(0);
    await expect(guard.canActivate(ctx)).rejects.toThrow('inatividade');
    expect(db.session.update).toHaveBeenCalledWith(expect.objectContaining({ data: { revokedAt: expect.any(Date) } }));
  });

  it('rejects missing permissions and reloads them for each request', async () => {
    const { reflector, db, ctx, guard } = setup();
    reflector.getAllAndOverride.mockImplementation((key) => key === 'permission' ? 'employees.view' : undefined);
    db.userEnvironmentRole.findMany.mockResolvedValueOnce([
      { role: { name: 'RH', permissions: [{ permission: { code: 'employees.view' } }] } },
    ]).mockResolvedValueOnce([]);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Seu perfil não permite');
    expect(db.session.findFirst).toHaveBeenCalledTimes(2);
    expect(db.userEnvironmentRole.findMany).toHaveBeenCalledTimes(2);
  });
});
