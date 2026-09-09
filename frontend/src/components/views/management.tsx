'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bell, Download, Plus, Printer, ShieldCheck } from 'lucide-react';
import { Actor, api, display, download, Environment, Row, send } from '@/lib/api';
import { Button, ErrorBox, Loading, Modal } from '../ui';
import { DataTable } from '../data-table';
import { RecordForm } from '../record-form';
import { Heading, OrgFilters, queryString } from './registry';
import { AssetUpload,SecurePhoto } from '../assets';
const reportNames: Record<string, string> = {
  employees: 'Quadro de funcionários',
  salaries: 'Cargos e salários',
  vacations: 'Relatório de férias',
  movements: 'Histórico de movimentações',
  turnover: 'Turnover',
  health: 'Saúde ocupacional',
  documents: 'Documentos',
  birthdays: 'Aniversariantes',
};
const labels: Record<string, string> = {
  name: 'Funcionário',
  registration: 'Matrícula',
  company: 'Empresa',
  branch: 'Filial',
  department: 'Departamento',
  position: 'Cargo',
  admissionDate: 'Admissão',
  status: 'Situação',
  cpf: 'CPF',
  salary: 'Salário',
  benefits: 'Benefícios',
  allowances: 'Adicionais',
  total: 'Total estimado',
  startDate: 'Início',
  endDate: 'Fim',
  deadline: 'Limite concessivo',
  acquired: 'Adquiridos',
  used: 'Utilizados',
  programmed: 'Programados',
  sold: 'Vendidos',
  balance: 'Saldo',
  month: 'Mês',
  admissions: 'Admissões',
  terminations: 'Desligamentos',
  opening: 'Quadro inicial',
  closing: 'Quadro final',
  rate: 'Turnover (%)',
  terminationRate: 'Turnover de saída (%)',
  average: 'Quadro médio',
  birthDate: 'Nascimento',
  type: 'Tipo',
  expiresAt: 'Validade',
  examDate: 'Exame',
  result: 'Resultado',
  effectiveDate: 'Data efetiva',
  reason: 'Motivo',
};
export function ReportsView({ kind, actor }: { kind: string; actor: Actor }) {
  const [filters, setFilters] = useState<Record<string, string>>({}),
    [page, setPage] = useState(1);
  const [visibleColumns,setVisibleColumns]=useState<string[]>([]);
  const query = queryString({ ...filters, page });
  const q = useQuery({
    queryKey: ['report', kind, query],
    queryFn: () => api<Record<string, unknown>[]>(`/reports/${kind}?${query}`),
  });
  return (
    <>
      <Heading
        eyebrow="RELATÓRIOS GERENCIAIS"
        title={reportNames[kind] ?? 'Relatório'}
        description="Os resultados e as exportações respeitam os filtros e as permissões do seu perfil."
      >
        <Button variant="outline" onClick={() => window.print()}>
          <Printer size={15} />
          Imprimir
        </Button>
        {actor.permissions.includes('reports.export') &&
          ['csv', 'xlsx', 'pdf'].map((format) => (
            <Button
              key={format}
              variant="outline"
              onClick={() =>
                void download(
                  `/reports/${kind}?${query}&format=${format}&columns=${encodeURIComponent(visibleColumns.join(','))}`,
                  `geo-${kind}.${format}`,
                ).catch((e) => toast.error(e.message))
              }
            >
              <Download size={15} />
              {format.toUpperCase()}
            </Button>
          ))}
      </Heading>
      <div className="filter-bar">
        <OrgFilters
          value={filters}
          onChange={(v) => {
            setFilters(v);
            setPage(1);
          }}
        />
        <label>
          De
          <input
            type="date"
            value={filters.from ?? ''}
            onChange={(e) => {
              setFilters({ ...filters, from: e.target.value });
              setPage(1);
            }}
          />
        </label>
        <label>
          Até
          <input
            type="date"
            value={filters.to ?? ''}
            onChange={(e) => {
              setFilters({ ...filters, to: e.target.value });
              setPage(1);
            }}
          />
        </label>
        <Button variant="ghost" onClick={() => setFilters({})}>
          Limpar
        </Button>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <DataTable
          preferenceKey={`${actor.id}:report:${kind}`}
          onVisibleColumns={setVisibleColumns}
          rows={q.data?.data.map((r, i) => ({ ...r, id: String(i) })) ?? []}
          columns={Object.keys(q.data?.data[0] ?? {}).map((key) => ({
            key,
            label: labels[key] ?? key,
          }))}
          page={page}
          onPage={setPage}
          total={q.data?.meta?.total ?? 0}
          onSort={(sort,direction)=>setFilters({...filters,sort,direction})}
        />
      )}
    </>
  );
}
export function AlertsView({ actor }: { actor: Actor }) {
  const client = useQueryClient(),
    [status, setStatus] = useState('ABERTO'),
    [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['alerts', status, page],
    queryFn: () => api<Row[]>(`/alerts?status=${status}&page=${page}`),
  });
  return (
    <>
      <Heading
        title="Central de alertas"
        description="Acompanhe vencimentos e registre o tratamento das pendências."
      />
      <div className="filter-bar">
        <Bell size={17} />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="Situação dos alertas"
        >
          {['ABERTO', 'RESOLVIDO', 'IGNORADO', 'ADIADO'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <DataTable
          rows={q.data?.data ?? []}
          columns={[
            { key: 'title', label: 'Alerta' },
            { key: 'employee', label: 'Funcionário' },
            { key: 'category', label: 'Categoria' },
            { key: 'priority', label: 'Prioridade' },
            { key: 'dueDate', label: 'Prazo' },
            { key: 'status', label: 'Situação' },
          ]}
          page={page}
          onPage={setPage}
          total={q.data?.meta?.total ?? 0}
          actions={(r) =>
            actor.permissions.includes('alerts.update') ? (
              <div className="row-actions">
                {[
                  ['read', 'Lido'],
                  ['resolve', 'Resolver'],
                  ['ignore', 'Ignorar'],
                  ['snooze', 'Adiar 7 dias'],
                ].map(([action, label]) => (
                  <Button
                    key={action}
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await api(`/alerts/${r.id}/${action}`, send('PATCH', {}));
                        await client.invalidateQueries({ queryKey: ['alerts'] });
                        toast.success('Alerta atualizado.');
                      } catch (e) {
                        toast.error((e as Error).message);
                      }
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            ) : null
          }
        />
      )}
    </>
  );
}
export function AdminView({ kind, actor }: { kind: string; actor: Actor }) {
  const client = useQueryClient(),
    [create, setCreate] = useState(false),
    [edit, setEdit] = useState<Row | null>(null),
    [page, setPage] = useState(1),
    [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['admin', kind, page, search],
    queryFn: () => api<Row[]>(`/admin/${kind}?page=${page}&search=${encodeURIComponent(search)}`),
  });
  const roles = useQuery({
    queryKey: ['roles'],
    enabled: kind === 'users',
    queryFn: () => api<Row[]>('/admin/roles'),
  });
  const environments = useQuery({
    queryKey: ['environments'],
    enabled: kind === 'users',
    queryFn: () => api<Environment[]>('/admin/environments'),
  });
  const companies = useQuery({
    queryKey: ['admin-companies'],
    enabled: kind === 'users',
    queryFn: () => api<Row[]>('/catalogs/companies?limit=100'),
  });
  const branches = useQuery({
    queryKey: ['admin-branches'],
    enabled: kind === 'users',
    queryFn: () => api<Row[]>('/catalogs/branches?limit=100'),
  });
  const permissions = useQuery({
    queryKey: ['permissions'],
    enabled: kind === 'roles' && actor.permissions.includes('roles.view'),
    queryFn: () => api<Row[]>('/admin/permissions'),
  });
  const title = kind === 'users' ? 'Usuários' : kind === 'roles' ? 'Perfis de acesso' : 'Auditoria';
  const refresh = () => client.invalidateQueries({ queryKey: ['admin'] });
  return (
    <>
      <Heading
        eyebrow="ADMINISTRAÇÃO"
        title={title}
        description={
          kind === 'audit-logs'
            ? 'Trilha de operações e acessos. Registros não podem ser alterados por esta interface.'
            : 'Gerencie o acesso aos módulos e a abrangência organizacional dos usuários.'
        }
      >
        {kind !== 'audit-logs' && actor.permissions.includes(`${kind}.create`) && (
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            Novo {kind === 'users' ? 'usuário' : 'perfil'}
          </Button>
        )}
      </Heading>
      {kind === 'users' && (
        <div className="filter-bar">
          <input
            placeholder="Pesquisar por nome"
            aria-label="Nome do usuário"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <DataTable
          rows={q.data?.data ?? []}
          columns={
            kind === 'users'
              ? [
                  { key: 'name', label: 'Nome' },
                  { key: 'email', label: 'E-mail' },
                  { key: 'isActive', label: 'Ativo' },
                  { key: 'lastLoginAt', label: 'Último acesso' },
                ]
              : kind === 'roles'
                ? [
                    { key: 'name', label: 'Perfil' },
                    { key: 'permissions', label: 'Permissões concedidas' },
                  ]
                : [
                    { key: 'createdAt', label: 'Data e hora' },
                    { key: 'userId', label: 'Usuário' },
                    { key: 'action', label: 'Ação' },
                    { key: 'module', label: 'Módulo' },
                    { key: 'recordId', label: 'Registro' },
                    { key: 'ip', label: 'IP' },
                    { key: 'reason', label: 'Motivo' },
                  ]
          }
          page={page}
          onPage={setPage}
          total={q.data?.meta?.total ?? q.data?.data.length ?? 0}
          actions={
            kind === 'users' && actor.permissions.includes('users.update')
              ? (r) => (
                  <Button variant="outline" onClick={() => setEdit(r)}>
                    Gerenciar acesso
                  </Button>
                )
              : undefined
          }
        />
      )}
      <Modal
        open={create || !!edit}
        onOpenChange={() => {
          setCreate(false);
          setEdit(null);
        }}
        title={kind === 'users' ? (edit ? 'Editar acesso' : 'Novo usuário') : 'Novo perfil'}
        wide
      >
        {kind === 'users' ? (
          <UserForm
            initial={edit}
            roles={roles.data?.data ?? []}
            environments={environments.data?.data ?? []}
            companies={companies.data?.data ?? []}
            branches={branches.data?.data ?? []}
            save={async (data) => {
              await api(
                `/admin/users${edit ? `/${edit.id}` : ''}`,
                send(edit ? 'PATCH' : 'POST', data),
              );
              setCreate(false);
              setEdit(null);
              await refresh();
              toast.success('Acesso salvo.');
            }}
          />
        ) : (
          <RoleForm
            permissions={permissions.data?.data ?? []}
            save={async (data) => {
              await api('/admin/roles', send('POST', data));
              setCreate(false);
              await refresh();
              toast.success('Perfil criado.');
            }}
          />
        )}
      </Modal>
    </>
  );
}
function UserForm({
  initial,
  roles,
  environments,
  companies,
  branches,
  save,
}: {
  initial: Row | null;
  roles: Row[];
  environments: Environment[];
  companies: Row[];
  branches: Row[];
  save: (data: unknown) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="record-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setBusy(true);
        try {
          await save({
            name: String(data.get('name')),
            email: String(data.get('email')),
            ...(!initial ? { password: String(data.get('password')) } : {}),
            roleIds: data.getAll('roleIds'),
            environmentRoles: environments.map((environment) => ({
              environmentId: environment.id,
              roleIds: data.getAll(`environmentRole_${environment.id}`),
            })).filter((environment) => environment.roleIds.length > 0),
            companyIds: data.getAll('companyIds'),
            branchIds: data.getAll('branchIds'),
            allCompanies: data.has('allCompanies'),
            isActive: data.has('isActive'),
          });
        } catch (err) {
          toast.error((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-grid">
        <label>
          Nome
          <input required name="name" defaultValue={initial?.name} />
        </label>
        <label>
          E-mail
          <input required type="email" name="email" defaultValue={String(initial?.email ?? '')} />
        </label>
        {!initial && (
          <label>
            Senha temporária
            <input required type="password" name="password" minLength={10} />
          </label>
        )}
        <label className="checkbox-label">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={initial ? Boolean(initial.isActive) : true}
          />
          Usuário ativo
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            name="allCompanies"
            defaultChecked={Boolean(initial?.allCompanies)}
          />
          Acesso a todas as empresas
        </label>
      </div>
      <h3>Perfis</h3>
      <div className="permissions-grid">
        {roles.map((r) => (
          <label key={r.id}>
            <input
              type="checkbox"
              name="roleIds"
              value={r.id}
              defaultChecked={(initial?.roles as { roleId: string }[] | undefined)?.some(
                (x) => x.roleId === r.id,
              )}
            />
            {r.name}
          </label>
        ))}
      </div>
      <h3>Acessos por ambiente</h3>
      {environments.map((environment) => (
        <div key={environment.id} className="environment-access-row">
          <strong>{environment.name}</strong>
          <div className="permissions-grid">
            {roles.map((role) => (
              <label key={`${environment.id}-${role.id}`}>
                <input
                  type="checkbox"
                  name={`environmentRole_${environment.id}`}
                  value={String(role.id)}
                  defaultChecked={(
                    initial?.environmentRoles as { environmentId: string; role: { id: string } }[] | undefined
                  )?.some((item) => item.environmentId === environment.id && item.role.id === role.id)}
                />
                {role.name}
              </label>
            ))}
          </div>
        </div>
      ))}
      <h3>Empresas autorizadas</h3>
      <div className="permissions-grid">
        {companies.map((r) => (
          <label key={r.id}>
            <input
              type="checkbox"
              name="companyIds"
              value={r.id}
              defaultChecked={(initial?.companies as { companyId: string }[] | undefined)?.some(
                (x) => x.companyId === r.id,
              )}
            />
            {r.name}
          </label>
        ))}
      </div>
      <h3>Filiais autorizadas</h3>
      <div className="permissions-grid">
        {branches.map((r) => (
          <label key={r.id}>
            <input
              type="checkbox"
              name="branchIds"
              value={r.id}
              defaultChecked={(initial?.branches as { branchId: string }[] | undefined)?.some(
                (x) => x.branchId === r.id,
              )}
            />
            {r.name}
          </label>
        ))}
      </div>
      <div className="form-footer">
        <Button disabled={busy}>{busy ? 'Salvando…' : 'Salvar acesso'}</Button>
      </div>
    </form>
  );
}
function RoleForm({
  permissions,
  save,
}: {
  permissions: Row[];
  save: (data: unknown) => Promise<void>;
}) {
  return (
    <form
      className="record-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        try {
          await save({ name: data.get('name'), permissions: data.getAll('permissions') });
        } catch (err) {
          toast.error((err as Error).message);
        }
      }}
    >
      <label>
        Nome do perfil
        <input required name="name" />
      </label>
      <h3>Permissões</h3>
      <div className="permissions-grid">
        {permissions.map((p) => (
          <label key={p.id}>
            <input type="checkbox" name="permissions" value={String(p.code)} />
            {String(p.code)}
          </label>
        ))}
      </div>
      <div className="form-footer">
        <Button>Salvar perfil</Button>
      </div>
    </form>
  );
}
export function SettingsView() {
  const client = useQueryClient(),
    [tab, setTab] = useState('general');
  const q = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<Record<string, Record<string, unknown>>>('/admin/settings'),
  });
  const settings = q.data?.data;
  return (
    <>
      <Heading
        title="Configurações gerais"
        description="Parâmetros de identificação, férias e antecedência dos alertas."
      />
      <div className="tabs">
        {[
          ['general', 'Identidade do sistema'],
          ['vacations', 'Regras de férias'],
          ['alerts', 'Alertas'],
          ['security','Segurança'],
        ].map(([key, label]) => (
          <button key={key} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        settings && (
          <section className="panel detail-panel">
            {tab==='general'&&<div className="form-grid"><AssetUpload category="LOGO" label="Logotipo (PNG ou JPEG)" onSaved={()=>{void client.invalidateQueries({queryKey:['settings']});void client.invalidateQueries({queryKey:['branding']});}}/><AssetUpload category="FAVICON" label="Ícone do sistema (PNG)" onSaved={()=>{void client.invalidateQueries({queryKey:['settings']});void client.invalidateQueries({queryKey:['branding']});}}/></div>}
            <RecordForm
              key={tab}
              fields={
                tab==='security'?[{key:'sessionMinutes',label:'Inatividade máxima (minutos)',type:'number',required:true},{key:'refreshDays',label:'Validade máxima da sessão (dias)',type:'number',required:true},{key:'maxAttempts',label:'Tentativas inválidas antes do bloqueio',type:'number',required:true},{key:'lockMinutes',label:'Duração do bloqueio (minutos)',type:'number',required:true},{key:'passwordExpiryDays',label:'Validade da senha (dias; 0 desativa)',type:'number',required:true},{key:'minPasswordLength',label:'Comprimento mínimo da senha',type:'number',required:true}]:tab === 'general'
                  ? [
                      { key: 'name', label: 'Nome do sistema', required: true },
                      { key: 'primaryColor', label: 'Cor principal (#RRGGBB)', required: true },
                    ]
                  : tab === 'vacations'
                    ? [
                        {
                          key: 'defaultDays',
                          label: 'Dias por período',
                          type: 'number',
                          required: true,
                        },
                        {
                          key: 'maxInstallments',
                          label: 'Máximo de parcelas',
                          type: 'number',
                          required: true,
                        },
                        {
                          key: 'minDays',
                          label: 'Mínimo de dias por parcela',
                          type: 'number',
                          required: true,
                        },
                        {
                          key: 'minLongPeriod',
                          label: 'Mínimo de dias na parcela longa',
                          type: 'number',
                          required: true,
                        },
                        {
                          key: 'maxSoldDays',
                          label: 'Limite de venda de dias',
                          type: 'number',
                          required: true,
                        },
                        {
                          key: 'managerApproval',
                          label: 'Exigir aprovação do gestor antes do RH',
                          type: 'checkbox',
                        },
                      ]
                    : [
                        {
                          key: 'days',
                          label: 'Antecedência em dias, separados por vírgula',
                          required: true,
                        },
                      ]
              }
              initial={
                tab === 'alerts'
                  ? { days: (settings.alerts.days as number[]).join(', ') }
                  : settings[tab]
              }
              onCancel={() => {}}
              onSave={async (data) => {
                const value =
                  tab === 'general'
                    ? { ...settings.general, ...data }
                    : tab === 'alerts'
                      ? {
                          days: String(data.days)
                            .split(',')
                            .map((s) => Number(s.trim())),
                        }
                      : Object.fromEntries(
                          Object.entries(data).map(([key, value]) => [
                            key,
                            key === 'managerApproval' ? value : Number(value),
                          ]),
                        );
                await api(`/admin/settings/${tab}`, send('PATCH', value));
                await client.invalidateQueries({ queryKey: ['settings'] });
                await client.invalidateQueries({ queryKey: ['branding'] });
                toast.success('Configurações salvas.');
              }}
            />
          </section>
        )
      )}
    </>
  );
}
export function ProfileView({ actor, refresh }: { actor: Actor; refresh: () => Promise<void> }) {
  const client = useQueryClient();
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<Row[]>('/auth/sessions'),
  });
  return (
    <>
      <Heading title="Meu perfil" description="Dados da conta, senha e sessões autenticadas." />
      <div className="dashboard-grid">
        <section className="panel detail-panel">
          <h2>Dados da conta</h2>
          <SecurePhoto id={actor.photoId} alt={actor.name} className="employee-avatar"/>
          <AssetUpload category="USER_PHOTO" label="Foto do perfil" onSaved={()=>void refresh()}/>
          <RecordForm
            fields={[
              { key: 'name', label: 'Nome', required: true },
              {
                key: 'theme',
                label: 'Tema',
                type: 'select',
                required: true,
                options: ['light', 'dark'],
              },
            ]}
            initial={{ name: actor.name, theme: actor.theme }}
            onCancel={() => {}}
            onSave={async (data) => {
              await api('/auth/profile', send('POST', data));
              await refresh();
              toast.success('Perfil atualizado.');
            }}
          />
        </section>
        <section className="panel detail-panel">
          <h2>Alterar senha</h2>
          <form
            className="record-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const d = new FormData(form);
              try {
                await api(
                  '/auth/change-password',
                  send('POST', {
                    currentPassword: d.get('currentPassword'),
                    newPassword: d.get('newPassword'),
                  }),
                );
                form.reset();
                toast.success('Senha alterada.');
              } catch (err) {
                toast.error((err as Error).message);
              }
            }}
          >
            <label>
              Senha atual
              <input name="currentPassword" type="password" required />
            </label>
            <label>
              Nova senha
              <input name="newPassword" type="password" required minLength={10} />
            </label>
            <div className="form-footer">
              <Button>
                <ShieldCheck size={15} />
                Alterar senha
              </Button>
            </div>
          </form>
        </section>
      </div>
      <section className="panel detail-panel">
        <h2>Sessões ativas</h2>
        {sessions.isLoading ? (
          <Loading />
        ) : sessions.error ? (
          <ErrorBox error={sessions.error} />
        ) : (
          <DataTable
            rows={sessions.data?.data ?? []}
            columns={[
              { key: 'ip', label: 'IP' },
              { key: 'userAgent', label: 'Dispositivo' },
              { key: 'createdAt', label: 'Início' },
              { key: 'expiresAt', label: 'Expiração' },
            ]}
            actions={(r) =>
              r.id !== actor.sessionId ? (
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await api('/auth/sessions/revoke', send('POST', { id: r.id }));
                      await client.invalidateQueries({ queryKey: ['sessions'] });
                      toast.success('Sessão encerrada.');
                    } catch (err) {
                      toast.error((err as Error).message);
                    }
                  }}
                >
                  Revogar
                </Button>
              ) : (
                <span className="badge">Sessão atual</span>
              )
            }
          />
        )}
      </section>
    </>
  );
}
