import { describe, it, expect } from 'vitest';
import { display, maskCpf, statusLabel } from './api';
describe('Apresentação brasileira', () => {
  it('formata CPF progressivamente', () => expect(maskCpf('52998224725')).toBe('529.982.247-25'));
  it('datas civis não mudam por fuso horário', () =>
    expect(display('2026-01-01T00:00:00.000Z')).toBe('01/01/2026'));
  it('campos vazios são explícitos', () => expect(display(null)).toBe('—'));
  it('traduz estados de aprovação', () =>
    expect(statusLabel.MANAGER_APPROVED).toBe('Aprovada pelo gestor'));
});
