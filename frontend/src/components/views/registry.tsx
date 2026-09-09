'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  ArrowUpRight,
  Users,
  UserPlus,
  UserMinus,
  CalendarDays,
  Bell,
  Search,
  Plus,
  SlidersHorizontal,
  Pencil,
  Eye,
  Trash2,
  Download,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { Actor, api, Catalog, download, Field, Row, send } from '@/lib/api';
import { Button, ErrorBox, Loading, Modal } from '../ui';
import { DataTable } from '../data-table';
import { RecordForm } from '../record-form';
export function Heading({
  eyebrow = 'GESTÃO DE PESSOAS',
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
export function OrgFilters({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const companies = useQuery({
    queryKey: ['filter-companies'],
    queryFn: () => api<Row[]>('/catalogs/companies?limit=100'),
  });
  const branches = useQuery({
    queryKey: ['filter-branches', value.companyId],
    queryFn: () =>
      api<Row[]>(
        `/catalogs/branches?limit=100${value.companyId ? `&companyId=${value.companyId}` : ''}`,
      ),
  });
  return (
    <>
      <select
        aria-label="Empresa"
        value={value.companyId ?? ''}
        onChange={(e) => onChange({ ...value, companyId: e.target.value, branchId: '' })}
      >
        <option value="">Todas as empresas autorizadas</option>
        {companies.data?.data.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Filial"
        value={value.branchId ?? ''}
        onChange={(e) => onChange({ ...value, branchId: e.target.value })}
      >
        <option value="">Todas as filiais autorizadas</option>
        {branches.data?.data.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </>
  );
}
export const queryString = (values: Record<string, unknown>) =>
  new URLSearchParams(
    Object.entries(values)
      .filter(([, v]) => v !== '' && v !== undefined && v !== null)
      .map(([k, v]) => [k, String(v)]),
  ).toString();
interface Summary {
  active: number;
  admitted: number;
  terminated: number;
  balance: number;
  turnover: { rate: number };
  onVacation: number;
  away: number;
  overdueDocs: number | null;
  overdueHealth: number | null;
  alerts: number;
  branches: { name: string; count: number }[];
  departments: { name: string; count: number }[];
}
export function Dashboard({ actor }: { actor: Actor }) {
  const router = useRouter(),
    [filters, setFilters] = useState<Record<string, string>>({});
  const q = useQuery({
    queryKey: ['dashboard', filters],
    queryFn: () => api<Summary>(`/dashboard/summary?${queryString(filters)}`),
  });
  const d = q.data?.data;
  return (
    <>
      <Heading
        title="Visão geral de RH"
        description="Acompanhe o quadro de pessoas e as prioridades da operação."
      />
      <div className="filter-bar">
        <SlidersHorizontal size={16} />
        <OrgFilters value={filters} onChange={setFilters} />
        <label>
          De{' '}
          <input
            type="date"
            value={filters.from ?? ''}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          />
        </label>
        <label>
          Até{' '}
          <input
            type="date"
            value={filters.to ?? ''}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          />
        </label>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} retry={() => void q.refetch()} />
      ) : (
        d && (
          <>
            <div className="metrics">
              {[
                {
                  label: 'Funcionários ativos',
                  value: d.active,
                  icon: Users,
                  path: '/employees?status=ACTIVE',
                  note: 'Quadro atual',
                  tone: 'navy',
                },
                {
                  label: 'Admissões no período',
                  value: d.admitted,
                  icon: UserPlus,
                  path: `/employees?${queryString({ from: filters.from ?? new Date().toISOString().slice(0, 7) + '-01', to: filters.to })}`,
                  note: 'Entradas no quadro',
                  tone: 'green',
                },
                {
                  label: 'Desligamentos no período',
                  value: d.terminated,
                  icon: UserMinus,
                  path: '/terminations',
                  note: 'Saídas registradas',
                  tone: 'red',
                },
                {
                  label: 'Turnover do período',
                  value: `${d.turnover.rate.toFixed(2)}%`,
                  icon: ArrowUpRight,
                  path: '/reports/turnover',
                  note: 'Média de abertura e fechamento',
                  tone: 'blue',
                },
              ].map((m) => (
                <button
                  className={`metric ${m.tone}`}
                  key={m.label}
                  onClick={() => router.push(m.path)}
                >
                  <div>
                    <span>{m.label}</span>
                    <m.icon size={18} />
                  </div>
                  <strong>{m.value}</strong>
                  <small>
                    {m.note}
                    <ChevronArrow />
                  </small>
                </button>
              ))}
            </div>
            <div className="dashboard-grid">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Distribuição do quadro</h2>
                    <p>Funcionários ativos por filial</p>
                  </div>
                  <span className="badge">Por filial</span>
                </div>
                {d.branches.length ? (
                  <div className="chart">
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart
                        data={d.branches}
                        margin={{ top: 15, right: 25, left: -15, bottom: 15 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          vertical={false}
                          stroke="var(--border)"
                        />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar
                          dataKey="count"
                          name="Funcionários"
                          fill="#315f88"
                          radius={[3, 3, 0, 0]}
                          maxBarSize={55}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="empty">
                    <BuildingIcon />
                    <strong>Quadro ainda não cadastrado</strong>
                    <span>
                      Os indicadores serão calculados a partir dos funcionários registrados.
                    </span>
                  </div>
                )}
              </section>
              <section className="panel priorities">
                <div className="panel-heading">
                  <div>
                    <h2>Central de atenção</h2>
                    <p>Pendências que exigem acompanhamento</p>
                  </div>
                  <Bell size={18} />
                </div>
                {[
                  { label: 'Alertas em aberto', value: d.alerts, path: '/alerts', tone: 'red' },
                  {
                    label: 'Saúde ocupacional vencida',
                    value: d.overdueHealth,
                    path: '/health',
                    tone: 'amber',
                  },
                  {
                    label: 'Documentos vencidos',
                    value: d.overdueDocs,
                    path: '/documents',
                    tone: 'amber',
                  },
                  { label: 'Funcionários afastados', value: d.away, path: '/leaves', tone: 'blue' },
                ]
                  .filter((i) => i.value !== null)
                  .map((i) => (
                    <button
                      className="priority-row"
                      key={i.label}
                      onClick={() => router.push(i.path)}
                    >
                      <span className={`priority-indicator ${i.tone}`} />
                      <span>{i.label}</span>
                      <strong>{i.value}</strong>
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
              </section>
            </div>
            <div className="dashboard-grid">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Funcionários por departamento</h2>
                    <p>Distribuição organizacional atual</p>
                  </div>
                </div>
                <div className="department-list">
                  {d.departments.length ? (
                    d.departments.map((dept) => (
                      <div key={dept.name}>
                        <span>{dept.name}</span>
                        <div className="bar-track">
                          <div
                            style={{
                              width: `${Math.max(2, (dept.count / Math.max(1, d.active)) * 100)}%`,
                            }}
                          />
                        </div>
                        <strong>{dept.count}</strong>
                      </div>
                    ))
                  ) : (
                    <p className="muted">Nenhum funcionário cadastrado.</p>
                  )}
                </div>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Rotinas de RH</h2>
                    <p>Acesso às operações do dia a dia</p>
                  </div>
                </div>
                <div className="quick-actions">
                  {actor.permissions.includes('employees.create') && (
                    <button onClick={() => router.push('/employees?new=1')}>
                      <UserPlus size={20} />
                      <span>
                        <strong>Cadastrar funcionário</strong>
                        <small>Ficha pessoal e profissional</small>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                  )}
                  {actor.permissions.includes('vacations.view') && (
                    <button onClick={() => router.push('/vacations')}>
                      <CalendarDays size={20} />
                      <span>
                        <strong>Programar férias</strong>
                        <small>{d.onVacation} funcionários em férias</small>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                  )}
                  {actor.permissions.includes('reports.view') && (
                    <button onClick={() => router.push('/reports/employees')}>
                      <Download size={20} />
                      <span>
                        <strong>Emitir relatório</strong>
                        <small>Consultas e exportações gerenciais</small>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                  )}
                </div>
              </section>
            </div>
          </>
        )
      )}
    </>
  );
}
function ChevronArrow() {
  return <ArrowUpRight size={13} />;
}
function BuildingIcon() {
  return <Users size={30} />;
}
export function Registry({
  module,
  actor,
  title,
  description,
  employeeId,
}: {
  module: string;
  actor: Actor;
  title?: string;
  description?: string;
  employeeId?: string;
}) {
  const router = useRouter(),
    client = useQueryClient(),
    [page, setPage] = useState(1),
    [limit, setLimit] = useState(20),
    [search, setSearch] = useState(''),
    [debounced, setDebounced] = useState(''),
    [filters, setFilters] = useState<Record<string, string>>({}),
    [sort, setSort] = useState({ sort: 'name', direction: 'asc' }),
    [edit, setEdit] = useState<Row | true | null>(null),
    [remove, setRemove] = useState<Row | null>(null),
    [upload, setUpload] = useState<Row | null>(null);
  const employee = module === 'employees';
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setSearch(params.get('search') ?? '');
    if (params.get('status')) setFilters({ status: params.get('status')! });
    if (params.get('new')) setEdit(true);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);
  const catalogs = useQuery({ queryKey: ['catalogs'], queryFn: () => api<Catalog[]>('/catalogs') });
  const employeeFields = useQuery({
    queryKey: ['employee-fields'],
    enabled: employee,
    queryFn: () => api<Field[]>('/employees/fields'),
  });
  const catalog = catalogs.data?.data.find((c) => c.key === module);
  const fields = employee ? employeeFields.data?.data : catalog?.fields;
  const endpoint = employee ? '/employees' : `/catalogs/${module}`;
  const query = queryString({ page, limit, search: debounced, employeeId, ...filters, ...sort });
  const q = useQuery({
    queryKey: ['registry', module, query],
    enabled: employee || !!catalog,
    queryFn: () => api<Row[]>(`${endpoint}?${query}`),
  });
  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: ['registry'] });
    await client.invalidateQueries({ queryKey: ['options'] });
  };
  const columns = employee
    ? [
        { key: 'registration', label: 'Matrícula' },
        { key: 'name', label: 'Funcionário' },
        { key: 'company', label: 'Empresa' },
        { key: 'branch', label: 'Filial' },
        { key: 'department', label: 'Departamento' },
        { key: 'jobPosition', label: 'Cargo' },
        { key: 'admissionDate', label: 'Admissão' },
        { key: 'status', label: 'Situação' },
      ]
    : [
        { key: 'employee', label: 'Funcionário' },
        ...(fields ?? [])
          .filter(
            (f) =>
              ![
                'employeeId',
                'notes',
                'description',
                'restrictions',
                'cid',
                'responsibilities',
                'requirements',
              ].includes(f.key),
          )
          .slice(0, 7)
          .map((f) => ({ key: f.reference&&f.key!=='employeeId'?f.key.replace(/Id$/,''):f.key, label: f.label })),
      ].filter((c) => c.key !== 'employee' || fields?.some((f) => f.key === 'employeeId'));
  return (
    <>
      <Heading
        title={title ?? (employee ? 'Funcionários' : (catalog?.title ?? 'Cadastro'))}
        description={
          description ??
          (employee
            ? 'Consulte e mantenha os dados pessoais e profissionais do seu quadro.'
            : 'Mantenha os registros organizados e disponíveis para as rotinas de RH.')
        }
      >
        {employee && actor.permissions.includes('reports.export') && (
          <Button
            variant="outline"
            onClick={() =>
              void download(`/reports/employees?${query}&format=xlsx`, 'funcionarios.xlsx').catch(
                (e) => toast.error(e.message),
              )
            }
          >
            <Download size={16} />
            Exportar
          </Button>
        )}
        {actor.permissions.includes(`${module}.create`) && (
          <Button onClick={() => setEdit(true)}>
            <Plus size={17} /> {employee ? 'Novo funcionário' : 'Novo registro'}
          </Button>
        )}
      </Heading>
      <div className="filter-bar">
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Pesquisar registros"
            placeholder={employee ? 'Nome, CPF ou matrícula' : 'Pesquisar registros'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {!employeeId && (
          <OrgFilters
            value={filters}
            onChange={(v) => {
              setFilters(v);
              setPage(1);
            }}
          />
        )}
        {employee && (
          <select
            aria-label="Situação"
            value={filters.status ?? ''}
            onChange={(e) => {
              setFilters({ ...filters, status: e.target.value });
              setPage(1);
            }}
          >
            <option value="">Todas as situações</option>
            {Object.entries({
              ACTIVE: 'Ativo',
              PROBATION: 'Em experiência',
              ON_VACATION: 'Em férias',
              ON_LEAVE: 'Afastado',
              TERMINATED: 'Desligado',
              INACTIVE: 'Inativo',
            }).map(([v, l]) => (
              <option value={v} key={v}>
                {l}
              </option>
            ))}
          </select>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            setSearch('');
            setFilters({});
            setPage(1);
          }}
        >
          Limpar
        </Button>
      </div>
      {q.isLoading || catalogs.isLoading ? (
        <Loading />
      ) : catalogs.error ? (
        <ErrorBox error={catalogs.error} retry={() => void catalogs.refetch()} />
      ) : employee && employeeFields.error ? (
        <ErrorBox error={employeeFields.error} retry={() => void employeeFields.refetch()} />
      ) : q.error ? (
        <ErrorBox error={q.error} retry={() => void q.refetch()} />
      ) : !employee && !catalog ? (
        <ErrorBox error={new Error('Este cadastro não está disponível para o seu perfil.')} />
      ) : (
        <DataTable
          preferenceKey={`${actor.id}:registry:${module}`}
          bulkActions={actor.permissions.includes(`${module}.delete`)?selected=>selected.length>0?<Button variant="outline" onClick={async()=>{if(!window.confirm(`Desativar ${selected.length} registros selecionados?`))return;let success=0;const failures:string[]=[];for(const row of selected){try{await api(`${endpoint}/${row.id}`,{method:'DELETE'});success++;}catch(error){failures.push(`${row.name??row.id}: ${(error as Error).message}`);}}await invalidate();if(success)toast.success(`${success} registros desativados.`);if(failures.length)toast.error(failures.join('\n'));}}>Desativar selecionados</Button>:null:undefined}
          rows={q.data?.data ?? []}
          columns={columns}
          page={page}
          limit={limit}
          total={q.data?.meta?.total ?? 0}
          onPage={setPage}
          onLimit={(n) => {
            setLimit(n);
            setPage(1);
          }}
          onSort={(sort, direction) => setSort({ sort, direction })}
          actions={(r) => (
            <div className="row-actions">
              {employee && (
                <Button
                  variant="ghost"
                  title="Abrir ficha"
                  onClick={() => router.push(`/employees/${r.id}`)}
                >
                  <Eye size={15} />
                </Button>
              )}
              {actor.permissions.includes(`${module}.update`) && (
                <Button variant="ghost" title="Editar registro" onClick={() => setEdit(r)}>
                  <Pencil size={15} />
                </Button>
              )}
              {['documents', 'health'].includes(module) &&
                actor.permissions.includes('documents.create') && (
                  <Button variant="ghost" title="Enviar arquivo" onClick={() => setUpload(r)}>
                    <Upload size={15} />
                  </Button>
                )}
              {typeof r.fileId === 'string' && (
                <Button
                  variant="ghost"
                  title="Baixar arquivo"
                  onClick={() =>
                    void download(`/files/${r.fileId}`, `${r.name ?? 'documento'}.pdf`).catch((e) =>
                      toast.error(e.message),
                    )
                  }
                >
                  <Download size={15} />
                </Button>
              )}
              {actor.permissions.includes(`${module}.delete`) && (
                <Button variant="ghost" title="Desativar registro" onClick={() => setRemove(r)}>
                  <Trash2 size={15} />
                </Button>
              )}
            </div>
          )}
        />
      )}
      <Modal
        open={!!edit}
        onOpenChange={(v) => {
          if (!v && window.confirm('Fechar o formulário? Alterações não salvas serão descartadas.'))
            setEdit(null);
        }}
        title={
          edit === true ? (employee ? 'Novo funcionário' : 'Novo registro') : 'Editar registro'
        }
        wide
      >
        {fields && edit && (
          <RecordForm
            fields={fields}
            initial={edit === true ? { employeeId } : edit}
            onCancel={() => setEdit(null)}
            onSave={async (data) => {
              await api(
                `${endpoint}${edit === true ? '' : `/${edit.id}`}`,
                send(edit === true ? 'POST' : 'PATCH', data),
              );
              setEdit(null);
              toast.success('Registro salvo.');
              await invalidate();
            }}
          />
        )}
      </Modal>
      <Modal
        open={!!remove}
        onOpenChange={() => setRemove(null)}
        title="Desativar registro"
        description="O registro sairá das consultas operacionais. O histórico será preservado."
      >
        <div className="confirm-body">
          <p>
            Confirma a desativação de <strong>{remove?.name ?? 'este registro'}</strong>?
          </p>
          <Button variant="outline" onClick={() => setRemove(null)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await api(`${endpoint}/${remove?.id}`, { method: 'DELETE' });
                setRemove(null);
                await invalidate();
                toast.success('Registro desativado.');
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            Confirmar desativação
          </Button>
        </div>
      </Modal>
      <Modal
        open={!!upload}
        onOpenChange={() => setUpload(null)}
        title="Anexar documento"
        description="Arquivos PDF, JPEG ou PNG, de até 10 MB."
      >
        <div className="confirm-body">
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file || !upload) return;
              try {
                const form = new FormData();
                form.append('file', file);
                const result = await api<{ id: string }>(
                  `/files/${String(upload.employeeId)}/${module === 'health' ? 'HEALTH' : 'DOCUMENT'}`,
                  { method: 'POST', body: form },
                );
                const body = Object.fromEntries(
                  (fields ?? [])
                    .map((f) => [f.key, upload[f.key]])
                    .filter(([, v]) => v != null)
                    .map(([k, v]) => [
                      k,
                      typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 10) : v,
                    ]),
                );
                await api(
                  `${endpoint}/${upload.id}`,
                  send('PATCH', { ...body, fileId: result.data.id }),
                );
                setUpload(null);
                await invalidate();
                toast.success('Documento anexado.');
              } catch (err) {
                toast.error((err as Error).message);
              }
            }}
          />
        </div>
      </Modal>
    </>
  );
}
