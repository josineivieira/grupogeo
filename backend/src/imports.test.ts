import { describe, expect, it } from 'vitest';
import { Workbook } from 'exceljs';
import { ImportController } from './imports';
import type { AuthRequest } from './core';
import type { Response } from 'express';

describe('Excel import templates', () => {
  for (const kind of ['employees', 'contacts', 'companies', 'branches', 'departments', 'sectors', 'positions', 'benefits']) {
    it(`generates a readable Portuguese XLSX for ${kind}`, async () => {
      const controller = new ImportController(null as never, null as never, null as never);
      let buffer: Buffer = Buffer.alloc(0);
      let filename = '';
      const response = { type: () => response, attachment: (name: string) => { filename = name; return response; }, send: (value: Buffer) => { buffer = value; } };
      const request = { actor: { permissions: [`${kind}.create`] } } as AuthRequest;
      await controller.template(kind, response as unknown as Response, request);
      expect(filename).toMatch(/\.xlsx$/);
      const book = new Workbook();
      await book.xlsx.load(buffer as never);
      const sheet = book.worksheets[0];
      expect(sheet.name).toBe('Dados');
      expect(sheet.rowCount).toBe(1);
      expect(book.getWorksheet('Instruções')).toBeDefined();
      if (kind === 'employees') {
        expect(sheet.getRow(1).values).toContain('Matrícula');
        expect(sheet.getRow(1).values).toContain('Nome completo');
      }
      sheet.addRow(['000123', 'Teste']);
      const result = await controller.read({ originalname: filename, buffer: Buffer.from(await book.xlsx.writeBuffer()) } as Express.Multer.File);
      expect(result.data.rows[0][result.data.headers[0]]).toBe('000123');
    });
  }
});
