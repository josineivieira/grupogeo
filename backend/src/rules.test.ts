import { describe, it, expect } from 'vitest';
import { validCpf, validCnpj, validPis, employeeScope, Actor, redact } from './core';
import { anniversary, validateVacation, VacationRules } from './vacations';
import { protectEmployee } from './employees';
import { safeCell, turnover } from './reports';
const rules: VacationRules = {
  defaultDays: 30,
  maxInstallments: 3,
  minDays: 5,
  minLongPeriod: 14,
  maxSoldDays: 10,
  managerApproval: true,
};
const reservation = (
  start: string,
  end: string,
  days: number,
  soldDays = 0,
  status = 'REQUESTED',
) => ({ startDate: new Date(start), endDate: new Date(end), days, soldDays, status });
describe('Férias', () => {
  it('aceita parcelamento de 14, 8 e 8 dias', () => {
    const a = reservation('2026-01-01', '2026-01-14', 14),
      b = reservation('2026-03-01', '2026-03-08', 8);
    expect(() =>
      validateVacation([a, b], reservation('2026-05-01', '2026-05-08', 8), 30, rules),
    ).not.toThrow();
  });
  it('rejeita saldo negativo', () =>
    expect(() =>
      validateVacation(
        [reservation('2026-01-01', '2026-01-20', 20)],
        reservation('2026-03-01', '2026-03-15', 15),
        30,
        rules,
      ),
    ).toThrow('Saldo'));
  it('reserva saldo ainda na solicitação', () =>
    expect(() =>
      validateVacation(
        [reservation('2026-01-01', '2026-01-30', 30)],
        reservation('2026-03-01', '2026-03-05', 5),
        30,
        rules,
      ),
    ).toThrow());
  it('libera saldo de canceladas', () =>
    expect(() =>
      validateVacation(
        [reservation('2026-01-01', '2026-01-30', 30, 0, 'CANCELLED')],
        reservation('2026-03-01', '2026-03-30', 30),
        30,
        rules,
      ),
    ).not.toThrow());
  it('rejeita sobreposição inclusive no último dia', () =>
    expect(() =>
      validateVacation(
        [reservation('2026-01-01', '2026-01-14', 14)],
        reservation('2026-01-14', '2026-01-20', 7),
        30,
        rules,
      ),
    ).toThrow('sobreposição'));
  it('rejeita venda acima do limite acumulado', () =>
    expect(() =>
      validateVacation(
        [reservation('2026-01-01', '2026-01-14', 14, 8)],
        reservation('2026-03-01', '2026-03-05', 5, 3),
        30,
        rules,
      ),
    ).toThrow('Venda'));
  it('garante uma parcela longa', () =>
    expect(() =>
      validateVacation(
        [reservation('2026-01-01', '2026-01-10', 10)],
        reservation('2026-03-01', '2026-03-10', 10),
        30,
        rules,
      ),
    ).toThrow('parcela'));
  it('ajusta aniversário de 29 de fevereiro', () =>
    expect(anniversary(new Date('2024-02-29'), 1).toISOString().slice(0, 10)).toBe('2025-02-28'));
});
describe('Dados brasileiros', () => {
  it('valida CPF com dígitos verificadores', () => {
    expect(validCpf('529.982.247-25')).toBe(true);
    expect(validCpf('111.111.111-11')).toBe(false);
    expect(validCpf('529.982.247-24')).toBe(false);
  });
  it('valida CNPJ', () => {
    expect(validCnpj('11.222.333/0001-81')).toBe(true);
    expect(validCnpj('00.000.000/0000-00')).toBe(false);
  });
  it('rejeita PIS repetido', () => expect(validPis('11111111111')).toBe(false));
});
describe('Menor privilégio', () => {
  const actor = {
    permissions: ['employees.view'],
    roles: ['Gestor'],
    companyIds: ['company'],
    branchIds: [],
    allCompanies: false,
    employeeId: 'manager',
  } as Actor;
  it('remove salário e documentos pessoais', () =>
    expect(
      protectEmployee({ name: 'Pessoa', salary: '5000', cpf: '52998224725', pis: '123' }, actor),
    ).toEqual({ name: 'Pessoa' }));
  it('combina escopo organizacional e equipe', () => {
    expect(JSON.stringify(employeeScope(actor))).toContain('managerId');
    expect(JSON.stringify(employeeScope(actor))).toContain('company');
  });
  it('usuário sem vínculo não recebe escopo ilimitado', () =>
    expect(JSON.stringify(employeeScope({ ...actor, employeeId: null }))).toContain(
      '00000000-0000-0000-0000-000000000000',
    ));
  it('auditoria não replica credenciais e dados médicos', () =>
    expect(redact({ passwordHash: 'abc', result: 'diagnóstico', name: 'Pessoa' })).toEqual({
      passwordHash: '[RESTRITO]',
      result: '[RESTRITO]',
      name: 'Pessoa',
    }));
});
describe('Relatórios', () => {
  it('calcula turnover com quadro médio', () =>
    expect(turnover(10, 6, 100, 104).rate).toBeCloseTo(7.843137));
  it('não divide por zero', () => expect(turnover(0, 0, 0, 0).rate).toBe(0));
  it('neutraliza fórmulas de planilhas', () =>
    expect(safeCell('=HYPERLINK("bad")')).toBe('\'=HYPERLINK("bad")'));
});
