import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  OnModuleInit,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import { z } from 'zod';

@Injectable()
export class Database extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
export interface Actor {
  id: string;
  name: string;
  email: string;
  permissions: string[];
  roles: string[];
  companyIds: string[];
  branchIds: string[];
  allCompanies: boolean;
  employeeId: string | null;
  mustChangePassword: boolean;
  theme: string;
  sessionId: string;
  environmentId: string | null;
  environmentCode: string | null;
  isGlobalSuperAdmin: boolean;
  photoId?: string|null;
}
export interface AuthRequest extends Request {
  actor: Actor;
}
export const ok = <T>(
  data: T,
  message = 'Operação concluída.',
  meta?: { page: number; limit: number; total: number; totalPages: number },
) => ({ success: true, message, data, ...(meta ? { meta } : {}) });
export const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  return schema.parse(data);
}
export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
  companyId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  sectorId: z.uuid().optional(),
  jobPositionId: z.uuid().optional(),
  managerId: z.uuid().optional(),
  employeeId: z.uuid().optional(),
  status: z.string().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  sort: z.string().optional(),
  direction: z.enum(['asc', 'desc']).default('asc'),
});
export const date = z.iso.date().transform((v) => new Date(`${v}T00:00:00.000Z`));
export const money = z
  .union([z.string(), z.number()])
  .transform(String)
  .refine(
    (v) => /^\d{1,12}(\.\d{1,2})?$/.test(v) && Number(v) > 0,
    'Informe um valor positivo com até duas casas decimais.',
  );
export const digits = (value: string) => value.replace(/\D/g, '');
export function validCpf(value: string) {
  const s = digits(value);
  if (!/^\d{11}$/.test(s) || /^(\d)\1+$/.test(s)) return false;
  for (let n = 9; n < 11; n++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Number(s[i]) * (n + 1 - i);
    const d = (sum * 10) % 11;
    if ((d === 10 ? 0 : d) !== Number(s[n])) return false;
  }
  return true;
}
export function validCnpj(value: string) {
  const s = digits(value);
  if (!/^\d{14}$/.test(s) || /^(\d)\1+$/.test(s)) return false;
  for (let n = 12; n < 14; n++) {
    let sum = 0,
      weight = n - 7;
    for (let i = 0; i < n; i++) {
      sum += Number(s[i]) * weight;
      weight = weight === 2 ? 9 : weight - 1;
    }
    const r = sum % 11;
    if ((r < 2 ? 0 : 11 - r) !== Number(s[n])) return false;
  }
  return true;
}
export function validPis(value: string) {
  const s = digits(value);
  if (!/^\d{11}$/.test(s) || /^(\d)\1+$/.test(s)) return false;
  const sum = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2].reduce((a, w, i) => a + w * Number(s[i]), 0);
  const d = 11 - (sum % 11);
  return Number(s[10]) === (d >= 10 ? 0 : d);
}
export const cpf = z.string().transform(digits).refine(validCpf, 'CPF inválido.');
export const cnpj = z.string().transform(digits).refine(validCnpj, 'CNPJ inválido.');
export const phone = z
  .string()
  .transform(digits)
  .refine((v) => /^\d{10,11}$/.test(v), 'Telefone deve conter DDD e 10 ou 11 dígitos.');
export function employeeScope(a: Actor): Prisma.EmployeeWhereInput {
  const org: Prisma.EmployeeWhereInput = a.allCompanies
    ? {}
    : { OR: [{ companyId: { in: a.companyIds } }, { branchId: { in: a.branchIds } }] };
  const team: Prisma.EmployeeWhereInput =
    a.roles.includes('Gestor') && !a.permissions.includes('employees.view_all')
      ? { managerId: a.employeeId ?? '00000000-0000-0000-0000-000000000000' }
      : a.roles.includes('Funcionário') && !a.permissions.includes('employees.view_all')
        ? { id: a.employeeId ?? '00000000-0000-0000-0000-000000000000' }
        : {};
  return { AND: [{ deletedAt: null }, org, team] };
}
export function assertPermission(a: Actor, code: string) {
  if (!a.permissions.includes(code))
    throw new HttpException('Seu perfil não permite esta operação.', 403);
}
export function assertCompany(a: Actor, companyId: string, branchId?: string) {
  if (
    !a.allCompanies &&
    !a.companyIds.includes(companyId) &&
    !(branchId && a.branchIds.includes(branchId))
  )
    throw new HttpException('Empresa ou filial fora do seu escopo de acesso.', 403);
}
const secretKeys =
  /password|token|cpf|pis|account|agency|pix|cid|result|restrictions|salary|bank|birthDate|motherName|fatherName/i;
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object' && !(value instanceof Date))
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, secretKeys.test(k) ? '[RESTRITO]' : redact(v)]),
    );
  return value;
}
export async function audit(
  db: Prisma.TransactionClient,
  req: AuthRequest,
  action: string,
  module: string,
  recordId?: string,
  before?: unknown,
  after?: unknown,
  reason?: string,
) {
  await db.auditLog.create({
    data: {
      userId: req.actor?.id,
      environmentId: req.actor?.environmentId ?? undefined,
      action,
      module,
      recordId,
      before: before === undefined ? undefined : json(redact(before)),
      after: after === undefined ? undefined : json(redact(after)),
      ip: req.ip ?? '',
      userAgent: req.get('user-agent') ?? '',
      reason,
    },
  });
}
@Catch()
export class ApiErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500,
      message =
        'Não foi possível concluir a operação. Consulte o administrador com o horário desta tentativa.',
      errors: { field: string; message: string }[] = [];
    if (error instanceof z.ZodError) {
      status = 400;
      message = 'Revise os campos informados.';
      errors = error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      message = error.message;
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        status = 409;
        message = 'Já existe um registro com estes dados únicos.';
        errors = [{ field: String(error.meta?.target ?? ''), message }];
      } else if (error.code === 'P2025') {
        status = 404;
        message = 'Registro não encontrado ou indisponível.';
      } else if (error.code === 'P2003') {
        status = 400;
        message = 'O registro relacionado não existe ou está em uso.';
      } else if (error.code === 'P2034') {
        status = 409;
        message = 'Os dados foram alterados simultaneamente. Atualize e tente novamente.';
      }
    }
    if (status === 500)
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'request_failed',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    res.status(status).json({ success: false, message, errors, statusCode: status });
  }
}
export function requireDateOrder(start: Date, end: Date) {
  if (end < start) throw new BadRequestException('A data final não pode ser anterior à inicial.');
}
