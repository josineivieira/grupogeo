import {
  BadRequestException,
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
import { randomUUID } from 'crypto';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { resolve } from 'path';
import type { Response } from 'express';
import { Permission } from './auth';
import { AuthRequest, Database, assertPermission, audit, ok } from './core';
import { EmployeeService } from './employees';
const root = () => resolve(process.env.UPLOAD_DIR ?? 'uploads');
function fileType(buffer: Buffer) {
  if (buffer.subarray(0, 5).toString() === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return { mime: 'image/png', ext: 'png' };
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    return { mime: 'image/jpeg', ext: 'jpg' };
  throw new BadRequestException('Envie um arquivo PDF, PNG ou JPEG válido, de até 10 MB.');
}
@ApiTags('Arquivos')
@ApiBearerAuth()
@Controller('files')
export class FileController {
  constructor(
    private readonly db: Database,
    private readonly employees: EmployeeService,
  ) {}
  @Post(':employeeId/:category')
  @Permission('documents.create')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  async upload(
    @Param('employeeId') employeeId: string,
    @Param('category') category: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthRequest,
  ) {
    assertPermission(req.actor, 'employees.view_documents');
    if (!['DOCUMENT', 'HEALTH', 'PHOTO'].includes(category))
      throw new BadRequestException('Categoria de arquivo inválida.');
    if (category === 'HEALTH') assertPermission(req.actor, 'health.view_sensitive');
    await this.employees.find(employeeId, req.actor);
    if (!file) throw new BadRequestException('Selecione um arquivo.');
    const type = fileType(file.buffer);
    const storageKey = `${randomUUID()}.${type.ext}`;
    await mkdir(root(), { recursive: true });
    await writeFile(resolve(root(), storageKey), file.buffer, { flag: 'wx' });
    try {
      return await this.db.$transaction(async (tx) => {
        const row = await tx.fileAttachment.create({
          data: {
            employeeId,
            category,
            name: file.originalname.replace(/[\r\n/\\]/g, '_').slice(0, 200),
            storageKey,
            mimeType: type.mime,
            size: file.size,
            createdBy: req.actor.id,
          },
        });
        await audit(tx, req, 'UPLOAD', 'files', row.id, undefined, {
          name: row.name,
          size: row.size,
        });
        return ok({ id: row.id, name: row.name }, 'Arquivo enviado.');
      });
    } catch (e) {
      await unlink(resolve(root(), storageKey));
      throw e;
    }
  }
  @Get(':id') @Permission('employees.view_documents') async download(
    @Param('id') id: string,
    @Req() req: AuthRequest,
    @Res() res: Response,
  ) {
    const file = await this.db.fileAttachment.findFirst({ where: { id, deletedAt: null } });
    if (!file) throw new BadRequestException('Arquivo não encontrado.');
    await this.employees.find(file.employeeId, req.actor);
    if (file.category === 'HEALTH') assertPermission(req.actor, 'health.view_sensitive');
    await audit(this.db, req, 'DOWNLOAD', 'files', id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'no-store');
    res.download(resolve(root(), file.storageKey), file.name);
  }
}
