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
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    return { db, req, ctx, guard: new AuthGuard(db as unknown as Database, reflector) };
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
});
