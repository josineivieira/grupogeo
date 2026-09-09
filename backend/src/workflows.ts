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
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  AuthRequest,
  Database,
  assertPermission,
  audit,
  date,
  employeeScope,
  json,
  ok,
  pagination,
  parse,
  requireDateOrder,
} from './core';
import { EmployeeService } from './employees';
import { Permission } from './auth';
const admissionItems = [
  'Dados pessoais',
  'Documentos pessoais',
  'Exame admissional',
  'Contrato',
  'Dados bancários',
  'Benefícios',
  'Cadastro interno',
  'Equipamentos',
  'Treinamentos',
  'Assinaturas',
  'Integração',
];
const terminationItems = [
  'Devolução de equipamentos',
  'Cancelamento de acessos',
  'Cancelamento de benefícios',
  'Exame demissional',
  'Documentos assinados',
  'Entrevista de desligamento',
  'Comunicação aos setores',
  'Baixa cadastral',
];
@ApiTags('Admissões e desligamentos')
@ApiBearerAuth()
@Controller('workflows')
export class WorkflowController {
  constructor(
    private readonly db: Database,
    private readonly employees: EmployeeService,
  ) {}
  @Get(':kind') async list(
    @Param('kind') kind: string,
    @Query() query: unknown,
    @Req() req: AuthRequest,
  ) {
    if (!['admissions', 'terminations'].includes(kind))
      throw new BadRequestException('Fluxo inválido.');
    assertPermission(req.actor, `${kind}.view`);
    const q = parse(pagination, query);
    const where = {
      deletedAt: null,
      employee: employeeScope(req.actor),
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
    };
    const args = {
      where,
      include: { employee: { select: { id: true, name: true } }, checklist: true },
      take: q.limit,
      skip: (q.page - 1) * q.limit,
      orderBy: { createdAt: 'desc' as const },
    };
    const data =
      kind === 'admissions'
        ? await this.db.admissionProcess.findMany(args)
        : await this.db.termination.findMany(args);
    const total =
      kind === 'admissions'
        ? await this.db.admissionProcess.count({ where })
        : await this.db.termination.count({ where });
    return ok(data, 'Processos consultados.', {
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.ceil(total / q.limit),
    });
  }
  @Post('admissions') @Permission('admissions.create') async admission(
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const dto = parse(
      z.object({ employeeId: z.uuid(), notes: z.string().max(4000).optional() }).strict(),
      body,
    );
    await this.employees.find(dto.employeeId, req.actor);
    return this.db.$transaction(async (tx) => {
      const row = await tx.admissionProcess.create({
        data: {
          ...dto,
          createdBy: req.actor.id,
          checklist: { create: admissionItems.map((name) => ({ name })) },
        },
        include: { checklist: true },
      });
      await audit(tx, req, 'CRIACAO', 'admissions', row.id, undefined, row);
      return ok(row, 'Admissão iniciada.');
    });
  }
  @Post('terminations') @Permission('terminations.create') async termination(
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const dto = parse(
      z
        .object({
          employeeId: z.uuid(),
          communicationDate: date,
          effectiveDate: date,
          type: z.string().min(1),
          reason: z.string().min(5),
          initiative: z.string().min(1),
          noticeType: z.string().optional(),
          noticeEnd: date.optional(),
          interview: z.string().optional(),
        })
        .strict(),
      body,
    );
    const employee = await this.employees.find(dto.employeeId, req.actor);
    requireDateOrder(employee.admissionDate, dto.effectiveDate);
    requireDateOrder(dto.communicationDate, dto.effectiveDate);
    return this.db.$transaction(
      async (tx) => {
        if (
          await tx.termination.count({
            where: { employeeId: dto.employeeId, deletedAt: null, status: 'EM_ANDAMENTO' },
          })
        )
          throw new BadRequestException('Já existe desligamento em andamento.');
        const row = await tx.termination.create({
          data: {
            ...dto,
            createdBy: req.actor.id,
            checklist: { create: terminationItems.map((name) => ({ name })) },
          },
          include: { checklist: true },
        });
        await audit(tx, req, 'CRIACAO', 'terminations', row.id, undefined, row);
        return ok(row, 'Desligamento iniciado.');
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  @Patch(':kind/:id/checklist/:itemId') async checklist(
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    if (!['admissions', 'terminations'].includes(kind))
      throw new BadRequestException('Fluxo inválido.');
    assertPermission(req.actor, `${kind}.update`);
    const dto = parse(
      z
        .object({
          completed: z.boolean(),
          responsible: z.string().optional(),
          deadline: date.optional(),
          notes: z.string().optional(),
        })
        .strict(),
      body,
    );
    parse(z.uuid(), id);
    parse(z.uuid(), itemId);
    return this.db.$transaction(async (tx) => {
      const parent =
        kind === 'admissions'
          ? await tx.admissionProcess.findFirst({
              where: { id, deletedAt: null, employee: employeeScope(req.actor) },
              include: { checklist: true },
            })
          : await tx.termination.findFirst({
              where: { id, deletedAt: null, employee: employeeScope(req.actor) },
              include: { checklist: true },
            });
      if (!parent || !parent.checklist.some((i) => i.id === itemId))
        throw new BadRequestException('Item não encontrado no processo.');
      if (['ADMITIDA', 'CONCLUIDO'].includes(parent.status))
        throw new BadRequestException('Processo já concluído.');
      const { completed, ...rest } = dto;
      const data = { ...rest, completedAt: completed ? new Date() : null };
      const saved =
        kind === 'admissions'
          ? await tx.admissionChecklist.update({ where: { id: itemId }, data })
          : await tx.terminationChecklist.update({ where: { id: itemId }, data });
      await audit(tx, req, 'CHECKLIST', kind, itemId, undefined, saved);
      return ok(saved, 'Checklist atualizado.');
    });
  }
  @Post(':kind/:id/complete') async complete(
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    if (!['admissions', 'terminations'].includes(kind))
      throw new BadRequestException('Fluxo inválido.');
    assertPermission(req.actor, `${kind}.update`);
    return this.db.$transaction(
      async (tx) => {
        const parent =
          kind === 'admissions'
            ? await tx.admissionProcess.findFirst({
                where: {
                  id: parse(z.uuid(), id),
                  deletedAt: null,
                  employee: employeeScope(req.actor),
                },
                include: { checklist: true },
              })
            : await tx.termination.findFirst({
                where: {
                  id: parse(z.uuid(), id),
                  deletedAt: null,
                  employee: employeeScope(req.actor),
                },
                include: { checklist: true },
              });
        if (!parent || parent.checklist.some((i) => !i.completedAt))
          throw new BadRequestException('Conclua todos os itens do checklist.');
        if (['ADMITIDA', 'CONCLUIDO'].includes(parent.status))
          throw new BadRequestException('Processo já concluído.');
        const before = await this.employees.find(parent.employeeId, req.actor, tx);
        if (kind === 'admissions') {
          await tx.admissionProcess.update({ where: { id }, data: { status: 'ADMITIDA' } });
          await tx.employee.update({
            where: { id: parent.employeeId },
            data: { status: 'ACTIVE' },
          });
        } else {
          const termination = await tx.termination.findUniqueOrThrow({ where: { id } });
          if (termination.effectiveDate > new Date())
            throw new BadRequestException('Conclua o desligamento na data efetiva ou depois dela.');
          await tx.termination.update({ where: { id }, data: { status: 'CONCLUIDO' } });
          await tx.employee.update({
            where: { id: parent.employeeId },
            data: {
              status: 'TERMINATED',
              terminationDate: termination.effectiveDate,
              terminationReason: termination.reason,
              isActive: false,
            },
          });
          await tx.user.updateMany({
            where: { employeeId: parent.employeeId },
            data: { isActive: false },
          });
          await tx.session.updateMany({
            where: { user: { employeeId: parent.employeeId } },
            data: { revokedAt: new Date() },
          });
          await tx.employeeBenefit.updateMany({
            where: { employeeId: parent.employeeId, isActive: true },
            data: { isActive: false, endDate: termination.effectiveDate },
          });
        }
        const after = await tx.employee.findUniqueOrThrow({ where: { id: parent.employeeId } });
        await tx.employeeMovement.create({
          data: {
            employeeId: parent.employeeId,
            type: kind === 'admissions' ? 'ADMISSAO_CONCLUIDA' : 'DESLIGAMENTO',
            effectiveDate: after.terminationDate ?? after.admissionDate,
            before: json(before),
            after: json(after),
            reason: 'Checklist concluído',
            createdBy: req.actor.id,
          },
        });
        await audit(tx, req, 'CONCLUSAO', kind, id, before, after);
        return ok(null, 'Processo concluído e histórico preservado.');
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
@ApiTags('Afastamentos')
@ApiBearerAuth()
@Controller('leaves')
export class LeaveController {
  constructor(
    private readonly db: Database,
    private readonly employees: EmployeeService,
  ) {}
  @Get() @Permission('leaves.view') async list(@Query() query: unknown, @Req() req: AuthRequest) {
    const q = parse(pagination, query);
    const where = {
      deletedAt: null,
      employee: employeeScope(req.actor),
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
    };
    const [data, total] = await Promise.all([
      this.db.leaveOfAbsence.findMany({
        where,
        include: { employee: { select: { id: true, name: true } } },
        take: q.limit,
        skip: (q.page - 1) * q.limit,
        orderBy: { startDate: 'desc' },
      }),
      this.db.leaveOfAbsence.count({ where }),
    ]);
    return ok(
      data.map((r) =>
        req.actor.permissions.includes('health.view_sensitive')
          ? r
          : {
              id: r.id,
              employee: r.employee,
              startDate: r.startDate,
              expectedReturn: r.expectedReturn,
              actualReturn: r.actualReturn,
              status: r.status,
            },
      ),
      'Afastamentos consultados.',
      { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
    );
  }
  @Post() @Permission('leaves.create') async create(
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    assertPermission(req.actor, 'health.view_sensitive');
    const dto = parse(
      z
        .object({
          employeeId: z.uuid(),
          type: z.string().min(1),
          startDate: date,
          expectedReturn: date,
          reason: z.string().min(3),
          notes: z.string().optional(),
        })
        .strict(),
      body,
    );
    requireDateOrder(dto.startDate, dto.expectedReturn);
    return this.db.$transaction(
      async (tx) => {
        const e = await this.employees.find(dto.employeeId, req.actor, tx);
        if (e.status === 'TERMINATED') throw new BadRequestException('Funcionário desligado.');
        if (
          await tx.leaveOfAbsence.count({
            where: { employeeId: e.id, actualReturn: null, deletedAt: null },
          })
        )
          throw new BadRequestException('Já existe um afastamento sem retorno registrado.');
        const row = await tx.leaveOfAbsence.create({
          data: {
            ...dto,
            status: dto.startDate <= new Date() ? 'EM_ANDAMENTO' : 'PROGRAMADO',
            createdBy: req.actor.id,
          },
        });
        if (dto.startDate <= new Date())
          await tx.employee.update({ where: { id: e.id }, data: { status: 'ON_LEAVE' } });
        await tx.employeeMovement.create({
          data: {
            employeeId: e.id,
            type: 'AFASTAMENTO',
            effectiveDate: dto.startDate,
            before: { status: e.status },
            after: { status: 'ON_LEAVE' },
            reason: 'Afastamento registrado',
            createdBy: req.actor.id,
          },
        });
        await audit(tx, req, 'CRIACAO', 'leaves', row.id, undefined, row);
        return ok(row, 'Afastamento registrado.');
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  @Post(':id/return') @Permission('leaves.update') async return(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const dto = parse(z.object({ actualReturn: date }).strict(), body);
    return this.db.$transaction(async (tx) => {
      const row = await tx.leaveOfAbsence.findFirst({
        where: {
          id: parse(z.uuid(), id),
          employee: employeeScope(req.actor),
          deletedAt: null,
          actualReturn: null,
        },
      });
      if (!row) throw new BadRequestException('Afastamento não encontrado ou já encerrado.');
      requireDateOrder(row.startDate, dto.actualReturn);
      if (dto.actualReturn > new Date())
        throw new BadRequestException('A data real de retorno não pode ser futura.');
      await tx.leaveOfAbsence.update({
        where: { id },
        data: { actualReturn: dto.actualReturn, status: 'CONCLUIDO' },
      });
      await tx.employee.updateMany({
        where: { id: row.employeeId, status: 'ON_LEAVE' },
        data: { status: 'ACTIVE' },
      });
      await tx.employeeMovement.create({
        data: {
          employeeId: row.employeeId,
          type: 'RETORNO',
          effectiveDate: dto.actualReturn,
          before: { status: 'ON_LEAVE' },
          after: { status: 'ACTIVE' },
          reason: 'Retorno de afastamento',
          createdBy: req.actor.id,
        },
      });
      await audit(tx, req, 'RETORNO', 'leaves', id, row, dto);
      return ok(null, 'Retorno registrado.');
    });
  }
}
