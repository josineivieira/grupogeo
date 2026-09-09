import { z } from 'zod';
export const addressSchema = z.object({
  postalCode: z.string().transform((v) => v.replace(/\D/g, '')).refine((v) => v.length === 8, 'CEP inválido.'),
  street: z.string().min(1, 'Informe o logradouro.'),
  number: z.string().min(1, 'Informe o número.'),
  complement: z.string().max(4000).optional(),
  district: z.string().min(1, 'Informe o bairro.'),
  city: z.string().min(1, 'Informe a cidade.'),
  state: z.string().length(2, 'Informe a UF com 2 letras.'),
  country: z.string().default('Brasil'),
}).strict();
export const addressFields = [
  { key: 'postalCode', label: 'CEP' }, { key: 'street', label: 'Logradouro' },
  { key: 'number', label: 'Número' }, { key: 'complement', label: 'Complemento' },
  { key: 'district', label: 'Bairro' }, { key: 'city', label: 'Cidade' },
  { key: 'state', label: 'UF' }, { key: 'country', label: 'País' },
];
export function splitEmployeeImport(row: Record<string, unknown>) {
  const addressKeys = new Set(addressFields.map((field) => field.key));
  const address = Object.fromEntries(Object.entries(row).filter(([key, value]) => addressKeys.has(key) && value !== '' && value !== undefined));
  const employee = Object.fromEntries(Object.entries(row).filter(([key]) => !addressKeys.has(key)));
  return { employee, address: Object.keys(address).length ? address : undefined };
}
