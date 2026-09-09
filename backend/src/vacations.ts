import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Permission } from './auth';
import {
  AuthRequest,
  Database,
  assertPermission,
  audit,
  date,
  employeeScope,
  ok,
  pagination,
  parse,
} from './core';
import { EmployeeService } from './employees';
export const day = 86400000;
export function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * day);
}
export function anniversary(d: Date, years: number) {
  const result = new Date(Date.UTC(d.getUTCFullYear() + years, d.getUTCMonth(), d.getUTCDate()));
  if (result.getUTCMonth() !== d.getUTCMonth()) result.setUTCDate(0);
  return result;
}
export const vacationRules = z.object({
  defaultDays: z.number().int().min(1).max(60),
  maxInstallments: z.number().int().min(1).max(12),
  minDays: z.number().int().min(1).max(30),
  minLongPeriod: z.number().int().min(1).max(30),
  maxSoldDays: z.number().int().min(0).max(30),
  managerApproval: z.boolean(),
});
export type VacationRules = z.infer<typeof vacationRules>;
export interface Reservation {
  startDate: Date;
  endDate: Date;
  days: number;
  soldDays: number;
  status: string;
}
export function validateVacation(
  existing: Reservation[],
  input: Reservation,
  available: number,
  rules: VacationRules,
) {
  const active = existing.filter((p) => !['CANCELLED', 'REJECTED'].includes(p.status));
  if (input.endDate < input.startDate)
    throw new BadRequestException('A data final é anterior à inicial.');
  if (input.days < rules.minDays)
    throw new BadRequestException(`A parcela deve ter pelo menos ${rules.minDays} dias.`);
  if (active.length >= rules.maxInstallments)
    throw new BadRequestException('Limite de parcelamentos atingido.');
  if (active.some((p) => p.startDate <= input.endDate && p.endDate >= input.startDate))
    throw new BadRequestException('Há sobreposição com férias já solicitadas ou programadas.');
  const sold = active.reduce((s, p) => s + p.soldDays, 0) + input.soldDays;
  if (sold > rules.maxSoldDays)
    throw new BadRequestException('Venda de dias acima do limite configurado.');
  const consumed =
    active.reduce((s, p) => s + p.days + p.soldDays, 0) + input.days + input.soldDays;
  if (consumed > available) throw new BadRequestException('Saldo de férias insuficiente.');
  const remaining = available - consumed;
  const hasLong = [...active, input].some((p) => p.days >= rules.minLongPeriod);
  if (!hasLong && (active.length + 1 >= rules.maxInstallments || remaining < rules.minLongPeriod))
    throw new BadRequestException(
      `Reserve uma parcela de pelo menos ${rules.minLongPeriod} dias, conforme a configuração.`,
    );
}
@Injectable()
export class VacationService {
  constructor(
    private readonly db: Database,
    private readonly employees: EmployeeService,
  ) {}
  async rules(tx: Prisma.TransactionClient = this.db) {
    const row = await tx.systemSetting.findUniqueOrThrow({ where: { key: 'vacations' } });
    return vacationRules.parse(row.value);
  }
  async generate(id: string, req: AuthRequest) {
    const employee = await this.employees.find(id, req.actor);
    const rules = await this.rules();
    const until = employee.terminationDate ?? new Date();
    let count = 0;
    for (let n = 0; anniversary(employee.admissionDate, n) <= until; n++) {
      const startDate = anniversary(employee.admissionDate, n),
        endDate = addDays(anniversary(employee.admissionDate, n + 1), -1),
        deadline = addDays(anniversary(employee.admissionDate, n + 2), -1);
      await this.db.vacationAccrualPeriod.upsert({
        where: { employeeId_startDate: { employeeId: id, startDate } },
        create: { employeeId: id, startDate, endDate, deadline, acquiredDays: rules.defaultDays },
        update: {},
      });
      count++;
      if (n > 100) break;
    }
    return count;
  }
  async create(body: unknown, req: AuthRequest) {
    const dto = parse(
      z
        .object({
          employeeId: z.uuid(),
          accrualId: z.uuid(),
          startDate: date,
          days: z.coerce.number().int().min(1).max(60),
          soldDays: z.coerce.number().int().min(0).max(30).default(0),
          advance13: z.boolean().default(false),
          notes: z.string().max(4000).optional(),
          acknowledgeOverdue: z.boolean().default(false),
        })
        .strict(),
      body,
    );
    return this.db.$transaction(
      async (tx) => {
        const employee = await this.employees.find(dto.employeeId, req.actor, tx);
        if (employee.status === 'TERMINATED' || !employee.isActive)
          throw new BadRequestException(
            'Não é possível programar férias para funcionário desligado ou inativo.',
          );
        const accrual = await tx.vacationAccrualPeriod.findFirst({
          where: { id: dto.accrualId, employeeId: dto.employeeId },
          include: { vacations: true },
        });
        if (!accrual) throw new NotFoundException('Período aquisitivo não encontrado.');
        if (dto.startDate <= accrual.endDate)
          throw new BadRequestException('As férias devem iniciar após a aquisição do período.');
        const endDate = addDays(dto.startDate, dto.days - 1);
        if (endDate > accrual.deadline && !dto.acknowledgeOverdue)
          throw new BadRequestException(
            'A programação ultrapassa o limite concessivo. Confirme a ciência do vencimento.',
          );
        const overlap = await tx.vacationPeriod.count({
          where: {
            employeeId: dto.employeeId,
            status: { notIn: ['CANCELLED', 'REJECTED'] },
            startDate: { lte: endDate },
            endDate: { gte: dto.startDate },
          },
        });
        if (overlap)
          throw new BadRequestException('Há sobreposição com outra programação do funcionário.');
        const rules = await this.rules(tx);
        validateVacation(
          accrual.vacations,
          { ...dto, endDate, status: 'REQUESTED' },
          accrual.acquiredDays - accrual.reducedDays,
          rules,
        );
        const { acknowledgeOverdue, ...data } = dto;
        const result = await tx.vacationPeriod.create({
          data: { ...data, endDate, returnDate: addDays(endDate, 1), createdBy: req.actor.id },
        });
        await audit(
          tx,
          req,
          'SOLICITACAO',
          'vacations',
          result.id,
          undefined,
          result,
          acknowledgeOverdue ? 'Ciência de prazo concessivo ultrapassado' : undefined,
        );
        return ok(result, 'Solicitação de férias registrada.');
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async transition(id: string, action: string, body: unknown, req: AuthRequest) {
    const dto = parse(z.object({ comment: z.string().min(3).max(2000) }).strict(), body);
    return this.db.$transaction(
      async (tx) => {
        const v = await tx.vacationPeriod.findFirst({
          where: { id: parse(z.uuid(), id), employee: employeeScope(req.actor) },
        });
        if (!v) throw new NotFoundException('Programação não encontrada.');
        const rules = await this.rules(tx);
        let status: typeof v.status;
        if (action === 'approve') {
          if (v.status === 'REQUESTED' && rules.managerApproval) {
            assertPermission(req.actor, 'vacations.approve_manager');
            status = 'MANAGER_APPROVED';
          } else {
            assertPermission(req.actor, 'vacations.approve');
            if (v.status !== (rules.managerApproval ? 'MANAGER_APPROVED' : 'REQUESTED'))
              throw new BadRequestException(
                'A programação não está na etapa de aprovação esperada.',
              );
            status = 'APPROVED';
          }
        } else if (action === 'reject') {
          assertPermission(req.actor, 'vacations.approve');
          if (!['REQUESTED', 'MANAGER_APPROVED'].includes(v.status))
            throw new BadRequestException('Somente solicitações pendentes podem ser rejeitadas.');
          status = 'REJECTED';
        } else if (action === 'cancel') {
          assertPermission(req.actor, 'vacations.cancel');
          if (
            ['COMPLETED', 'CANCELLED', 'REJECTED'].includes(v.status) ||
            (v.startDate <= new Date() && v.status === 'APPROVED')
          )
            throw new BadRequestException(
              'Esta programação não pode ser cancelada pelo fluxo comum.',
            );
          status = 'CANCELLED';
        } else throw new NotFoundException('Ação indisponível.');
        const after = await tx.vacationPeriod.update({
          where: { id },
          data: {
            status,
            approvals: {
              create: { approverId: req.actor.id, action: status, comment: dto.comment },
            },
          },
        });
        await audit(tx, req, status, 'vacations', id, v, after, dto.comment);
        return ok(after, 'Situação de férias atualizada.');
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
@ApiTags('Férias')
@ApiBearerAuth()
@Controller('vacations')
export class VacationController {
  constructor(
    private readonly db: Database,
    private readonly service: VacationService,
    private readonly employees: EmployeeService,
  ) {}
  @Get() @Permission('vacations.view') async list(
    @Query() query: unknown,
    @Req() req: AuthRequest,
  ) {
    const q = parse(pagination, query);
    const where: Prisma.VacationPeriodWhereInput = {
      employee: {
        AND: [
          employeeScope(req.actor),
          {
            ...(q.companyId ? { companyId: q.companyId } : {}),
            ...(q.branchId ? { branchId: q.branchId } : {}),
            ...(q.departmentId ? { departmentId: q.departmentId } : {}),
          },
        ],
      },
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      ...(q.from ? { endDate: { gte: new Date(q.from) } } : {}),
      ...(q.to ? { startDate: { lte: new Date(q.to) } } : {}),
      ...(q.status
        ? {
            status: z
              .enum([
                'REQUESTED',
                'MANAGER_APPROVED',
                'APPROVED',
                'REJECTED',
                'CANCELLED',
                'COMPLETED',
              ])
              .parse(q.status),
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.vacationPeriod.findMany({
        where,
        include: {
          employee: { select: { id: true, name: true, registration: true } },
          approvals: true,
        },
        orderBy: { startDate: 'desc' },
        take: q.limit,
        skip: (q.page - 1) * q.limit,
      }),
      this.db.vacationPeriod.count({ where }),
    ]);
    return ok(rows, 'Programações consultadas.', {
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.ceil(total / q.limit),
    });
  }
  @Get('accruals/:employeeId') @Permission('vacations.view') async accruals(
    @Param('employeeId') id: string,
    @Req() req: AuthRequest,
  ) {
    await this.employees.find(id, req.actor);
    const rows = await this.db.vacationAccrualPeriod.findMany({
      where: { employeeId: id },
      include: { vacations: true },
      orderBy: { startDate: 'desc' },
    });
    return ok(
      rows.map((r) => {
        const active = r.vacations.filter((v) => !['REJECTED', 'CANCELLED'].includes(v.status));
        const used = active.filter((v) => v.status === 'COMPLETED').reduce((s, v) => s + v.days, 0),
          reserved = active.filter((v) => v.status !== 'COMPLETED').reduce((s, v) => s + v.days, 0),
          sold = active.reduce((s, v) => s + v.soldDays, 0);
        return {
          ...r,
          usedDays: used,
          reservedDays: reserved,
          soldDays: sold,
          balance: r.acquiredDays - r.reducedDays - used - reserved - sold,
        };
      }),
    );
  }
  @Post('accruals/:employeeId/generate') @Permission('vacations.create') async generate(
    @Param('employeeId') id: string,
    @Req() req: AuthRequest,
  ) {
    const count = await this.service.generate(id, req);
    await audit(this.db, req, 'GERACAO_PERIODOS', 'vacations', id, undefined, { count });
    return ok({ count }, 'Períodos aquisitivos atualizados.');
  }
  @Post() @Permission('vacations.create') create(@Body() body: unknown, @Req() req: AuthRequest) {
    return this.service.create(body, req);
  }
  @Post(':id/:action') action(
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.transition(id, action, body, req);
  }
}
