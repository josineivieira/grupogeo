import { describe, expect, it, vi } from 'vitest';
import { databaseUrlWithPoolLimit } from './database-config';
import { Database } from './core';

describe('Database connection budget', () => {
  it('limits the default pool while preserving credentials, TLS and schema', () => {
    const original = new URL('postgresql://postgres.test:p%40ss%23word@localhost:5432/postgres?sslmode=require&schema=public');
    const configured = new URL(databaseUrlWithPoolLimit(original.toString()));
    expect(configured.searchParams.get('connection_limit')).toBe('3');
    expect(configured.username).toBe(original.username);
    expect(configured.password).toBe(original.password);
    expect(configured.host).toBe(original.host);
    expect(configured.searchParams.get('sslmode')).toBe('require');
    expect(configured.searchParams.get('schema')).toBe('public');
  });
  it('preserves an explicitly configured pool', () => {
    expect(new URL(databaseUrlWithPoolLimit('postgresql://user:pass@localhost/db?connection_limit=2')).searchParams.get('connection_limit')).toBe('2');
  });
  it('does not disclose invalid connection strings in errors', () => {
    expect(() => databaseUrlWithPoolLimit('private-password')).toThrow('DATABASE_URL inválida');
  });
  it('disconnects the client when the application shuts down', async () => {
    const client = { $disconnect: vi.fn().mockResolvedValue(undefined) };
    await Database.prototype.onApplicationShutdown.call(client as unknown as Database);
    expect(client.$disconnect).toHaveBeenCalledOnce();
  });
});
