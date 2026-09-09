import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Workbook } from 'exceljs';
import type { Response } from 'express';
import { z } from 'zod';
import { Permission } from './auth';
import { AuthRequest, Database, assertPermission, audit, ok, parse } from './core';
import { catalogs, CatalogService } from './catalog';
import { employeeSchema, EmployeeService, fields as employeeFields } from './employees';
const allowed = [
  'employees',
  'contacts',
  'companies',
  'branches',
  'departments',
  'sectors',
  'positions',
  'benefits',
];
const importDto = z
  .object({
    kind: z.enum([
      'employees',
      'contacts',
      'companies',
      'branches',
      'departments',
      'sectors',
      'positions',
      'benefits',
    ]),
    rows: z
      .array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])))
      .min(1)
      .max(1000),
  })
  .strict();
@ApiTags('Importação')
@ApiBearerAuth()
@Controller('imports')
@Permission('imports.create')
export class ImportController {
  constructor(
    private readonly db: Database,
    private readonly employees: EmployeeService,
    private readonly catalog: CatalogService,
  ) {}
  @Get('template/:kind') async template(
    @Param('kind') kind: string,
    @Res() res: Response,
    @Req() req: AuthRequest,
  ) {
    if (!allowed.includes(kind)) throw new BadRequestException('Tipo de importação inválido.');
    assertPermission(req.actor, `${kind}.create`);
    const keys =
      kind === 'employees'
        ? Object.keys(employeeSchema.shape)
        : Object.keys(catalogs[kind].schema.shape);
    const fields = kind === 'employees' ? employeeFields : catalogs[kind].fields;
    const book = new Workbook();
    const sheet = book.addWorksheet('Dados');
    sheet.columns = keys.map((key) => {
      const field = fields.find((f) => f.key === key);
      if (!field) throw new Error(`Campo sem tradução no modelo: ${key}`);
      return { header: field.label, key, width: Math.max(20, field.label.length + 4), style: { numFmt: '@' } };
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16324F' } };
    const instructions = book.addWorksheet('Instruções');
    instructions.columns = [{ header: 'Coluna', key: 'label', width: 30 }, { header: 'Preenchimento', key: 'help', width: 85 }];
    for (const key of keys) {
      const field = fields.find((f) => f.key === key)!;
      instructions.addRow({ label: field.label, help: [
        field.required ? 'Obrigatório.' : 'Opcional ou com valor padrão.',
        field.reference ? 'Informe o identificador (UUID) do cadastro relacionado.' : '',
        field.type === 'date' ? 'Use AAAA-MM-DD (ex.: 2026-09-09).' : '',
        'Preencha os registros na aba Dados, a partir da linha 2.',
      ].filter(Boolean).join(' ') });
    }
    const names: Record<string, string> = { employees: 'funcionarios', contacts: 'contatos', companies: 'empresas', branches: 'filiais', departments: 'departamentos', sectors: 'setores', positions: 'cargos', benefits: 'beneficios' };
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .attachment(`modelo-${names[kind]}.xlsx`)
      .send(Buffer.from(await book.xlsx.writeBuffer()));
  }
  @Post('read')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  async read(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Selecione uma planilha CSV ou XLSX de até 2 MB.');
    let rows: string[][] = [];
    if (file.originalname.toLowerCase().endsWith('.xlsx')) {
      const book = new Workbook();
      await book.xlsx.load(file.buffer as unknown as Parameters<typeof book.xlsx.load>[0]);
      const sheet = book.worksheets[0];
      if (!sheet) throw new BadRequestException('A planilha não possui aba de dados.');
      if (sheet.rowCount > 1001 || sheet.columnCount > 100)
        throw new BadRequestException('Limite de 1.000 registros e 100 colunas.');
      sheet.eachRow((row) => {
        rows.push(
          Array.from({ length: sheet.columnCount }, (_, i) => {
            const cell = row.getCell(i + 1);
            return cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : cell.text;
          }),
        );
      });
    } else if (file.originalname.toLowerCase().endsWith('.csv')) {
      rows = parseCsv(file.buffer.toString('utf8'));
    } else throw new BadRequestException('Formato inválido. Envie CSV ou XLSX.');
    if (rows.length < 2 || rows.length > 1001)
      throw new BadRequestException('O arquivo deve conter cabeçalho e até 1.000 registros.');
    const [headers, ...values] = rows;
    return ok({
      headers,
      rows: values.map((row) =>
        Object.fromEntries(headers.map((header, i) => [header, row[i] ?? ''])),
      ),
    });
  }
  @Post('validate') async validate(@Body() body: unknown, @Req() req: AuthRequest) {
    const dto = parse(importDto, body);
    assertPermission(req.actor, `${dto.kind}.create`);
    const schema = dto.kind === 'employees' ? employeeSchema : catalogs[dto.kind].schema.strict();
    const errors: {
      line: number;
      field: string;
      value: unknown;
      message: string;
      suggestion: string;
    }[] = [];
    const seen = new Set<string>();
    for (const [i, row] of dto.rows.entries()) {
      const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== ''));
      const result = schema.safeParse(clean);
      if (!result.success) {
        for (const issue of result.error.issues)
          errors.push({
            line: i + 2,
            field: issue.path.join('.'),
            value: row[String(issue.path[0])],
            message: issue.message,
            suggestion: 'Corrija o valor conforme o modelo e valide novamente.',
          });
        continue;
      }
      const unique = String(row.cpf ?? row.cnpj ?? '');
      if (unique && seen.has(unique))
        errors.push({
          line: i + 2,
          field: row.cpf ? 'cpf' : 'cnpj',
          value: unique,
          message: 'Valor duplicado dentro do arquivo.',
          suggestion: 'Remova a duplicidade.',
        });
      seen.add(unique);
      if (dto.kind === 'employees') {
        const data = result.data as z.infer<typeof employeeSchema>;
        if (await this.db.employee.findUnique({ where: { cpf: data.cpf } }))
          errors.push({
            line: i + 2,
            field: 'cpf',
            value: data.cpf,
            message: 'CPF já cadastrado.',
            suggestion: 'Atualize o funcionário existente pela ficha.',
          });
      }
    }
    return ok(
      {
        valid: errors.length === 0,
        total: dto.rows.length,
        errors,
        preview: dto.rows.slice(0, 20),
      },
      errors.length ? 'Corrija os erros antes de confirmar.' : 'Arquivo validado.',
    );
  }
  @Post('confirm') async confirm(@Body() body: unknown, @Req() req: AuthRequest) {
    const dto = parse(importDto, body);
    const validation = await this.validate(body, req);
    if (!validation.data.valid)
      throw new BadRequestException(
        'A importação contém erros. Valide novamente antes de confirmar.',
      );
    const results: { line: number; success: boolean; id?: string; error?: string }[] = [];
    for (const [i, row] of dto.rows.entries()) {
      try {
        const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== ''));
        const result =
          dto.kind === 'employees'
            ? await this.employees.create(clean, req)
            : await this.catalog.save(dto.kind, undefined, clean, req);
        results.push({ line: i + 2, success: true, id: String(result.data.id) });
      } catch (error) {
        results.push({
          line: i + 2,
          success: false,
          error: error instanceof Error ? error.message : 'Falha ao persistir o registro.',
        });
      }
    }
    await audit(this.db, req, 'IMPORTACAO', 'imports', dto.kind, undefined, {
      total: results.length,
      success: results.filter((r) => r.success).length,
    });
    return ok(
      {
        results,
        imported: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
      },
      'Importação processada. Consulte o resultado de cada linha.',
    );
  }
}
export function parseCsv(text: string) {
  const delimiter = text.split(/\r?\n/)[0].includes(';') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [],
    value = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      row.push(value.replace(/^\uFEFF/, ''));
      value = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(value);
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      value = '';
    } else value += c;
  }
  if (quoted) throw new BadRequestException('CSV contém aspas sem fechamento.');
  row.push(value);
  if (row.some((v) => v !== '')) rows.push(row);
  if (rows[0]) rows[0][0] = rows[0][0].replace(/^\uFEFF/, '');
  return rows;
}
