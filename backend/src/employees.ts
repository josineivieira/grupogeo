import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Employee, Prisma } from '@prisma/client';
import { z } from 'zod';
import { Permission } from './auth';
import {
  Actor,
  AuthRequest,
  Database,
  assertCompany,
  assertPermission,
  audit,
  cpf,
  date,
  employeeScope,
  json,
  money,
  ok,
  pagination,
  parse,
  phone,
  validPis,
} from './core';
import { Field } from './catalog';
import { protectBank } from './security';
import { addressSchema } from './employee-address';
const opt = z.string().max(4000).optional(),
  uuid = z.uuid();
export const employeeSchema = z
  .object({
    registration: z.string().min(1).max(40),
    name: z.string().min(3).max(150),
    socialName: opt,
    cpf,
    rg: opt,
    rgIssuer: opt,
    rgState: opt,
    rgIssuedAt: date.optional(),
    pis: z.string().refine(validPis, 'PIS inválido.').optional(),
    birthDate: date,
    sex: opt,
    maritalStatus: opt,
    nationality: opt,
    birthplace: opt,
    motherName: opt,
    fatherName: opt,
    education: opt,
    email: z.email().optional(),
    phone: phone.optional(),
    whatsapp: phone.optional(),
    bloodType: opt,
    notes: opt,
    companyId: uuid,
    branchId: uuid,
    departmentId: uuid,
    sectorId: uuid.optional(),
    jobPositionId: uuid,
    managerId: uuid.optional(),
    costCenterId: uuid.optional(),
    workScheduleId: uuid.optional(),
    admissionDate: date,
    contractType: z.string().min(1),
    contractStart: date.optional(),
    contractEnd: date.optional(),
    workLocation: opt,
    workMode: z.enum(['PRESENCIAL', 'HIBRIDO', 'REMOTO']).default('PRESENCIAL'),
    salary: money,
    salaryType: z.string().default('MENSAL'),
    unionName: opt,
    professionalNotes: opt,
  })
  .strict();
export const fields: Field[] = [
  { key: 'registration', label: 'Matrícula', required: true, section: 'Profissional' },
  { key: 'name', label: 'Nome completo', required: true, section: 'Pessoal' },
  { key: 'socialName', label: 'Nome social', section: 'Pessoal' },
  { key: 'cpf', label: 'CPF', required: true, section: 'Pessoal' },
  { key: 'rg', label: 'RG', section: 'Pessoal' },
  { key: 'rgIssuer', label: 'Órgão emissor', section: 'Pessoal' },
  { key: 'rgState', label: 'UF do RG', section: 'Pessoal' },
  { key: 'rgIssuedAt', label: 'Emissão do RG', type: 'date', section: 'Pessoal' },
  { key: 'pis', label: 'PIS/PASEP', section: 'Pessoal' },
  {
    key: 'birthDate',
    label: 'Data de nascimento',
    type: 'date',
    required: true,
    section: 'Pessoal',
  },
  ...[
    ['sex', 'Sexo'],
    ['maritalStatus', 'Estado civil'],
    ['nationality', 'Nacionalidade'],
    ['birthplace', 'Naturalidade'],
    ['motherName', 'Nome da mãe'],
    ['fatherName', 'Nome do pai'],
    ['education', 'Escolaridade'],
    ['email', 'E-mail pessoal'],
    ['phone', 'Telefone'],
    ['whatsapp', 'WhatsApp'],
    ['bloodType', 'Tipo sanguíneo'],
  ].map(([key, label]): Field => ({ key, label, section: 'Pessoal' })),
  ...[
    ['companyId', 'Empresa', 'companies'],
    ['branchId', 'Filial', 'branches'],
    ['departmentId', 'Departamento', 'departments'],
    ['jobPositionId', 'Cargo', 'positions'],
    ['sectorId', 'Setor', 'sectors'],
    ['managerId', 'Gestor direto', 'employees'],
    ['costCenterId', 'Centro de custo', 'cost-centers'],
    ['workScheduleId', 'Jornada', 'work-schedules'],
  ].map(([key, label, reference], i): Field => ({
    key,
    label,
    reference,
    type: 'select',
    required: i < 4,
    section: 'Profissional',
  })),
  {
    key: 'admissionDate',
    label: 'Admissão',
    type: 'date',
    required: true,
    section: 'Profissional',
  },
  {
    key: 'contractType',
    label: 'Tipo de contratação',
    type: 'select',
    options: ['CLT', 'PJ', 'ESTAGIO', 'APRENDIZ', 'TEMPORARIO'],
    required: true,
    section: 'Profissional',
  },
  {
    key: 'salary',
    label: 'Salário base (R$)',
    type: 'number',
    required: true,
    section: 'Profissional',
  },
  {
    key: 'salaryType',
    label: 'Tipo de salário',
    type: 'select',
    options: ['MENSAL', 'HORA', 'DIA'],
    section: 'Profissional',
  },
  {
    key: 'workMode',
    label: 'Modalidade',
    type: 'select',
    options: ['PRESENCIAL', 'HIBRIDO', 'REMOTO'],
    section: 'Profissional',
  },
  { key: 'workLocation', label: 'Local de trabalho', section: 'Profissional' },
  { key: 'unionName', label: 'Sindicato', section: 'Profissional' },
  { key: 'contractStart', label: 'Início do contrato', type: 'date', section: 'Profissional' },
  { key: 'contractEnd', label: 'Fim do contrato', type: 'date', section: 'Profissional' },
  { key: 'notes', label: 'Observações pessoais', type: 'textarea', section: 'Pessoal' },
  {
    key: 'professionalNotes',
    label: 'Observações profissionais',
    type: 'textarea',
    section: 'Profissional',
  },
];
const personal = [
  'cpf',
  'rg',
  'rgIssuer',
  'rgState',
  'rgIssuedAt',
  'pis',
  'birthDate',
  'sex',
  'maritalStatus',
  'nationality',
  'birthplace',
  'motherName',
  'fatherName',
  'education',
  'email',
  'phone',
  'whatsapp',
  'bloodType',
  'notes',
];
export function protectEmployee<T extends Record<string, unknown>>(
  e: T,
  a: Actor,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...e };
  if (!a.permissions.includes('employees.view_salary')) delete out.salary;
  if (!a.permissions.includes('employees.view_personal')) {
    for (const key of personal) delete out[key];
  }
  return out;
}
const include = {
  company: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  jobPosition: { select: { id: true, name: true } },
  sector: { select: { id: true, name: true } },
  manager: { select: { id: true, name: true } },
} satisfies Prisma.EmployeeInclude;
export function buildEmployeeWhere(
  a: Actor,
  q: z.infer<typeof pagination>,
): Prisma.EmployeeWhereInput {
  return {
    AND: [
      employeeScope(a),
      {
        ...(q.search
          ? {
              OR: [
                { name: { contains: q.search, mode: 'insensitive' } },
                { registration: { contains: q.search, mode: 'insensitive' } },
                ...(a.permissions.includes('employees.view_personal')
                  ? [{ cpf: { contains: q.search.replace(/\D/g, '') || '__' } }]
                  : []),
              ],
            }
          : {}),
        ...(q.companyId ? { companyId: q.companyId } : {}),
        ...(q.branchId ? { branchId: q.branchId } : {}),
        ...(q.departmentId ? { departmentId: q.departmentId } : {}),
        ...(q.sectorId ? { sectorId: q.sectorId } : {}),
        ...(q.jobPositionId ? { jobPositionId: q.jobPositionId } : {}),
        ...(q.managerId ? { managerId: q.managerId } : {}),
        ...(q.status
          ? {
              status: z
                .enum([
                  'ACTIVE',
                  'PROBATION',
                  'ON_LEAVE',
                  'ON_VACATION',
                  'LICENSE',
                  'NOTICE',
                  'TERMINATED',
                  'SUSPENDED',
                  'INACTIVE',
                ])
                .parse(q.status),
            }
          : {}),
        ...(q.from || q.to
          ? {
              admissionDate: {
                ...(q.from ? { gte: new Date(q.from) } : {}),
                ...(q.to ? { lte: new Date(q.to) } : {}),
              },
            }
          : {}),
      },
    ],
  };
}
@Injectable()
export class EmployeeService {
  constructor(private readonly db: Database) {}
  async find(id: string, a: Actor, tx: Prisma.TransactionClient = this.db) {
    const e = await tx.employee.findFirst({
      where: { AND: [employeeScope(a), { id: parse(uuid, id) }] },
      include,
    });
    if (!e) throw new NotFoundException('Funcionário não encontrado no seu escopo de acesso.');
    return e;
  }
  async relations(data: Partial<Employee>, a: Actor, tx: Prisma.TransactionClient) {
    if (!data.companyId || !data.branchId || !data.departmentId || !data.jobPositionId)
      throw new BadRequestException('Informe toda a estrutura profissional.');
    assertCompany(a, data.companyId, data.branchId);
    const [branch, department, position] = await Promise.all([
      tx.branch.findFirst({
        where: {
          id: data.branchId,
          companyId: data.companyId,
          deletedAt: null,
          isActive: true,
          company: { deletedAt: null, isActive: true },
        },
      }),
      tx.department.findFirst({
        where: {
          id: data.departmentId,
          companyId: data.companyId,
          deletedAt: null,
          isActive: true,
        },
      }),
      tx.jobPosition.findFirst({
        where: {
          id: data.jobPositionId,
          departmentId: data.departmentId,
          deletedAt: null,
          isActive: true,
        },
      }),
    ]);
    if (!branch || !department || !position)
      throw new BadRequestException(
        'Empresa, filial, departamento e cargo devem formar uma estrutura válida e ativa.',
      );
    if (
      data.sectorId &&
      !(await tx.sector.findFirst({
        where: {
          id: data.sectorId,
          departmentId: data.departmentId,
          branchId: data.branchId,
          deletedAt: null,
        },
      }))
    )
      throw new BadRequestException('Setor incompatível com a filial ou departamento.');
    if (
      data.costCenterId &&
      !(await tx.costCenter.findFirst({
        where: {
          id: data.costCenterId,
          companyId: data.companyId,
          deletedAt: null,
          OR: [{ branchId: null }, { branchId: data.branchId }],
        },
      }))
    )
      throw new BadRequestException('Centro de custo incompatível.');
    if (data.managerId) {
      if (data.managerId === data.id)
        throw new BadRequestException('Um funcionário não pode ser seu próprio gestor.');
      if (
        !(await tx.employee.findFirst({
          where: { id: data.managerId, companyId: data.companyId, deletedAt: null, isActive: true },
        }))
      )
        throw new BadRequestException('Gestor inválido para a empresa.');
    }
    if (
      data.workScheduleId &&
      !(await tx.workSchedule.findFirst({
        where: { id: data.workScheduleId, isActive: true, deletedAt: null },
      }))
    )
      throw new BadRequestException('Jornada inválida.');
    if (data.birthDate && data.admissionDate && data.birthDate >= data.admissionDate)
      throw new BadRequestException('Nascimento deve ser anterior à admissão.');
    if (data.contractStart && data.contractEnd && data.contractEnd < data.contractStart)
      throw new BadRequestException('Fim do contrato deve ser posterior ao início.');
  }
  async create(body: unknown, req: AuthRequest, address?: unknown) {
    assertPermission(req.actor, 'employees.view_personal');
    assertPermission(req.actor, 'employees.update_salary');
    const data = parse(employeeSchema, body);
    const addressData = address === undefined ? undefined : parse(addressSchema, address);
    return this.db.$transaction(async (tx) => {
      await this.relations({ ...data, salary: new Prisma.Decimal(data.salary) }, req.actor, tx);
      const e = await tx.employee.create({
        data: { ...data, createdBy: req.actor.id, updatedBy: req.actor.id, ...(addressData ? { address: { create: addressData } } : {}) },
      });
      await tx.salaryHistory.create({
        data: {
          employeeId: e.id,
          previousSalary: 0,
          newSalary: e.salary,
          type: 'ADMISSAO',
          reason: 'Cadastro inicial',
          effectiveDate: e.admissionDate,
          createdBy: req.actor.id,
        },
      });
      await tx.employeeMovement.create({
        data: {
          employeeId: e.id,
          type: 'ADMISSAO',
          effectiveDate: e.admissionDate,
          before: {},
          after: json(e),
          reason: 'Cadastro inicial',
          createdBy: req.actor.id,
        },
      });
      await audit(tx, req, 'CRIACAO', 'employees', e.id, undefined, e);
      return ok(protectEmployee(e, req.actor), 'Funcionário cadastrado.');
    });
  }
  async update(id: string, body: unknown, req: AuthRequest) {
    const data = parse(employeeSchema.partial(), body);
    const keys = Object.keys(data);
    if (keys.some((k) => personal.includes(k)))
      assertPermission(req.actor, 'employees.view_personal');
    const protectedKeys = [
      'salary',
      'companyId',
      'branchId',
      'departmentId',
      'sectorId',
      'jobPositionId',
      'managerId',
      'costCenterId',
      'workScheduleId',
      'admissionDate',
    ];
    return this.db.$transaction(async (tx) => {
      const before = await this.find(id, req.actor, tx);
      for (const key of protectedKeys) {
        if (
          key in data &&
          String(data[key as keyof typeof data]) !== String(before[key as keyof typeof before])
        )
          throw new BadRequestException(
            'Alterações na estrutura, admissão ou salário devem ser registradas pelo fluxo de movimentação.',
          );
      }
      const { salary, ...editable } = data;
      const merged = { ...before, ...editable };
      await this.relations(merged, req.actor, tx);
      const after = await tx.employee.update({
        where: { id },
        data: { ...editable, updatedBy: req.actor.id },
      });
      await audit(tx, req, 'EDICAO', 'employees', id, before, after);
      return ok(protectEmployee(after, req.actor), 'Ficha atualizada.');
    });
  }
}
@ApiTags('Funcionários')
@ApiBearerAuth()
@Controller('employees')
export class EmployeeController {
  constructor(
    private readonly db: Database,
    private readonly service: EmployeeService,
  ) {}
  @Get('fields') @Permission('employees.view') fields(@Req() req: AuthRequest) {
    return ok(
      fields.filter(
        (f) =>
          (!personal.includes(f.key) ||
            req.actor.permissions.includes('employees.view_personal')) &&
          (f.key !== 'salary' || req.actor.permissions.includes('employees.view_salary')),
      ),
    );
  }
  @Get() @Permission('employees.view') async list(
    @Query() query: unknown,
    @Req() req: AuthRequest,
  ) {
    const q = parse(pagination, query),
      where = buildEmployeeWhere(req.actor, q);
    const allowed = [
      'name',
      'registration',
      'admissionDate',
      'status',
      ...(req.actor.permissions.includes('employees.view_salary') ? ['salary'] : []),
    ];
    const sort = allowed.includes(q.sort ?? '') ? q.sort! : 'name';
    const [rows, total] = await Promise.all([
      this.db.employee.findMany({
        where,
        include,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { [sort]: q.direction },
      }),
      this.db.employee.count({ where }),
    ]);
    if (
      req.actor.permissions.includes('employees.view_salary') ||
      req.actor.permissions.includes('employees.view_personal')
    )
      await audit(this.db, req, 'VISUALIZACAO_SENSIVEL', 'employees', undefined, undefined, {
        count: rows.length,
      });
    return ok(
      rows.map((e) => protectEmployee(e, req.actor)),
      'Consulta realizada.',
      { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
    );
  }
  @Post() @Permission('employees.create') create(@Body() body: unknown, @Req() req: AuthRequest) {
    return this.service.create(body, req);
  }
  @Get(':id') @Permission('employees.view') async get(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    const e = await this.service.find(id, req.actor);
    await audit(this.db, req, 'VISUALIZACAO_SENSIVEL', 'employees', id);
    return ok(protectEmployee(e, req.actor));
  }
  @Patch(':id') @Permission('employees.update') update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.update(id, body, req);
  }
  @Delete(':id') @Permission('employees.delete') async remove(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    return this.db.$transaction(async (tx) => {
      const e = await this.service.find(id, req.actor, tx);
      await tx.employee.update({
        where: { id },
        data: { deletedAt: new Date(), deletedBy: req.actor.id, isActive: false },
      });
      await tx.user.updateMany({ where: { employeeId: id }, data: { isActive: false } });
      await tx.session.updateMany({
        where: { user: { employeeId: id } },
        data: { revokedAt: new Date() },
      });
      await audit(tx, req, 'EXCLUSAO_LOGICA', 'employees', id, e);
      return ok(null, 'Funcionário desativado. Histórico preservado.');
    });
  }
  @Get(':id/history') @Permission('employees.view') async history(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() req: AuthRequest,
  ) {
    await this.service.find(id, req.actor);
    const q = parse(pagination, query);
    const where = { employeeId: id };
    const [rows, total] = await Promise.all([
      this.db.employeeMovement.findMany({
        where,
        orderBy: { effectiveDate: 'desc' },
        take: q.limit,
        skip: (q.page - 1) * q.limit,
      }),
      this.db.employeeMovement.count({ where }),
    ]);
    await audit(this.db, req, 'VISUALIZACAO_SENSIVEL', 'history', id);
    return ok(
      rows.map((r) => ({
        ...r,
        before: protectEmployee((r.before ?? {}) as Record<string, unknown>, req.actor),
        after: protectEmployee((r.after ?? {}) as Record<string, unknown>, req.actor),
      })),
      'Histórico consultado.',
      { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
    );
  }
  @Get(':id/salary-history') @Permission('employees.view_salary') async salaries(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    await this.service.find(id, req.actor);
    await audit(this.db, req, 'VISUALIZACAO_SENSIVEL', 'salary', id);
    return ok(
      await this.db.salaryHistory.findMany({
        where: { employeeId: id },
        orderBy: { effectiveDate: 'desc' },
      }),
    );
  }
  @Get(':id/address') @Permission('employees.view_personal') async address(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    await this.service.find(id, req.actor);
    await audit(this.db, req, 'VISUALIZACAO_SENSIVEL', 'address', id);
    return ok(await this.db.employeeAddress.findUnique({ where: { employeeId: id } }));
  }
  @Post(':id/address') @Permission('employees.update') async saveAddress(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    assertPermission(req.actor, 'employees.view_personal');
    await this.service.find(id, req.actor);
    const dto = parse(addressSchema, body);
    return this.db.$transaction(async (tx) => {
      const before = await tx.employeeAddress.findUnique({ where: { employeeId: id } });
      const after = await tx.employeeAddress.upsert({
        where: { employeeId: id },
        create: { ...dto, employeeId: id },
        update: dto,
      });
      await audit(tx, req, 'EDICAO', 'address', id, before, after);
      return ok(after, 'Endereço salvo.');
    });
  }
  @Get(':id/bank') @Permission('employees.view_bank') async bank(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    await this.service.find(id, req.actor);
    await audit(this.db, req, 'VISUALIZACAO_SENSIVEL', 'bank', id);
    const account=await this.db.employeeBankAccount.findUnique({ where: { employeeId: id } });
    return ok(account?protectBank(account,'decrypt'):null);
  }
  @Post(':id/bank') @Permission('employees.update') async saveBank(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    assertPermission(req.actor, 'employees.view_bank');
    await this.service.find(id, req.actor);
    const dto = parse(
      z
        .object({
          bank: z.string().min(1),
          bankCode: z.string().min(1),
          agency: z.string().min(1),
          account: z.string().min(1),
          digit: z.string().min(1),
          type: z.string().min(1),
          pix: opt,
          holder: z.string().min(1),
          holderCpf: cpf,
        })
        .strict(),
      body,
    );
    return this.db.$transaction(async (tx) => {
      const before = await tx.employeeBankAccount.findUnique({ where: { employeeId: id } });
      const after = await tx.employeeBankAccount.upsert({
        where: { employeeId: id },
        create: { ...protectBank(dto,'encrypt'), employeeId: id },
        update: protectBank(dto,'encrypt'),
      });
      await audit(tx, req, 'EDICAO', 'bank', id, before, after);
      return ok(protectBank(after,'decrypt'), 'Conta bancária salva.');
    });
  }
  @Post(':id/movements') @Permission('movements.create') async movement(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const dto = parse(
      z
        .object({
          type: z.enum(['TRANSFERENCIA', 'PROMOCAO', 'ALTERACAO_SALARIAL']),
          effectiveDate: date,
          reason: z.string().min(5),
          salary: money.optional(),
          companyId: uuid.optional(),
          branchId: uuid.optional(),
          departmentId: uuid.optional(),
          sectorId: uuid.optional(),
          jobPositionId: uuid.optional(),
          managerId: uuid.optional(),
          costCenterId: uuid.optional(),
          workScheduleId: uuid.optional(),
          workLocation: opt,
        })
        .strict(),
      body,
    );
    if (dto.salary) assertPermission(req.actor, 'employees.update_salary');
    if (dto.effectiveDate > new Date())
      throw new BadRequestException(
        'Registre a movimentação na data efetiva; agendamento futuro ainda não está disponível.',
      );
    return this.db.$transaction(
      async (tx) => {
        const before = await this.service.find(id, req.actor, tx);
        if (dto.effectiveDate < before.admissionDate)
          throw new BadRequestException('Movimentação anterior à admissão.');
        const last = await tx.employeeMovement.findFirst({
          where: { employeeId: id },
          orderBy: { effectiveDate: 'desc' },
        });
        if (last && dto.effectiveDate < last.effectiveDate)
          throw new BadRequestException(
            'A data deve ser igual ou posterior à última movimentação.',
          );
        const { type, effectiveDate, reason, ...changes } = dto;
        const data = {
          ...changes,
          ...(changes.salary ? { salary: new Prisma.Decimal(changes.salary) } : {}),
        } as Partial<Employee>;
        await this.service.relations({ ...before, ...data }, req.actor, tx);
        const after = await tx.employee.update({
          where: { id },
          data: { ...data, updatedBy: req.actor.id },
        });
        if (dto.salary)
          await tx.salaryHistory.create({
            data: {
              employeeId: id,
              previousSalary: before.salary,
              newSalary: dto.salary,
              type,
              reason,
              effectiveDate,
              createdBy: req.actor.id,
            },
          });
        await tx.employeeMovement.create({
          data: {
            employeeId: id,
            type,
            effectiveDate,
            reason,
            before: json(before),
            after: json(after),
            createdBy: req.actor.id,
          },
        });
        await audit(tx, req, type, 'movements', id, before, after, reason);
        return ok(protectEmployee(after, req.actor), 'Movimentação registrada.');
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
