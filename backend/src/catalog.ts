import {
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
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  AuthRequest,
  Database,
  assertCompany,
  assertPermission,
  audit,
  cnpj,
  cpf,
  date,
  employeeScope,
  money,
  ok,
  pagination,
  parse,
  phone,
  requireDateOrder,
} from './core';

export interface Field {
  key: string;
  label: string;
  type?: 'text' | 'date' | 'number' | 'email' | 'select' | 'checkbox' | 'textarea';
  required?: boolean;
  reference?: string;
  options?: string[];
  section?: string;
  choices?: {value:string;label:string}[];
}
interface Catalog {
  model: string;
  title: string;
  fields: Field[];
  schema: z.ZodObject;
  scope: 'company' | 'branch' | 'department' | 'employee' | 'global';
  search?: string;
  creator?: boolean;
  readPermission?: string;
  writePermission?: string;
}
const t = z.string().trim().min(1).max(250),
  optional = z.string().max(4000).optional(),
  id = z.uuid();
const f = (
  key: string,
  label: string,
  type: Field['type'] = 'text',
  required = true,
  reference?: string,
): Field => ({ key, label, type, required, reference });
const emp = f('employeeId', 'Funcionário', 'select', true, 'employees');
export const catalogs: Record<string, Catalog> = {
  companies: {
    model: 'company',
    title: 'Empresas',
    scope: 'company',
    search: 'name',
    fields: [
      f('name', 'Nome fantasia'),
      f('legalName', 'Razão social'),
      f('cnpj', 'CNPJ'),
      f('email', 'E-mail', 'email', false),
      f('phone', 'Telefone', 'text', false),
      f('stateRegistration', 'Inscrição estadual', 'text', false),
      f('municipalRegistration', 'Inscrição municipal', 'text', false),
      f('website', 'Site', 'text', false),
    ],
    schema: z.object({
      name: t,
      legalName: t,
      cnpj,
      email: z.email().optional(),
      phone: phone.optional(),
      stateRegistration: optional,
      municipalRegistration: optional,
      website: optional,
    }),
  },
  branches: {
    model: 'branch',
    title: 'Filiais',
    scope: 'branch',
    search: 'name',
    fields: [
      f('companyId', 'Empresa', 'select', true, 'companies'),
      f('name', 'Nome'),
      f('code', 'Código'),
      f('cnpj', 'CNPJ'),
      f('email', 'E-mail', 'email', false),
      f('phone', 'Telefone', 'text', false),
      f('responsible', 'Responsável', 'text', false),
    ],
    schema: z.object({
      companyId: id,
      name: t,
      code: t,
      cnpj,
      email: z.email().optional(),
      phone: phone.optional(),
      responsible: optional,
    }),
  },
  departments: {
    model: 'department',
    title: 'Departamentos',
    scope: 'company',
    search: 'name',
    fields: [
      f('companyId', 'Empresa', 'select', true, 'companies'),
      f('name', 'Nome'),
      f('code', 'Código'),
      f('responsible', 'Responsável', 'text', false),
      f('description', 'Descrição', 'textarea', false),
    ],
    schema: z.object({
      companyId: id,
      name: t,
      code: t,
      responsible: optional,
      description: optional,
    }),
  },
  sectors: {
    model: 'sector',
    title: 'Setores',
    scope: 'branch',
    search: 'name',
    fields: [
      f('departmentId', 'Departamento', 'select', true, 'departments'),
      f('branchId', 'Filial', 'select', true, 'branches'),
      f('name', 'Nome'),
      f('code', 'Código'),
      f('responsible', 'Gestor', 'text', false),
      f('description', 'Descrição', 'textarea', false),
    ],
    schema: z.object({
      departmentId: id,
      branchId: id,
      name: t,
      code: t,
      responsible: optional,
      description: optional,
    }),
  },
  positions: {
    model: 'jobPosition',
    title: 'Cargos',
    scope: 'department',
    search: 'name',
    fields: [
      f('departmentId', 'Departamento', 'select', true, 'departments'),
      f('name', 'Nome do cargo'),
      f('cbo', 'CBO', 'text', false),
      f('level', 'Nível', 'text', false),
      f('salaryMin', 'Faixa mínima', 'number', false),
      f('salaryMax', 'Faixa máxima', 'number', false),
      f('responsibilities', 'Responsabilidades', 'textarea', false),
      f('requirements', 'Requisitos', 'textarea', false),
      f('education', 'Escolaridade mínima', 'text', false),
    ],
    schema: z.object({
      departmentId: id,
      name: t,
      cbo: optional,
      level: optional,
      salaryMin: money.optional(),
      salaryMax: money.optional(),
      responsibilities: optional,
      requirements: optional,
      education: optional,
    }),
  },
  'cost-centers': {
    model: 'costCenter',
    title: 'Centros de custo',
    scope: 'company',
    search: 'name',
    fields: [
      f('companyId', 'Empresa', 'select', true, 'companies'),
      f('branchId', 'Filial', 'select', false, 'branches'),
      f('code', 'Código'),
      f('name', 'Nome'),
      f('responsible', 'Responsável', 'text', false),
    ],
    schema: z.object({
      companyId: id,
      branchId: id.optional(),
      code: t,
      name: t,
      responsible: optional,
    }),
  },
  'work-schedules': {
    model: 'workSchedule',
    title: 'Jornadas de trabalho',
    scope: 'global',
    search: 'name',
    fields: [
      f('name', 'Nome'),
      f('startTime', 'Entrada (HH:mm)'),
      f('endTime', 'Saída (HH:mm)'),
      f('breakMinutes', 'Intervalo em minutos', 'number'),
      f('weeklyHours', 'Horas semanais', 'number'),
      f('scale', 'Escala'),
      f('weekdays', 'Dias da semana'),
      f('notes', 'Observações', 'textarea', false),
    ],
    schema: z.object({
      name: t,
      startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      breakMinutes: z.coerce.number().int().min(0).max(1440),
      weeklyHours: money,
      scale: t,
      weekdays: t,
      notes: optional,
    }),
  },
  contacts: {
    model: 'emergencyContact',
    title: 'Contatos de emergência',
    scope: 'employee',
    search: 'name',
    readPermission: 'employees.view_personal',
    fields: [
      emp,
      f('name', 'Nome'),
      f('relationship', 'Parentesco'),
      f('phone', 'Telefone principal'),
      f('secondaryPhone', 'Telefone secundário', 'text', false),
      f('email', 'E-mail', 'email', false),
      f('primary', 'Contato principal', 'checkbox', false),
      f('notes', 'Observações', 'textarea', false),
    ],
    schema: z.object({
      employeeId: id,
      name: t,
      relationship: t,
      phone,
      secondaryPhone: phone.optional(),
      email: z.email().optional(),
      primary: z.boolean().optional(),
      notes: optional,
    }),
  },
  dependents: {
    model: 'dependent',
    title: 'Dependentes',
    scope: 'employee',
    search: 'name',
    readPermission: 'employees.view_personal',
    fields: [
      emp,
      f('name', 'Nome'),
      f('cpf', 'CPF', 'text', false),
      f('birthDate', 'Nascimento', 'date'),
      f('relationship', 'Parentesco'),
      f('incomeTax', 'Dependente IR', 'checkbox', false),
      f('healthPlan', 'Plano de saúde', 'checkbox', false),
      f('notes', 'Observações', 'textarea', false),
    ],
    schema: z.object({
      employeeId: id,
      name: t,
      cpf: cpf.optional(),
      birthDate: date,
      relationship: t,
      incomeTax: z.boolean().optional(),
      healthPlan: z.boolean().optional(),
      notes: optional,
    }),
  },
  benefits: {
    model: 'employeeBenefit',
    title: 'Benefícios',
    scope: 'employee',
    search: 'name',
    readPermission: 'employees.view_salary',
    fields: [
      emp,
      f('type', 'Tipo'),
      f('name', 'Nome'),
      f('value', 'Valor (R$)', 'number'),
      f('provider', 'Empresa responsável', 'text', false),
      f('startDate', 'Início', 'date'),
      f('endDate', 'Fim', 'date', false),
      f('notes', 'Observações', 'textarea', false),
    ],
    schema: z.object({
      employeeId: id,
      type: t,
      name: t,
      value: money,
      provider: optional,
      startDate: date,
      endDate: date.optional(),
      notes: optional,
    }),
  },
  allowances: {
    model: 'employeeAllowance',
    title: 'Adicionais',
    scope: 'employee',
    readPermission: 'employees.view_salary',
    fields: [
      emp,
      f('type', 'Tipo'),
      f('percentage', 'Percentual', 'number', false),
      f('value', 'Valor (R$)', 'number'),
      f('startDate', 'Início', 'date'),
      f('endDate', 'Fim', 'date', false),
      f('notes', 'Observações', 'textarea', false),
    ],
    schema: z.object({
      employeeId: id,
      type: t,
      percentage: z.coerce.number().min(0).max(100).optional(),
      value: money,
      startDate: date,
      endDate: date.optional(),
      notes: optional,
    }),
  },
  documents: {
    model: 'employeeDocument',
    title: 'Documentos',
    scope: 'employee',
    search: 'name',
    creator: true,
    readPermission: 'employees.view_documents',
    fields: [
      emp,
      f('name', 'Nome do documento'),
      f('type', 'Tipo'),
      f('number', 'Número', 'text', false),
      f('issuedAt', 'Emissão', 'date', false),
      f('expiresAt', 'Validade', 'date', false),
      f('notes', 'Observações', 'textarea', false),
    ],
    schema: z.object({
      employeeId: id,
      name: t,
      type: t,
      number: optional,
      issuedAt: date.optional(),
      expiresAt: date.optional(),
      notes: optional,
      fileId: id.optional(),
    }),
  },
  health: {
    model: 'occupationalHealthExam',
    title: 'Saúde ocupacional',
    scope: 'employee',
    creator: true,
    readPermission: 'health.view_sensitive',
    fields: [
      emp,
      {
        key: 'category',
        label: 'Categoria',
        type: 'select',
        required: true,
        options: ['ASO', 'EXAME', 'TOXICOLOGICO', 'ATESTADO'],
      },
      f('type', 'Tipo de exame'),
      f('examDate', 'Data do exame', 'date'),
      f('expiresAt', 'Validade', 'date', false),
      f('clinic', 'Clínica / laboratório'),
      f('doctor', 'Médico', 'text', false),
      f('crm', 'CRM', 'text', false),
      f('result', 'Resultado'),
      f('restrictions', 'Restrições', 'textarea', false),
      f('cid', 'CID (restrito)', 'text', false),
      f('licenseCategory', 'Categoria CNH', 'text', false),
      f('examCode', 'Código do exame', 'text', false),
      f('notes', 'Observações', 'textarea', false),
    ],
    schema: z.object({
      employeeId: id,
      category: z.enum(['ASO', 'EXAME', 'TOXICOLOGICO', 'ATESTADO']),
      type: t,
      examDate: date,
      expiresAt: date.optional(),
      clinic: t,
      doctor: optional,
      crm: optional,
      result: t,
      restrictions: optional,
      cid: optional,
      licenseCategory: optional,
      examCode: optional,
      notes: optional,
      fileId: id.optional(),
    }),
  },
  experience: {
    model: 'experienceContract',
    title: 'Contratos de experiência',
    scope: 'employee',
    fields: [
      emp,
      f('startDate', 'Início', 'date'),
      f('firstEnd', 'Fim da primeira etapa', 'date'),
      f('secondEnd', 'Fim da segunda etapa', 'date', false),
      f('alertDays', 'Antecedência do alerta', 'number'),
      {
        key: 'result',
        label: 'Resultado',
        type: 'select',
        required: true,
        options: ['EM_EXPERIENCIA', 'EFETIVADO', 'PRORROGADO', 'ENCERRADO'],
      },
      f('notes', 'Observações', 'textarea', false),
    ],
    schema: z.object({
      employeeId: id,
      startDate: date,
      firstEnd: date,
      secondEnd: date.optional(),
      alertDays: z.coerce.number().int().min(0).max(365),
      result: z.enum(['EM_EXPERIENCIA', 'EFETIVADO', 'PRORROGADO', 'ENCERRADO']),
      notes: optional,
    }),
  },
};
const addressShape = {postalCode:z.string().transform(v=>v.replace(/\D/g,'')).refine(v=>v.length===8,'CEP inválido.').optional(),street:optional,number:optional,complement:optional,district:optional,city:optional,state:z.string().length(2).optional(),country:optional};
const addressFields:Field[] = [['postalCode','CEP'],['street','Logradouro'],['number','Número'],['complement','Complemento'],['district','Bairro'],['city','Cidade'],['state','Estado'],['country','País']].map(([key,label])=>({key,label,section:'Endereço'}));
for(const key of ['companies','branches']) {
  catalogs[key].schema=catalogs[key].schema.extend(addressShape);
  catalogs[key].fields.push(...addressFields);
}
export interface Row extends Record<string, unknown> {
  id: string;
}
interface Delegate {
  findMany(args: unknown): Promise<Row[]>;
  findFirst(args: unknown): Promise<Row | null>;
  count(args: unknown): Promise<number>;
  create(args: unknown): Promise<Row>;
  update(args: unknown): Promise<Row>;
}
export function delegate(db: Prisma.TransactionClient, name: string): Delegate {
  return (db as unknown as Record<string, Delegate>)[name];
}
@Injectable()
export class CatalogService {
  constructor(private readonly db: Database) {}
  config(key: string) {
    const c = catalogs[key];
    if (!c) throw new NotFoundException('Cadastro não encontrado.');
    return c;
  }
  scope(key: string, req: AuthRequest): Record<string, unknown> {
    const c = this.config(key),
      a = req.actor;
    const company = a.allCompanies ? {} : { OR:[{id:{in:a.companyIds}},{branches:{some:{id:{in:a.branchIds}}}}] };
    const branch = a.allCompanies
      ? {}
      : { OR: [{ companyId: { in: a.companyIds } }, { id: { in: a.branchIds } }] };
    if (c.scope === 'employee') return { deletedAt: null, employee: employeeScope(a) };
    if (c.scope === 'global') return { deletedAt: null };
    if (key === 'companies')
      return {
        deletedAt: null,
        ...(a.allCompanies
          ? {}
          : { OR: [company, { branches: { some: { id: { in: a.branchIds } } } }] }),
      };
    if (key === 'branches') return { deletedAt: null, ...branch };
    if (c.scope === 'branch') return { deletedAt: null, branch };
    if (c.scope === 'department') return { deletedAt: null, department: { company } };
    return { deletedAt: null, company };
  }
  async list(key: string, query: unknown, req: AuthRequest) {
    const c = this.config(key);
    assertPermission(req.actor, `${key}.view`);
    if (c.readPermission) assertPermission(req.actor, c.readPermission);
    const q = parse(pagination, query),
      where: Record<string, unknown> = { ...this.scope(key, req) };
    if (q.search && c.search) where[c.search] = { contains: q.search, mode: 'insensitive' };
    if (q.employeeId && c.scope === 'employee') where.employeeId = q.employeeId;
    if (q.companyId && c.fields.some((f) => f.key === 'companyId')) where.companyId = q.companyId;
    if (q.branchId && c.fields.some((f) => f.key === 'branchId')) where.branchId = q.branchId;
    const sort = c.fields.some((f) => f.key === q.sort) ? q.sort! : 'createdAt';
    const model = delegate(this.db, c.model);
    const relations = Object.fromEntries(c.fields.filter(f=>['companyId','branchId','departmentId'].includes(f.key)).map(f=>[f.key.replace(/Id$/,''),{select:{id:true,name:true}}]));
    const [data, total] = await Promise.all([
      model.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { [sort]: q.direction },
        ...(c.scope === 'employee'
          ? { include: { employee: { select: { id: true, name: true, registration: true } } } }
          : Object.keys(relations).length?{include:relations}:{}),
      }),
      model.count({ where }),
    ]);
    if (c.readPermission)
      await audit(this.db, req, 'VISUALIZACAO_SENSIVEL', key, undefined, undefined, {
        count: data.length,
      });
    const flattened=data.map(row=>({...row,...(row.address&&typeof row.address==='object'?row.address:{}),...(key==='positions'&&!req.actor.permissions.includes('employees.view_salary')?{salaryMin:undefined,salaryMax:undefined}:{})}));
    return ok(flattened, 'Consulta realizada.', {
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.ceil(total / q.limit),
    });
  }
  async validateRelations(
    c: Catalog,
    data: Record<string, unknown>,
    req: AuthRequest,
    tx: Prisma.TransactionClient,
  ) {
    if (typeof data.employeeId === 'string') {
      const e = await tx.employee.findFirst({
        where: { AND: [employeeScope(req.actor), { id: data.employeeId }] },
      });
      if (!e) throw new NotFoundException('Funcionário indisponível.');
    }
    if (typeof data.companyId === 'string')
      assertCompany(
        req.actor,
        data.companyId,
        typeof data.branchId === 'string' ? data.branchId : undefined,
      );
    if (typeof data.branchId === 'string') {
      const b = await tx.branch.findFirst({
        where: { id: data.branchId, deletedAt: null, isActive: true },
      });
      if (!b) throw new BadRequestException('Filial inválida.');
      assertCompany(req.actor, b.companyId, b.id);
      if (data.companyId && data.companyId !== b.companyId)
        throw new BadRequestException('Filial não pertence à empresa.');
      if (typeof data.departmentId === 'string') {
        const d = await tx.department.findUnique({ where: { id: data.departmentId } });
        if (d?.companyId !== b.companyId)
          throw new BadRequestException('Departamento e filial devem pertencer à mesma empresa.');
      }
    }
    if (typeof data.departmentId === 'string') {
      const d = await tx.department.findFirst({
        where: { id: data.departmentId, deletedAt: null },
      });
      if (!d) throw new BadRequestException('Departamento inválido.');
      assertCompany(req.actor, d.companyId);
    }
    if (data.startDate instanceof Date && data.endDate instanceof Date)
      requireDateOrder(data.startDate, data.endDate);
    if (data.startDate instanceof Date && data.firstEnd instanceof Date)
      requireDateOrder(data.startDate, data.firstEnd);
    if (data.firstEnd instanceof Date && data.secondEnd instanceof Date)
      requireDateOrder(data.firstEnd, data.secondEnd);
    if (data.examDate instanceof Date && data.expiresAt instanceof Date)
      requireDateOrder(data.examDate, data.expiresAt);
    if (data.issuedAt instanceof Date && data.expiresAt instanceof Date)
      requireDateOrder(data.issuedAt, data.expiresAt);
    if (data.salaryMin && data.salaryMax && Number(data.salaryMin) > Number(data.salaryMax))
      throw new BadRequestException('Faixa salarial máxima menor que a mínima.');
    if (typeof data.fileId === 'string') {
      const file = await tx.fileAttachment.findFirst({
        where: { id: data.fileId, employeeId: String(data.employeeId), deletedAt: null },
      });
      if (!file) throw new BadRequestException('Arquivo não pertence ao funcionário.');
    }
  }
  async save(key: string, recordId: string | undefined, body: unknown, req: AuthRequest) {
    const c = this.config(key);
    assertPermission(req.actor, `${key}.${recordId ? 'update' : 'create'}`);
    if (c.readPermission) assertPermission(req.actor, c.readPermission);
    if (key === 'companies' && !req.actor.allCompanies)
      throw new BadRequestException('A criação de empresas exige acesso organizacional total.');
    const data = parse(c.schema.strict(), body) as Record<string, unknown>;
    return this.db.$transaction(async (tx) => {
      const model = delegate(tx, c.model);
      const before = recordId
        ? await model.findFirst({
            where: { AND: [this.scope(key, req), { id: parse(z.uuid(), recordId) }] },
          })
        : null;
      if (recordId && !before) throw new NotFoundException('Registro indisponível.');
      await this.validateRelations(c, data, req, tx);
      if(['companies','branches'].includes(key)) {
        const address:Record<string,unknown>={};
        for(const field of addressFields) if(field.key in data){address[field.key]=data[field.key];delete data[field.key];}
        if(Object.keys(address).length) data.address=address;
      }
      if(key==='documents'&&data.fileId) data.status='REGULAR';
      const saved = recordId
        ? await model.update({ where: { id: recordId }, data })
        : await model.create({
            data: { ...data, ...(c.creator ? { createdBy: req.actor.id } : {}) },
          });
      await audit(tx, req, recordId ? 'EDICAO' : 'CRIACAO', key, saved.id, before, saved);
      return ok(saved, 'Registro salvo.');
    });
  }
  async remove(key: string, id: string, req: AuthRequest) {
    const c = this.config(key);
    assertPermission(req.actor, `${key}.delete`);
    return this.db.$transaction(async (tx) => {
      const m = delegate(tx, c.model);
      const before = await m.findFirst({
        where: { AND: [this.scope(key, req), { id: parse(z.uuid(), id) }] },
      });
      if (!before) throw new NotFoundException('Registro indisponível.');
      const employeeFields:Record<string,string>={companies:'companyId',branches:'branchId',departments:'departmentId',sectors:'sectorId',positions:'jobPositionId','cost-centers':'costCenterId','work-schedules':'workScheduleId'};
      if(employeeFields[key]&&await tx.employee.count({where:{[employeeFields[key]]:id,deletedAt:null,isActive:true}}))throw new BadRequestException('Existem funcionários ativos vinculados. Transfira-os antes de desativar este cadastro.');
      await m.update({ where: { id }, data: { deletedAt: new Date() } });
      await audit(tx, req, 'EXCLUSAO_LOGICA', key, id, before);
      return ok(null, 'Registro desativado.');
    });
  }
}
@ApiTags('Cadastros')
@ApiBearerAuth()
@Controller('catalogs')
export class CatalogController {
  constructor(private readonly service: CatalogService) {}
  @Get() @ApiOperation({ summary: 'Metadados dos cadastros autorizados' }) metadata(
    @Req() req: AuthRequest,
  ) {
    return ok(
      Object.entries(catalogs)
        .filter(
          ([key, c]) =>
            req.actor.permissions.includes(`${key}.view`) &&
            (!c.readPermission || req.actor.permissions.includes(c.readPermission)),
        )
        .map(([key, c]) => ({ key, title: c.title, fields: c.fields })),
    );
  }
  @Get(':key') list(@Param('key') key: string, @Query() query: unknown, @Req() req: AuthRequest) {
    return this.service.list(key, query, req);
  }
  @Post(':key') create(@Param('key') key: string, @Body() body: unknown, @Req() req: AuthRequest) {
    return this.service.save(key, undefined, body, req);
  }
  @Patch(':key/:id') update(
    @Param('key') key: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.service.save(key, id, body, req);
  }
  @Delete(':key/:id') remove(
    @Param('key') key: string,
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    return this.service.remove(key, id, req);
  }
}
