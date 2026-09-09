'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from '@/lib/navigation';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { Toaster, toast } from 'sonner';
import {
  LayoutDashboard,
  Users,
  ArrowLeftRight,
  CalendarDays,
  HeartPulse,
  Files,
  Building2,
  ChartNoAxesCombined,
  Bell,
  ShieldCheck,
  Settings2,
  Menu,
  ChevronRight,
  ChevronDown,
  LogOut,
  Sun,
  Moon,
  Search,
  CircleUserRound,
  LockKeyhole,
} from 'lucide-react';
import { Actor, api, Environment, send, setToken } from '@/lib/api';
import { Button, Loading } from './ui';
import {
  Dashboard,
  Registry,
  EmployeeDetail,
  VacationView,
  WorkflowView,
  ReportsView,
  AlertsView,
  AdminView,
  SettingsView,
  ProfileView,
  LeavesView,
} from './views';

import { ImportView } from './views/imports';
const groups = [
  {
    label: 'Dashboard',
    icon: LayoutDashboard,
    path: '/',
    permission: 'employees.view',
    children: [],
  },
  {
    label: 'Funcionários',
    icon: Users,
    path: '/employees',
    permission: 'employees.view',
    children: [
      ['Lista de funcionários', '/employees'],
      ['Contatos de emergência', '/contacts'],
      ['Dependentes', '/dependents'],
      ['Benefícios', '/benefits'],
      ['Adicionais', '/allowances'],
    ],
  },
  {
    label: 'Movimentações',
    icon: ArrowLeftRight,
    path: '/admissions',
    permission: 'movements.view',
    children: [
      ['Admissões', '/admissions'],
      ['Desligamentos', '/terminations'],
      ['Contratos de experiência', '/experience'],
      ['Transferências e promoções', '/movements'],
      ['Afastamentos', '/leaves'],
    ],
  },
  {
    label: 'Férias',
    icon: CalendarDays,
    path: '/vacations',
    permission: 'vacations.view',
    children: [
      ['Programação e solicitações', '/vacations'],
      ['Calendário de férias', '/vacations/calendar'],
      ['Períodos aquisitivos', '/reports/vacations'],
    ],
  },
  {
    label: 'Saúde ocupacional',
    icon: HeartPulse,
    path: '/health',
    permission: 'health.view_sensitive',
    children: [
      ['ASO, exames e atestados', '/health'],
      ['Afastamentos médicos', '/leaves'],
    ],
  },
  {
    label: 'Documentos',
    icon: Files,
    path: '/documents',
    permission: 'employees.view_documents',
    children: [['Arquivos dos funcionários', '/documents']],
  },
  {
    label: 'Estrutura organizacional',
    icon: Building2,
    path: '/companies',
    permission: 'companies.view',
    children: [
      ['Empresas', '/companies'],
      ['Filiais', '/branches'],
      ['Departamentos', '/departments'],
      ['Setores', '/sectors'],
      ['Cargos', '/positions'],
      ['Centros de custo', '/cost-centers'],
      ['Jornadas', '/work-schedules'],
    ],
  },
  {
    label: 'Relatórios',
    icon: ChartNoAxesCombined,
    path: '/reports/employees',
    permission: 'reports.view',
    children: [
      ['Quadro de funcionários', '/reports/employees'],
      ['Cargos e salários', '/reports/salaries'],
      ['Férias', '/reports/vacations'],
      ['Movimentações', '/reports/movements'],
      ['Turnover', '/reports/turnover'],
      ['Saúde ocupacional', '/reports/health'],
      ['Documentos', '/reports/documents'],
      ['Aniversariantes', '/reports/birthdays'],
    ],
  },
  { label: 'Alertas', icon: Bell, path: '/alerts', permission: 'alerts.view', children: [] },
  {
    label: 'Administração',
    icon: ShieldCheck,
    path: '/admin/users',
    permission: 'users.view',
    children: [
      ['Usuários', '/admin/users'],
      ['Perfis e permissões', '/admin/roles'],
      ['Auditoria', '/admin/audit-logs'],
      ['Importar planilhas', '/imports'],
    ],
  },
  {
    label: 'Configurações',
    icon: Settings2,
    path: '/settings',
    permission: 'settings.view',
    children: [],
  },
];
export function App() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false, staleTime: 15000 },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Workspace />
      <Toaster richColors position="bottom-right" />
    </QueryClientProvider>
  );
}
function Workspace() {
  const cache = useQueryClient();
  const router = useRouter(),
    path = usePathname();
  const [actor, setActor] = useState<Actor | null>(null),
    [boot, setBoot] = useState(true),
    [collapsed, setCollapsed] = useState(false),
    [expanded, setExpanded] = useState<string | null>(null),
    [search, setSearch] = useState('');
  const me = async () => {
    const r = await api<Actor>('/auth/me');
    setActor(r.data);
    document.documentElement.dataset.theme = r.data.theme;
  };
  useEffect(() => {
    void me()
      .catch(() => {})
      .finally(() => setBoot(false));
  }, []);
  const settings = useQuery({
    queryKey: ['branding', actor?.id],
    enabled: !!actor && !actor.mustChangePassword,
    queryFn: () => api<{ general: { name: string } }>('/admin/settings'),
  });
  const name = settings.data?.data.general?.name ?? 'GRUPO GEO';
  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setToken(null);
      setActor(null);
      cache.clear();
      router.push('/');
    }
  };
  if (boot)
    return (
      <div className="boot">
        <GeoLogo />
        <Loading />
      </div>
    );
  if (!actor) return <Login onLogin={me} />;
  if (actor.mustChangePassword) return <PasswordChange onDone={me} />;
  if (!actor.environmentId) return <EnvironmentSelection actor={actor} onSelected={me} />;
  if (actor.environmentCode !== 'HR') return <EnvironmentShell actor={actor} onChanged={me} onLogout={logout} />;
  const group = groups.find((g) => g.path === path || g.children.some(([, p]) => p === path));
  const title =
    group?.children.find(([, p]) => p === path)?.[0] ??
    group?.label ??
    (path.startsWith('/employees/') ? 'Ficha do funcionário' : 'Meu perfil');
  const navigate = (p: string) => {
    router.push(p);
    if (window.innerWidth < 900) setCollapsed(true);
  };
  return (
    <div className={`workspace ${collapsed ? 'collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <GeoLogo compact />
        </div>
        <div className="workspace-name">
          <Building2 size={15} />
          <span>Ambiente corporativo</span>
        </div>
        <nav aria-label="Menu principal">
          {groups
            .filter((g) => actor.permissions.includes(g.permission))
            .map((g) => {
              const Icon = g.icon,
                active = g === group;
              return (
                <div key={g.label}>
                  <button
                    title={g.label}
                    className={`nav-item ${active ? 'active' : ''}`}
                    onClick={() => {
                      if (g.children.length) {
                        setExpanded(expanded === g.label ? null : g.label);
                        if (collapsed) setCollapsed(false);
                      } else navigate(g.path);
                    }}
                  >
                    <Icon size={18} />
                    <span>{g.label}</span>
                    {g.children.length > 0 && (
                      <ChevronDown size={13} className={expanded === g.label ? 'rotate' : ''} />
                    )}
                  </button>
                  {g.children.length > 0 && !collapsed && (expanded === g.label || active) && (
                    <div className="submenu">
                      {g.children.map(([label, p]) => (
                        <button
                          key={p}
                          className={path === p ? 'selected' : ''}
                          onClick={() => navigate(p)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
        </nav>
        <div className="sidebar-bottom">
          <span className="online-dot" />
          <span>GRUPOGEO ERP · Ambiente corporativo</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <Button
              variant="ghost"
              aria-label="Recolher ou expandir menu"
              onClick={() => setCollapsed(!collapsed)}
            >
              <Menu size={20} />
            </Button>
            <span className="topbar-title">GrupoGeo ERP / Recursos Humanos Geo</span>
          </div>
          <form
            className="top-search"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(`/employees?search=${encodeURIComponent(search)}`);
            }}
          >
            <Search size={16} />
            <input
              aria-label="Buscar funcionário"
              placeholder="Buscar funcionário ou matrícula"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>↵</kbd>
          </form>
          <div className="top-actions">
            <EnvironmentSwitcher actor={actor} onChanged={me} />
            <Button
              variant="ghost"
              title="Alternar tema"
              onClick={async () => {
                const theme = actor.theme === 'dark' ? 'light' : 'dark';
                try {
                  await api('/auth/profile', send('POST', { name: actor.name, theme }));
                  setActor({ ...actor, theme });
                  document.documentElement.dataset.theme = theme;
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              {actor.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </Button>
            {actor.permissions.includes('alerts.view') && (
              <Button
                variant="ghost"
                title="Central de alertas"
                onClick={() => navigate('/alerts')}
              >
                <Bell size={18} />
              </Button>
            )}
            <button className="user-menu" onClick={() => navigate('/profile')}>
              <span className="avatar">{actor.name.slice(0, 2).toUpperCase()}</span>
              <span>
                <strong>{actor.name}</strong>
                <small>{actor.roles.join(', ')}</small>
              </span>
              <ChevronDown size={13} />
            </button>
            <Button variant="ghost" title="Sair" onClick={() => void logout()}>
              <LogOut size={17} />
            </Button>
          </div>
        </header>
        <div className="breadcrumb">
          <span>Gestão de pessoas</span>
          <ChevronRight size={12} />
          <strong>{title}</strong>
          <span className="today">
            {new Date().toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            })}
          </span>
        </div>
        <main className="content">
          {path === '/' ? (
            <Dashboard actor={actor} />
          ) : path.startsWith('/employees/') ? (
            <EmployeeDetail id={path.split('/')[2]} actor={actor} />
          ) : path.startsWith('/vacations') ? (
            <VacationView actor={actor} calendar={path.endsWith('/calendar')} />
          ) : ['/admissions', '/terminations'].includes(path) ? (
            <WorkflowView kind={path.slice(1)} actor={actor} />
          ) : path.startsWith('/reports/') ? (
            <ReportsView kind={path.split('/')[2]} actor={actor} />
          ) : path === '/imports' ? (
            <ImportView />
          ) : path === '/alerts' ? (
            <AlertsView actor={actor} />
          ) : path.startsWith('/admin/') ? (
            <AdminView kind={path.split('/')[2]} actor={actor} />
          ) : path === '/settings' ? (
            <SettingsView />
          ) : path === '/profile' ? (
            <ProfileView actor={actor} refresh={me} />
          ) : path === '/leaves' ? (
            <LeavesView actor={actor} />
          ) : path === '/movements' ? (
            <Registry
              module="employees"
              actor={actor}
              title="Transferências, promoções e salários"
              description="Abra a ficha do funcionário e registre a movimentação na aba Histórico funcional."
            />
          ) : (
            <Registry key={path} module={path.slice(1)} actor={actor} />
          )}
        </main>
        <footer className="app-footer">
          <span>{name} · GrupoGeo ERP</span>
          <span>Acesso autenticado · Dados sujeitos às permissões do perfil</span>
        </footer>
      </div>
    </div>
  );
}
function GeoLogo({ compact = false }: { compact?: boolean }) {
  return (
    <img
      className={`geo-logo${compact ? ' compact' : ''}`}
      src="/geo-logo.svg"
      alt="Grupo Geo OTM"
    />
  );
}
function EnvironmentSelection({ actor, onSelected }: { actor: Actor; onSelected: () => Promise<void> }) {
  const [environments, setEnvironments] = useState<Environment[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState('');
  useEffect(() => { void api<Environment[]>('/auth/environments').then((r) => setEnvironments(r.data)).catch((e) => setError((e as Error).message)); }, []);
  const select = async (environmentId: string) => { setBusy(environmentId); setError(''); try { await api('/auth/environment', send('POST', { environmentId })); await onSelected(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); } };
  return <div className="environment-page"><div className="environment-box"><GeoLogo /><span className="eyebrow">GRUPOGEO ERP</span><h1>Selecione seu ambiente</h1><p>Escolha o ambiente que deseja acessar.</p>{error&&<div className="field-error">{error}</div>}<div className="environment-list">{environments.map((environment) => <button key={environment.id} className="environment-card" disabled={!!busy} onClick={() => void select(environment.id)}><span className="environment-card-icon">{environment.code === 'HR' ? <Users size={21}/> : environment.code === 'GOVERNANCE' ? <ShieldCheck size={21}/> : <Building2 size={21}/>}</span><span><strong>{environment.name}</strong><small>{environment.description}</small></span><ChevronRight size={17}/>{busy===environment.id&&<Loading/>}</button>)}</div>{!environments.length&&!error&&<p>Carregando ambientes...</p>}<small className="environment-user">{actor.name}</small></div></div>;
}
function EnvironmentSwitcher({ actor, onChanged }: { actor: Actor; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false), [environments, setEnvironments] = useState<Environment[]>([]);
  useEffect(() => { if (open) void api<Environment[]>('/auth/environments').then((r) => setEnvironments(r.data)); }, [open]);
  return <div className="environment-switcher"><button className="environment-current" onClick={() => setOpen(!open)}>{actor.environmentCode === 'HR' ? 'Recursos Humanos Geo' : actor.environmentCode === 'GOVERNANCE' ? 'Governança Geo' : 'Manutenção Geo'} <ChevronDown size={14}/></button>{open&&<div className="environment-menu">{environments.map((environment)=><button key={environment.id} disabled={environment.id===actor.environmentId} onClick={async()=>{await api('/auth/environment',send('POST',{environmentId:environment.id}));setOpen(false);await onChanged();}}>{environment.name}</button>)}</div>}</div>;
}
function EnvironmentShell({ actor, onChanged, onLogout }: { actor: Actor; onChanged: () => Promise<void>; onLogout: () => Promise<void> }) {
  const governance = actor.environmentCode === 'GOVERNANCE';
  const items = governance ? ['Dashboard','Processos','Riscos','Controles','Compliance','Auditorias','Planos de Ação','Documentos','Indicadores','Relatórios'] : ['Dashboard','Ativos','Equipamentos','Ordens de Serviço','Preventivas','Corretivas','Inspeções','Peças e Materiais','Fornecedores','Indicadores','Relatórios'];
  const title = governance ? 'Governança Geo' : 'Manutenção Geo';
  return <div className="workspace"><aside className="sidebar"><div className="brand"><GeoLogo compact /></div><div className="workspace-name"><Building2 size={15}/><span>{title}</span></div><nav aria-label="Menu do ambiente">{items.map((item,index)=><button key={item} className={`nav-item ${index===0?'active':''}`} onClick={()=>{if(index>0)toast.info('Módulo em preparação.')}}><span>{item}</span></button>)}</nav><div className="sidebar-bottom"><span className="online-dot"/><span>GrupoGeo ERP</span></div></aside><div className="main-shell"><header className="topbar"><div><span className="topbar-title">GrupoGeo ERP / {title}</span></div><div className="top-actions"><EnvironmentSwitcher actor={actor} onChanged={onChanged}/><button className="user-menu" onClick={() => void onLogout()} title="Sair"><span className="avatar">{actor.name.slice(0,2).toUpperCase()}</span><span><strong>{actor.name}</strong><small>{actor.roles.join(', ')}</small></span><LogOut size={16}/></button></div></header><main className="content"><div className="environment-hero"><span className="eyebrow">{title.toUpperCase()}</span><h1>{title}</h1><p>{governance ? 'Ambiente preparado para gestão de governança, riscos e compliance.' : 'Ambiente preparado para gestão de ativos e manutenção.'}</p><span className="environment-status">Em preparação</span></div></main></div></div>;
}
function Login({ onLogin }: { onLogin: () => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'forgot' | 'reset'>('login'),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [token, setReset] = useState(''),
    [environments, setEnvironments] = useState<Environment[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const token = new URLSearchParams(location.search).get('reset');
    if (token) {
      setMode('reset');
      setReset(token);
    }
  }, []);
  const selectEnvironment = async (environmentId: string) => {
    setBusy(true);
    setError('');
    try {
      await api('/auth/environment', send('POST', { environmentId }));
      await onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-page">
      <section className="login-intro">
        <GeoLogo />
        <div>
          <div className="eyebrow">GRUPO GEO</div>
          <h1>
            Pessoas, operações
            <br />e resultados.
            <br />
            No mesmo lugar.
          </h1>
          <p>
            Um ambiente integrado para acompanhar informações, processos e rotinas do Grupo Geo.
          </p>
        </div>
        <small>GRUPOGEO ERP · Plataforma corporativa</small>
      </section>
      <section className="login-form">
        <div className="login-box">
          {environments && mode === 'login' ? (
            <>
              <GeoLogo />
              <span className="eyebrow">GRUPOGEO ERP</span>
              <h2>Selecione seu ambiente</h2>
              <p>Escolha o ambiente que deseja acessar.</p>
              {error && <div className="field-error" role="alert">{error}</div>}
              <div className="environment-list">
                {environments.map((environment) => (
                  <button
                    key={environment.id}
                    type="button"
                    className="environment-card"
                    disabled={busy}
                    onClick={() => void selectEnvironment(environment.id)}
                  >
                    <span className="environment-card-icon">
                      {environment.code === 'HR' ? <Users size={21} /> : environment.code === 'GOVERNANCE' ? <ShieldCheck size={21} /> : <Building2 size={21} />}
                    </span>
                    <span><strong>{environment.name}</strong><small>{environment.description}</small></span>
                    <ChevronRight size={17} />
                  </button>
                ))}
              </div>
              <Button
                className="environment-back-button"
                variant="outline"
                type="button"
                onClick={async () => {
                  try {
                    await api('/auth/logout', { method: 'POST' });
                  } finally {
                    setToken(null);
                    setEnvironments(null);
                    setError('');
                  }
                }}
              >
                Voltar para o login
              </Button>
            </>
          ) : <>
          <LockKeyhole size={26} />
          <h2>
            {mode === 'login'
              ? 'Acesse seu ambiente'
              : mode === 'forgot'
                ? 'Recuperar acesso'
                : 'Redefinir senha'}
          </h2>
          <p>
            {mode === 'login'
              ? 'Informe suas credenciais corporativas.'
              : 'Utilize o e-mail cadastrado ou a nova senha.'}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                if (mode === 'login') {
                  const r = await api<{ accessToken: string; mustChangePassword: boolean }>(
                    '/auth/login',
                    send('POST', { email, password }),
                  );
                  setToken(r.data.accessToken);
                  if (r.data.mustChangePassword) {
                    await onLogin();
                    return;
                  }
                  const available = await api<Environment[]>('/auth/environments');
                  if (!available.data.length) {
                    setError('Seu usuário não possui acesso a nenhum ambiente ativo. Entre em contato com o administrador.');
                  } else if (available.data.length === 1) {
                    await selectEnvironment(available.data[0].id);
                  } else {
                    setEnvironments(available.data);
                  }
                } else if (mode === 'forgot') {
                  const r = await api('/auth/forgot-password', send('POST', { email }));
                  toast.success(r.message);
                } else {
                  await api('/auth/reset-password', send('POST', { token, password }));
                  setMode('login');
                  toast.success('Senha redefinida. Faça login.');
                }
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {mode !== 'reset' && (
              <label>
                E-mail
                <input
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nome@empresa.com.br"
                />
              </label>
            )}
            {mode !== 'forgot' && (
              <label>
                Senha
                <input
                  type="password"
                  required
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            )}
            {error && (
              <div className="field-error" role="alert">
                {error}
              </div>
            )}
            <Button disabled={busy} type="submit">
              {busy
                ? 'Aguarde…'
                : mode === 'login'
                  ? 'Entrar no sistema'
                  : mode === 'forgot'
                    ? 'Enviar instruções'
                    : 'Salvar nova senha'}
              <ChevronRight size={16} />
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => setMode(mode === 'login' ? 'forgot' : 'login')}
            >
              {mode === 'login' ? 'Esqueci minha senha' : 'Voltar para o login'}
            </Button>
          </form>
          <div className="login-note">
            <ShieldCheck size={16} />
            <span>
              Acesso restrito a usuários autorizados.
              <br />
              As operações são registradas para auditoria.
            </span>
          </div>
          </>}
        </div>
      </section>
    </div>
  );
}
function PasswordChange({ onDone }: { onDone: () => Promise<void> }) {
  const [currentPassword, setCurrent] = useState(''),
    [newPassword, setNew] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="boot">
      <div className="login-box">
        <CircleUserRound size={30} />
        <h2>Defina sua senha de acesso</h2>
        <p>
          Antes de continuar, substitua a senha temporária por uma senha com pelo menos 10
          caracteres, maiúscula, minúscula, número e símbolo.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api('/auth/change-password', send('POST', { currentPassword, newPassword }));
              await onDone();
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Senha temporária
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label>
            Nova senha
            <input
              type="password"
              minLength={10}
              required
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
            />
          </label>
          <Button disabled={busy}>{busy ? 'Salvando…' : 'Alterar senha e continuar'}</Button>
        </form>
      </div>
    </div>
  );
}
