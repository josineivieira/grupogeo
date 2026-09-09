import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Database, json } from './core';
import { addDays, anniversary, vacationRules } from './vacations';
@Injectable()
export class ScheduledJobs implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  constructor(private readonly db: Database) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.run(), 60000);
    void this.run();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async run() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.db.$transaction(
        async (tx) => {
          const lock = await tx.$queryRaw<
            { locked: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(749201) AS locked`;
          if (!lock[0].locked) return;
          const now = new Date(),
            today = new Date(now.toISOString().slice(0, 10));
          const ruleRow = await tx.systemSetting.findUnique({ where: { key: 'vacations' } });
          if (!ruleRow) return;
          const rules = vacationRules.parse(ruleRow.value);
          const employees = await tx.employee.findMany({
            where: { deletedAt: null, isActive: true },
            select: { id: true, admissionDate: true, status: true, createdBy: true },
          });
          for (const e of employees) {
            for (let n = 0; n < 100 && anniversary(e.admissionDate, n) <= today; n++) {
              const startDate = anniversary(e.admissionDate, n);
              await tx.vacationAccrualPeriod.upsert({
                where: { employeeId_startDate: { employeeId: e.id, startDate } },
                create: {
                  employeeId: e.id,
                  startDate,
                  endDate: addDays(anniversary(e.admissionDate, n + 1), -1),
                  deadline: addDays(anniversary(e.admissionDate, n + 2), -1),
                  acquiredDays: rules.defaultDays,
                },
                update: {},
              });
            }
            const vacation = await tx.vacationPeriod.findFirst({
              where: {
                employeeId: e.id,
                status: 'APPROVED',
                startDate: { lte: today },
                endDate: { gte: today },
              },
            });
            const leave = await tx.leaveOfAbsence.findFirst({
              where: {
                employeeId: e.id,
                deletedAt: null,
                actualReturn: null,
                startDate: { lte: today },
              },
            });
            const desired = leave
              ? 'ON_LEAVE'
              : vacation
                ? 'ON_VACATION'
                : ['ON_LEAVE', 'ON_VACATION'].includes(e.status)
                  ? 'ACTIVE'
                  : e.status;
            if (desired !== e.status) {
              await tx.employee.update({ where: { id: e.id }, data: { status: desired } });
              await tx.employeeMovement.create({
                data: {
                  employeeId: e.id,
                  type: desired === 'ACTIVE' ? 'RETORNO' : 'ATUALIZACAO_SITUACAO',
                  effectiveDate: today,
                  before: { status: e.status },
                  after: { status: desired },
                  reason: 'Atualização automática por período registrado',
                  createdBy: e.createdBy,
                },
              });
              await tx.auditLog.create({
                data: {
                  action: 'SITUACAO_AUTOMATICA',
                  module: 'employees',
                  recordId: e.id,
                  before: json({ status: e.status }),
                  after: json({ status: desired }),
                  ip: 'system',
                  userAgent: 'geo-scheduler',
                },
              });
            }
          }
          await tx.vacationPeriod.updateMany({
            where: { status: 'APPROVED', endDate: { lt: today } },
            data: { status: 'COMPLETED' },
          });
          await tx.leaveOfAbsence.updateMany({
            where: { status: 'PROGRAMADO', startDate: { lte: today }, actualReturn: null },
            data: { status: 'EM_ANDAMENTO' },
          });
          const alertSetting = await tx.systemSetting.findUnique({ where: { key: 'alerts' } });
          const days = (alertSetting?.value as { days?: number[] } | null)?.days ?? [30];
          const horizon = addDays(today, Math.max(...days));
          const docs = await tx.employeeDocument.findMany({
            where: {
              deletedAt: null,
              expiresAt: { lte: horizon },
              employee: { deletedAt: null, isActive: true },
            },
          });
          const health = await tx.occupationalHealthExam.findMany({
            where: {
              deletedAt: null,
              expiresAt: { lte: horizon },
              employee: { deletedAt: null, isActive: true },
            },
          });
          const periods = await tx.vacationAccrualPeriod.findMany({
            where: { deadline: { lte: horizon }, employee: { deletedAt: null, isActive: true } },
            include: { vacations: true },
          });
          const experience = await tx.experienceContract.findMany({
            where: {
              deletedAt: null,
              result: { in: ['EM_EXPERIENCIA', 'PRORROGADO'] },
              firstEnd: { lte: horizon },
              employee: { deletedAt: null, isActive: true },
            },
          });
          const alerts = [
            ...docs.map((d) => ({
              key: `doc:${d.id}`,
              employeeId: d.employeeId,
              title: 'Validade de documento',
              category: 'DOCUMENTO',
              dueDate: d.expiresAt!,
              link: '/documents',
            })),
            ...health.map((h) => ({
              key: `health:${h.id}`,
              employeeId: h.employeeId,
              title: `Validade de ${h.category}`,
              category: h.category,
              dueDate: h.expiresAt!,
              link: '/health',
            })),
            ...periods
              .filter(
                (p) =>
                  p.acquiredDays -
                    p.reducedDays -
                    p.vacations
                      .filter((v) => !['CANCELLED', 'REJECTED'].includes(v.status))
                      .reduce((s, v) => s + v.days + v.soldDays, 0) >
                  0,
              )
              .map((p) => ({
                key: `vacation:${p.id}`,
                employeeId: p.employeeId,
                title: 'Prazo concessivo de férias',
                category: 'FERIAS',
                dueDate: p.deadline,
                link: '/vacations',
              })),
            ...experience.map((e) => ({
              key: `experience:${e.id}`,
              employeeId: e.employeeId,
              title: 'Fim do contrato de experiência',
              category: 'EXPERIENCIA',
              dueDate: e.secondEnd ?? e.firstEnd,
              link: '/experience',
            })),
          ];
          for (const item of alerts) {
            const priority = item.dueDate < today ? 'CRITICA' : 'ALTA';
            const description =
              item.dueDate < today
                ? 'Prazo vencido. Verifique o registro relacionado.'
                : 'Prazo próximo. Verifique a programação e os documentos.';
            await tx.alert.upsert({
              where: { key: item.key },
              create: { ...item, priority, description },
              update: { dueDate: item.dueDate, priority, description },
            });
          }
        },
        { timeout: 60000 },
      );
    } catch (e) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'scheduled_job_failed',
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      this.busy = false;
    }
  }
}
