import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Workbook } from 'exceljs';
import PDFDocument from 'pdfkit';
import type { Response } from 'express';
import { z } from 'zod';
import { Permission } from './auth';
import {
  AuthRequest,
  Database,
  assertPermission,
  audit,
  employeeScope,
  ok,
  pagination,
  parse,
} from './core';
import { buildEmployeeWhere, protectEmployee } from './employees';
export function turnover(
  admissions: number,
  terminations: number,
  opening: number,
  closing: number,
) {
  const average = (opening + closing) / 2;
  return {
    rate: average ? ((admissions + terminations) / 2 / average) * 100 : 0,
    terminationRate: average ? (terminations / average) * 100 : 0,
    average,
  };
}
export function safeCell(value: unknown) {
  const text = value == null ? '' : String(value);
  return /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;
}
@ApiTags('Indicadores e relatórios')
@ApiBearerAuth()
@Controller()
export class ReportsController {
  constructor(private readonly db: Database) {}
  @Get('dashboard/summary') @Permission('employees.view') async dashboard(
    @Query() query: unknown,
    @Req() req: AuthRequest,
  ) {
    const q = parse(pagination, query),
      now = new Date(),
      from = q.from
        ? new Date(q.from)
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      to = q.to ? new Date(q.to) : now;
    const base = buildEmployeeWhere(req.actor, {
      ...q,
      from: undefined,
      to: undefined,
      status: undefined,
    });
    const admissions = { AND: [base, { admissionDate: { gte: from, lte: to } }] },
      terminations = { AND: [base, { terminationDate: { gte: from, lte: to } }] };
    const [
      active,
      admitted,
      terminated,
      opening,
      closing,
      onVacation,
      away,
      overdueDocs,
      overdueHealth,
      alerts,
      branches,
      departments,
    ] = await Promise.all([
      this.db.employee.count({
        where: { AND: [base, { isActive: true, status: { not: 'TERMINATED' } }] },
      }),
      this.db.employee.count({ where: admissions }),
      this.db.employee.count({ where: terminations }),
      this.db.employee.count({
        where: {
          AND: [
            base,
            {
              admissionDate: { lt: from },
              OR: [{ terminationDate: null }, { terminationDate: { gte: from } }],
            },
          ],
        },
      }),
      this.db.employee.count({
        where: {
          AND: [
            base,
            {
              admissionDate: { lte: to },
              OR: [{ terminationDate: null }, { terminationDate: { gt: to } }],
            },
          ],
        },
      }),
      this.db.employee.count({ where: { AND: [base, { status: 'ON_VACATION' }] } }),
      this.db.employee.count({ where: { AND: [base, { status: 'ON_LEAVE' }] } }),
      req.actor.permissions.includes('employees.view_documents')
        ? this.db.employeeDocument.count({
            where: { employee: base, deletedAt: null, expiresAt: { lt: now } },
          })
        : Promise.resolve(null),
      req.actor.permissions.includes('health.view_sensitive')
        ? this.db.occupationalHealthExam.count({
            where: { employee: base, deletedAt: null, expiresAt: { lt: now } },
          })
        : Promise.resolve(null),
      this.db.alert.count({ where: { employee: base, status: 'ABERTO' } }),
      this.db.employee.groupBy({
        by: ['branchId'],
        where: { AND: [base, { isActive: true }] },
        _count: true,
      }),
      this.db.employee.groupBy({
        by: ['departmentId'],
        where: { AND: [base, { isActive: true }] },
        _count: true,
      }),
    ]);
    const branchNames = await this.db.branch.findMany({
        where: { id: { in: branches.map((b) => b.branchId) } },
        select: { id: true, name: true },
      }),
      departmentNames = await this.db.department.findMany({
        where: { id: { in: departments.map((d) => d.departmentId) } },
        select: { id: true, name: true },
      });
    return ok({
      active,
      admitted,
      terminated,
      balance: admitted - terminated,
      turnover: turnover(admitted, terminated, opening, closing),
      onVacation,
      away,
      overdueDocs,
      overdueHealth,
      alerts,
      branches: branches.map((b) => ({
        name: branchNames.find((n) => n.id === b.branchId)?.name ?? '',
        count: b._count,
      })),
      departments: departments.map((d) => ({
        name: departmentNames.find((n) => n.id === d.departmentId)?.name ?? '',
        count: d._count,
      })),
      period: { from, to },
    });
  }
  @Get('reports/:kind') @Permission('reports.view') async report(
    @Param('kind') kind: string,
    @Query() query: unknown,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const q = parse(
      pagination.extend({
        format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json'),
        columns: z.string().optional(),
      }),
      query,
    );
    const base = buildEmployeeWhere(req.actor, q);
    let rows: Record<string, unknown>[], total: number;
    const exporting = q.format !== 'json';
    if (exporting) assertPermission(req.actor, 'reports.export');
    const take = exporting ? 10001 : q.limit,
      skip = exporting ? 0 : (q.page - 1) * q.limit;
    if (['employees', 'salaries', 'birthdays'].includes(kind)) {
      if (kind === 'salaries') assertPermission(req.actor, 'employees.view_salary');
      if (kind === 'birthdays') assertPermission(req.actor, 'employees.view_personal');
      const employees = await this.db.employee.findMany({
        where: base,
        include: {
          company: { select: { name: true } },
          branch: { select: { name: true } },
          department: { select: { name: true } },
          jobPosition: { select: { name: true } },
          ...(kind === 'salaries'
            ? {
                benefits: { where: { deletedAt: null, isActive: true } },
                allowances: { where: { deletedAt: null, isActive: true } },
              }
            : {}),
        },
        take,
        skip,
        orderBy: {
          [['name', 'registration', 'admissionDate'].includes(q.sort ?? '') ? q.sort! : 'name']:
            q.direction,
        },
      });
      total = await this.db.employee.count({ where: base });
      rows = employees.map((e) => {
        const protectedRow = protectEmployee(e, req.actor);
        const baseRow: Record<string, unknown> = {
          registration: e.registration,
          name: e.name,
          company: e.company.name,
          branch: e.branch.name,
          department: e.department.name,
          position: e.jobPosition.name,
          admissionDate: e.admissionDate.toISOString().slice(0, 10),
          status: e.status,
        };
        if ('cpf' in protectedRow) baseRow.cpf = e.cpf;
        if ('salary' in protectedRow) baseRow.salary = e.salary.toString();
        if (kind === 'birthdays') baseRow.birthDate = e.birthDate.toISOString().slice(0, 10);
        if (kind === 'salaries') {
          const benefits = e.benefits.reduce((s, b) => s.add(b.value), new Prisma.Decimal(0));
          const allowances = e.allowances.reduce((s, b) => s.add(b.value), new Prisma.Decimal(0));
          baseRow.benefits = benefits.toString();
          baseRow.allowances = allowances.toString();
          baseRow.total = e.salary.add(benefits).add(allowances).toString();
        }
        return baseRow;
      });
    } else if (kind === 'vacations') {
      assertPermission(req.actor, 'vacations.view');
      const where = { employee: base };
      const data = await this.db.vacationAccrualPeriod.findMany({
        where,
        include: { employee: { select: { name: true, registration: true } }, vacations: true },
        take,
        skip,
        orderBy: { deadline: 'asc' },
      });
      total = await this.db.vacationAccrualPeriod.count({ where });
      rows = data.map((p) => {
        const reservations = p.vacations.filter(
          (v) => !['CANCELLED', 'REJECTED'].includes(v.status),
        );
        const used = reservations
            .filter((v) => v.status === 'COMPLETED')
            .reduce((s, v) => s + v.days, 0),
          programmed = reservations
            .filter((v) => v.status !== 'COMPLETED')
            .reduce((s, v) => s + v.days, 0),
          sold = reservations.reduce((s, v) => s + v.soldDays, 0);
        return {
          name: p.employee.name,
          registration: p.employee.registration,
          startDate: p.startDate.toISOString().slice(0, 10),
          endDate: p.endDate.toISOString().slice(0, 10),
          deadline: p.deadline.toISOString().slice(0, 10),
          acquired: p.acquiredDays - p.reducedDays,
          used,
          programmed,
          sold,
          balance: p.acquiredDays - p.reducedDays - used - programmed - sold,
        };
      });
    } else if (kind === 'health' || kind === 'documents') {
      assertPermission(
        req.actor,
        kind === 'health' ? 'health.view_sensitive' : 'employees.view_documents',
      );
      const where = { employee: base, deletedAt: null };
      const args = {
        where,
        include: { employee: { select: { name: true } } },
        take,
        skip,
        orderBy: { createdAt: 'desc' as const },
      };
      const data =
        kind === 'health'
          ? await this.db.occupationalHealthExam.findMany(args)
          : await this.db.employeeDocument.findMany(args);
      total =
        kind === 'health'
          ? await this.db.occupationalHealthExam.count({ where })
          : await this.db.employeeDocument.count({ where });
      rows = data.map((d) => ({
        name: d.employee.name,
        type: d.type,
        expiresAt: d.expiresAt?.toISOString().slice(0, 10) ?? '',
        ...('examDate' in d
          ? { examDate: d.examDate.toISOString().slice(0, 10), result: d.result }
          : { status: d.status }),
      }));
    } else if (kind === 'movements') {
      assertPermission(req.actor, 'movements.view');
      const where = {
        employee: base,
        deletedAt: null,
        ...(q.from || q.to
          ? {
              effectiveDate: {
                ...(q.from ? { gte: new Date(q.from) } : {}),
                ...(q.to ? { lte: new Date(q.to) } : {}),
              },
            }
          : {}),
      };
      const data = await this.db.employeeMovement.findMany({
        where,
        include: { employee: { select: { name: true } } },
        take,
        skip,
        orderBy: { effectiveDate: 'desc' },
      });
      total = await this.db.employeeMovement.count({ where });
      rows = data.map((m) => ({
        name: m.employee.name,
        type: m.type,
        effectiveDate: m.effectiveDate.toISOString().slice(0, 10),
        reason: m.reason,
      }));
    } else if (kind === 'turnover') {
      const start = q.from ? new Date(q.from) : new Date(new Date().getFullYear(), 0, 1),
        end = q.to ? new Date(q.to) : new Date();
      if (end < start || end.getTime() - start.getTime() > 366 * 86400000 * 5)
        throw new BadRequestException('Escolha um período de até cinco anos.');
      rows = [];
      const scope = buildEmployeeWhere(req.actor, { ...q, from: undefined, to: undefined });
      for (
        let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
        d <= end;
        d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
      ) {
        const a = new Date(Math.max(d.getTime(), start.getTime())),
          b = new Date(
            Math.min(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 1, end.getTime()),
          );
        const [admissions, terminations, opening, closing] = await Promise.all([
          this.db.employee.count({
            where: { AND: [scope, { admissionDate: { gte: a, lte: b } }] },
          }),
          this.db.employee.count({
            where: { AND: [scope, { terminationDate: { gte: a, lte: b } }] },
          }),
          this.db.employee.count({
            where: {
              AND: [
                scope,
                {
                  admissionDate: { lt: a },
                  OR: [{ terminationDate: null }, { terminationDate: { gte: a } }],
                },
              ],
            },
          }),
          this.db.employee.count({
            where: {
              AND: [
                scope,
                {
                  admissionDate: { lte: b },
                  OR: [{ terminationDate: null }, { terminationDate: { gt: b } }],
                },
              ],
            },
          }),
        ]);
        rows.push({
          month: d.toISOString().slice(0, 7),
          admissions,
          terminations,
          opening,
          closing,
          ...turnover(admissions, terminations, opening, closing),
        });
      }
      total = rows.length;
    } else throw new BadRequestException('Relatório não disponível.');
    if (rows.length > 10000)
      throw new BadRequestException('A exportação excede 10.000 registros. Refine os filtros.');
    if (q.columns) {
      const columns = q.columns.split(',');
      rows = rows.map((row) =>
        Object.fromEntries(Object.entries(row).filter(([key]) => columns.includes(key))),
      );
    }
    await audit(
      this.db,
      req,
      exporting ? 'EXPORTACAO' : 'CONSULTA_RELATORIO',
      'reports',
      kind,
      undefined,
      { filters: q, count: rows.length },
    );
    if (!exporting)
      return ok(rows, 'Relatório gerado.', {
        page: q.page,
        limit: q.limit,
        total,
        totalPages: Math.ceil(total / q.limit),
      });
    const columns = Object.keys(rows[0] ?? {});
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="geo-${kind}.${q.format}"`);
    if (q.format === 'csv') {
      res.type('text/csv; charset=utf-8');
      return (
        '\uFEFF' +
        [columns, ...rows.map((r) => columns.map((c) => safeCell(r[c])))]
          .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';'))
          .join('\r\n')
      );
    }
    if (q.format === 'xlsx') {
      const book = new Workbook(),
        sheet = book.addWorksheet('Relatório');
      sheet.columns = columns.map((key) => ({ header: key, key, width: 24 }));
      rows.forEach((r) =>
        sheet.addRow(Object.fromEntries(columns.map((c) => [c, safeCell(r[c])]))),
      );
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16324F' } };
      sheet.autoFilter = { from: 'A1', to: { row: 1, column: Math.max(1, columns.length) } };
      res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return new StreamableFile(Buffer.from(await book.xlsx.writeBuffer()));
    }
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
    const chunks: Buffer[] = [];
    const ready = new Promise<Buffer>((resolve) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });
    doc.fontSize(16).text(`GEO RH — ${kind}`);
    doc
      .fontSize(9)
      .text(`Gerado em ${new Date().toISOString()} • ${rows.length} registros`)
      .moveDown();
    rows.forEach((r, i) => {
      doc
        .fontSize(8)
        .text(`${i + 1}. ${columns.map((c) => `${c}: ${String(r[c] ?? '')}`).join(' | ')}`)
        .moveDown(0.5);
    });
    doc.end();
    res.type('application/pdf');
    return new StreamableFile(await ready);
  }
  @Get('alerts') @Permission('alerts.view') async alerts(
    @Query() query: unknown,
    @Req() req: AuthRequest,
  ) {
    const q = parse(pagination, query);
    const where = {
      employee: employeeScope(req.actor),
      ...(q.status ? { status: q.status } : {}),
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
    };
    const [data, total] = await Promise.all([
      this.db.alert.findMany({
        where,
        include: { employee: { select: { id: true, name: true } } },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { dueDate: 'asc' },
      }),
      this.db.alert.count({ where }),
    ]);
    return ok(data, 'Alertas consultados.', {
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.ceil(total / q.limit),
    });
  }
  @Patch('alerts/:id/:action') @Permission('alerts.update') async alertAction(
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const options: Record<string, Prisma.AlertUpdateManyMutationInput> = {
      read: { readAt: new Date() },
      resolve: { status: 'RESOLVIDO' },
      ignore: { status: 'IGNORADO' },
      snooze: { status: 'ADIADO', snoozedUntil: new Date(Date.now() + 7 * 86400000) },
    };
    if (!options[action]) throw new BadRequestException('Ação inválida.');
    await this.db.$transaction(async (tx) => {
      const result = await tx.alert.updateMany({
        where: { id: parse(z.uuid(), id), employee: employeeScope(req.actor) },
        data: options[action],
      });
      if (!result.count) throw new BadRequestException('Alerta não encontrado.');
      await audit(tx, req, action.toUpperCase(), 'alerts', id);
    });
    return ok(null, 'Alerta atualizado.');
  }
}
