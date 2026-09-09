export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
  meta?: { page: number; limit: number; total: number; totalPages: number };
  errors?: { field: string; message: string }[];
}
export interface Actor {
  photoId?:string|null;
  id: string;
  name: string;
  email: string;
  permissions: string[];
  roles: string[];
  mustChangePassword: boolean;
  theme: string;
  sessionId: string;
  environmentId: string | null;
  environmentCode: string | null;
  isGlobalSuperAdmin: boolean;
}
export interface Environment {
  id: string;
  code: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  sortOrder: number;
}
export interface Row extends Record<string, unknown> {
  id: string;
  name?: string;
}
export interface Field {
  key: string;
  label: string;
  type?: 'text' | 'date' | 'number' | 'email' | 'select' | 'checkbox' | 'textarea';
  required?: boolean;
  reference?: string;
  options?: string[];
  choices?: {value:string;label:string}[];
  section?: string;
}
export interface Catalog {
  key: string;
  title: string;
  fields: Field[];
}
export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
export const setToken = (token: string | null) => {
  accessToken = token;
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fields: { field: string; message: string }[] = [],
  ) {
    super(message);
  }
}
async function refresh() {
  try {
    const res = await fetch(`${API}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (!res.ok) return false;
    const body = (await res.json()) as ApiResponse<{ accessToken: string }>;
    accessToken = body.data.accessToken;
    return true;
  } catch {
    return false;
  }
}
export async function request(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body && !(init.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(
      'Não foi possível conectar à API. Verifique se o backend está em execução.',
      0,
    );
  }
  if (res.status === 401 && retry && !path.startsWith('/auth/login')) {
    refreshing ??= refresh().finally(() => {
      refreshing = null;
    });
    if (await refreshing) return request(path, init, false);
  }
  if (!res.ok) {
    const body = (await res
      .json()
      .catch(() => ({
        message: `A solicitação falhou (HTTP ${res.status}).`,
      }))) as ApiResponse<unknown>;
    throw new ApiError(body.message, res.status, body.errors);
  }
  return res;
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> {
  return (await request(path, init)).json() as Promise<ApiResponse<T>>;
}
export const send = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});
export async function download(path: string, name: string) {
  const response = await request(path);
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a');
  a.href = url;
  const header=response.headers.get('Content-Disposition');
  const encoded=header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  a.download = encoded?decodeURIComponent(encoded):(header?.match(/filename="([^"]+)"/i)?.[1]??name);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function display(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'object') {
    if ('name' in value) return String(value.name);
    return JSON.stringify(value);
  }
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s))
    return new Date(s).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  return s;
}
export function maskCpf(value: string) {
  const d = value.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}
export function maskBrazilian(key: string, value: string) {
  const digits = value.replace(/\D/g, '');
  if (key === 'cnpj') return digits.slice(0,14).replace(/^(\d{2})(\d)/,'$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/,'$1.$2.$3').replace(/(\d{3})(\d)/,'$1/$2').replace(/(\d{4})(\d{1,2})$/,'$1-$2');
  if (key === 'postalCode') return digits.slice(0,8).replace(/(\d{5})(\d)/,'$1-$2');
  if (['phone','whatsapp','secondaryPhone'].includes(key)) return digits.slice(0,11).replace(/^(\d{2})(\d)/,'($1) $2').replace(/(\d{4,5})(\d{4})$/,'$1-$2');
  if (key === 'pis') return digits.slice(0,11).replace(/^(\d{3})(\d)/,'$1.$2').replace(/(\d{5})(\d)/,'$1.$2').replace(/(\d{2})(\d)$/,'$1-$2');
  return value;
}
export const statusLabel: Record<string, string> = {
  ACTIVE: 'Ativo',
  PROBATION: 'Em experiência',
  ON_LEAVE: 'Afastado',
  ON_VACATION: 'Em férias',
  LICENSE: 'Licença',
  NOTICE: 'Aviso prévio',
  TERMINATED: 'Desligado',
  SUSPENDED: 'Suspenso',
  INACTIVE: 'Inativo',
  REQUESTED: 'Solicitada',
  MANAGER_APPROVED: 'Aprovada pelo gestor',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
  CANCELLED: 'Cancelada',
  COMPLETED: 'Concluída',
  ABERTO: 'Aberto',
  RESOLVIDO: 'Resolvido',
  IGNORADO: 'Ignorado',
  ADIADO: 'Adiado',
};
