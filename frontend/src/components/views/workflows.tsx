'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, Check, Plus, X } from 'lucide-react';
import { Actor, api, display, Field, Row, send, statusLabel } from '@/lib/api';
import { Button, ErrorBox, Loading, Modal } from '../ui';
import { DataTable } from '../data-table';
import { RecordForm } from '../record-form';
import { Heading, queryString } from './registry';
const employeeField: Field = {
  key: 'employeeId',
  label: 'Funcionário',
  type: 'select',
  reference: 'employees',
  required: true,
};
export function VacationView({
  actor,
  employeeId,
  calendar = false,
}: {
  actor: Actor;
  employeeId?: string;
  calendar?: boolean;
}) {
  const client = useQueryClient(),
    [selected, setSelected] = useState(employeeId ?? ''),
    [create, setCreate] = useState(false),
    [action, setAction] = useState<{ id: string; action: string } | null>(null),
    [month, setMonth] = useState(new Date().toISOString().slice(0, 7)),
    [page, setPage] = useState(1);
  const employees = useQuery({
    queryKey: ['vacation-employees'],
    queryFn: () => api<Row[]>('/employees?limit=100'),
  });
  const accruals = useQuery({
    queryKey: ['accruals', selected],
    enabled: !!selected,
    queryFn: () => api<Row[]>(`/vacations/accruals/${selected}`),
  });
  const q = useQuery({
    queryKey: ['vacations', selected, month, page, calendar],
    queryFn: () =>
      api<Row[]>(
        `/vacations?${queryString({ employeeId: selected, page, limit: calendar ? 100 : 20, from: calendar ? `${month}-01` : undefined, to: calendar ? new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).toISOString().slice(0, 10) : undefined })}`,
      ),
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['vacations'] });
    await client.invalidateQueries({ queryKey: ['accruals'] });
  };
  return (
    <>
      <Heading
        title={calendar ? 'Calendário de férias' : 'Gestão de férias'}
        description="Períodos aquisitivos, solicitações, aprovações e saldos por funcionário."
      >
        {actor.permissions.includes('vacations.create') && (
          <Button onClick={() => setCreate(true)} disabled={!selected}>
            <Plus size={16} />
            Solicitar férias
          </Button>
        )}
      </Heading>
      <div className="filter-bar">
        <CalendarDays size={17} />
        <select
          aria-label="Funcionário"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Todos os funcionários</option>
          {employees.data?.data.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        {calendar && (
          <input
            aria-label="Mês"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        )}{' '}
        {!!selected && actor.permissions.includes('vacations.create') && (
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await api(`/vacations/accruals/${selected}/generate`, { method: 'POST' });
                await refresh();
                toast.success('Períodos atualizados.');
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            Atualizar períodos aquisitivos
          </Button>
        )}
      </div>
      {selected && (
        <section className="panel accrual-panel">
          <h2>Períodos aquisitivos</h2>
          {accruals.isLoading ? (
            <Loading />
          ) : accruals.error ? (
            <ErrorBox error={accruals.error} />
          ) : (
            <div className="accruals">
              {accruals.data?.data.map((a) => (
                <div key={a.id}>
                  <strong>
                    {display(a.startDate)} a {display(a.endDate)}
                  </strong>
                  <span>Concessão até {display(a.deadline)}</span>
                  <p>
                    <b>{String(a.balance)}</b> dias disponíveis
                  </p>
                  <small>
                    {String(a.usedDays)} utilizados · {String(a.reservedDays)} reservados ·{' '}
                    {String(a.soldDays)} vendidos
                  </small>
                </div>
              ))}
              {!accruals.data?.data.length && (
                <p>Gere os períodos aquisitivos para iniciar a programação.</p>
              )}
            </div>
          )}
        </section>
      )}
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : calendar ? (
        <section className="panel calendar">
          <div className="calendar-grid">
            {Array.from(
              { length: new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate() },
              (_, i) => {
                const date = `${month}-${String(i + 1).padStart(2, '0')}`;
                return (
                  <div className="calendar-day" key={i}>
                    <strong>{i + 1}</strong>
                    {q.data?.data
                      .filter(
                        (v) =>
                          String(v.startDate).slice(0, 10) <= date &&
                          String(v.endDate).slice(0, 10) >= date &&
                          !['REJECTED', 'CANCELLED'].includes(String(v.status)),
                      )
                      .map((v) => (
                        <span title={statusLabel[String(v.status)]} key={v.id}>
                          {display(v.employee)}
                        </span>
                      ))}
                  </div>
                );
              },
            )}
          </div>
        </section>
      ) : (
        <DataTable
          rows={q.data?.data ?? []}
          columns={[
            { key: 'employee', label: 'Funcionário' },
            { key: 'startDate', label: 'Início' },
            { key: 'endDate', label: 'Término' },
            { key: 'returnDate', label: 'Retorno' },
            { key: 'days', label: 'Dias' },
            { key: 'soldDays', label: 'Vendidos' },
            { key: 'status', label: 'Situação' },
          ]}
          page={page}
          onPage={setPage}
          total={q.data?.meta?.total ?? 0}
          actions={(v) => (
            <div className="row-actions">
              {['REQUESTED', 'MANAGER_APPROVED'].includes(String(v.status)) &&
                (actor.permissions.includes('vacations.approve') ||
                  actor.permissions.includes('vacations.approve_manager')) && (
                  <Button
                    variant="ghost"
                    title="Aprovar etapa"
                    onClick={() => setAction({ id: v.id, action: 'approve' })}
                  >
                    <Check size={16} />
                  </Button>
                )}
              {['REQUESTED', 'MANAGER_APPROVED'].includes(String(v.status)) &&
                actor.permissions.includes('vacations.approve') && (
                  <Button
                    variant="ghost"
                    title="Rejeitar"
                    onClick={() => setAction({ id: v.id, action: 'reject' })}
                  >
                    <X size={16} />
                  </Button>
                )}
              {actor.permissions.includes('vacations.cancel') &&
                !['COMPLETED', 'REJECTED', 'CANCELLED'].includes(String(v.status)) && (
                  <Button variant="ghost" onClick={() => setAction({ id: v.id, action: 'cancel' })}>
                    Cancelar
                  </Button>
                )}
            </div>
          )}
        />
      )}
      <Modal open={create} onOpenChange={setCreate} title="Solicitar férias" wide>
        <RecordForm
          fields={[
            {
              key: 'accrualId',
              label: 'Período aquisitivo',
              type: 'select',
              required: true,
              choices: accruals.data?.data.filter((a) => Number(a.balance) > 0).map((a) => ({value:a.id,label:`${display(a.startDate)} a ${display(a.endDate)} · saldo ${a.balance} dias`})),
            },
            { key: 'startDate', label: 'Data inicial', type: 'date', required: true },
            { key: 'days', label: 'Dias de gozo', type: 'number', required: true },
            { key: 'soldDays', label: 'Dias vendidos', type: 'number' },
            { key: 'advance13', label: 'Antecipar 13º', type: 'checkbox' },
            {
              key: 'acknowledgeOverdue',
              label: 'Estou ciente caso a programação ultrapasse o prazo concessivo',
              type: 'checkbox',
            },
            { key: 'notes', label: 'Observações', type: 'textarea' },
          ]}
          initial={{ soldDays: '0' }}
          onCancel={() => setCreate(false)}
          onSave={async (data) => {
            await api('/vacations', send('POST', { ...data, employeeId: selected }));
            setCreate(false);
            await refresh();
            toast.success('Solicitação registrada.');
          }}
        />
      </Modal>
      <Modal
        open={!!action}
        onOpenChange={() => setAction(null)}
        title="Confirmar decisão"
        description="A decisão e o comentário serão registrados no histórico de aprovação."
      >
        <RecordForm
          fields={[{ key: 'comment', label: 'Comentário', type: 'textarea', required: true }]}
          onCancel={() => setAction(null)}
          onSave={async (data) => {
            await api(`/vacations/${action?.id}/${action?.action}`, send('POST', data));
            setAction(null);
            await refresh();
            toast.success('Decisão registrada.');
          }}
        />
      </Modal>
    </>
  );
}
export function WorkflowView({ kind, actor }: { kind: string; actor: Actor }) {
  const client = useQueryClient(),
    [create, setCreate] = useState(false),
    [detail, setDetail] = useState<Row | null>(null),
    [page, setPage] = useState(1);
  const admission = kind === 'admissions';
  const q = useQuery({
    queryKey: ['workflow', kind, page],
    queryFn: () => api<Row[]>(`/workflows/${kind}?page=${page}`),
  });
  const fields: Field[] = admission
    ? [employeeField, { key: 'notes', label: 'Observações', type: 'textarea' }]
    : [
        employeeField,
        { key: 'communicationDate', label: 'Data de comunicação', type: 'date', required: true },
        { key: 'effectiveDate', label: 'Data de desligamento', type: 'date', required: true },
        {
          key: 'type',
          label: 'Tipo',
          type: 'select',
          required: true,
          options: [
            'Pedido de demissão',
            'Sem justa causa',
            'Justa causa',
            'Término de contrato',
            'Acordo',
            'Aposentadoria',
            'Falecimento',
            'Outros',
          ],
        },
        { key: 'reason', label: 'Motivo', required: true, type: 'textarea' },
        {
          key: 'initiative',
          label: 'Iniciativa',
          type: 'select',
          required: true,
          options: ['EMPREGADO', 'EMPREGADOR', 'ACORDO'],
        },
        { key: 'noticeType', label: 'Aviso prévio' },
        { key: 'noticeEnd', label: 'Fim do aviso', type: 'date' },
        { key: 'interview', label: 'Entrevista de desligamento', type: 'textarea' },
      ];
  const refresh = () => client.invalidateQueries({ queryKey: ['workflow'] });
  return (
    <>
      <Heading
        title={admission ? 'Admissões' : 'Desligamentos'}
        description="Processos com checklist, responsáveis e preservação do histórico funcional."
      >
        {actor.permissions.includes(`${kind}.create`) && (
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            Iniciar processo
          </Button>
        )}
      </Heading>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <DataTable
          rows={q.data?.data ?? []}
          columns={[
            { key: 'employee', label: 'Funcionário' },
            { key: 'status', label: 'Situação' },
            { key: 'createdAt', label: 'Abertura' },
            ...(!admission
              ? [
                  { key: 'effectiveDate', label: 'Data efetiva' },
                  { key: 'type', label: 'Tipo' },
                ]
              : []),
          ]}
          page={page}
          onPage={setPage}
          total={q.data?.meta?.total ?? 0}
          actions={(r) => (
            <Button variant="outline" onClick={() => setDetail(r)}>
              Ver checklist
            </Button>
          )}
        />
      )}
      <Modal
        open={create}
        onOpenChange={setCreate}
        title={admission ? 'Iniciar admissão' : 'Registrar desligamento'}
        wide
      >
        <RecordForm
          fields={fields}
          onCancel={() => setCreate(false)}
          onSave={async (data) => {
            await api(`/workflows/${kind}`, send('POST', data));
            setCreate(false);
            await refresh();
            toast.success('Processo iniciado.');
          }}
        />
      </Modal>
      <Modal
        open={!!detail}
        onOpenChange={() => setDetail(null)}
        title="Checklist do processo"
        description={display(detail?.employee)}
        wide
      >
        <div className="checklist">
          {(detail?.checklist as Row[] | undefined)?.map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={!!item.completedAt}
                disabled={
                  !actor.permissions.includes(`${kind}.update`) ||
                  ['ADMITIDA', 'CONCLUIDO'].includes(String(detail?.status))
                }
                onChange={async (e) => {
                  try {
                    const r = await api<Row>(
                      `/workflows/${kind}/${detail?.id}/checklist/${item.id}`,
                      send('PATCH', { completed: e.target.checked, responsible: actor.name }),
                    );
                    setDetail((current) =>
                      current
                        ? {
                            ...current,
                            checklist: (current.checklist as Row[]).map((i) =>
                              i.id === item.id ? r.data : i,
                            ),
                          }
                        : null,
                    );
                    await refresh();
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                }}
              />
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.completedAt
                    ? `Concluído em ${display(item.completedAt)} · ${display(item.responsible)}`
                    : 'Pendente'}
                </small>
              </span>
            </label>
          ))}
        </div>
        {actor.permissions.includes(`${kind}.update`) &&
          !['ADMITIDA', 'CONCLUIDO'].includes(String(detail?.status)) && (
            <div className="form-footer">
              <Button
                onClick={async () => {
                  if (!window.confirm('Concluir o processo e atualizar a situação do funcionário?'))
                    return;
                  try {
                    await api(`/workflows/${kind}/${detail?.id}/complete`, { method: 'POST' });
                    setDetail(null);
                    await refresh();
                    toast.success('Processo concluído.');
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                }}
              >
                Concluir processo
              </Button>
            </div>
          )}
      </Modal>
    </>
  );
}
export function LeavesView({ actor }: { actor: Actor }) {
  const client = useQueryClient(),
    [create, setCreate] = useState(false),
    [returnId, setReturn] = useState<string | null>(null),
    [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['leaves', page],
    queryFn: () => api<Row[]>(`/leaves?page=${page}`),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['leaves'] });
  return (
    <>
      <Heading
        title="Afastamentos e retornos"
        description="Registre os períodos de ausência e acompanhe os retornos à atividade."
      >
        {actor.permissions.includes('leaves.create') && (
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            Novo afastamento
          </Button>
        )}
      </Heading>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <DataTable
          rows={q.data?.data ?? []}
          columns={[
            { key: 'employee', label: 'Funcionário' },
            { key: 'type', label: 'Tipo' },
            { key: 'startDate', label: 'Início' },
            { key: 'expectedReturn', label: 'Retorno previsto' },
            { key: 'actualReturn', label: 'Retorno real' },
            { key: 'status', label: 'Situação' },
          ]}
          page={page}
          onPage={setPage}
          total={q.data?.meta?.total ?? 0}
          actions={(r) =>
            !r.actualReturn && actor.permissions.includes('leaves.update') ? (
              <Button variant="outline" onClick={() => setReturn(r.id)}>
                Registrar retorno
              </Button>
            ) : null
          }
        />
      )}
      <Modal open={create} onOpenChange={setCreate} title="Novo afastamento" wide>
        <RecordForm
          fields={[
            employeeField,
            {
              key: 'type',
              label: 'Tipo',
              type: 'select',
              required: true,
              options: [
                'Médico',
                'Acidente de trabalho',
                'Licença-maternidade',
                'Licença-paternidade',
                'Licença não remunerada',
                'Serviço militar',
                'INSS',
                'Suspensão',
                'Outros',
              ],
            },
            { key: 'startDate', label: 'Início', type: 'date', required: true },
            { key: 'expectedReturn', label: 'Retorno previsto', type: 'date', required: true },
            { key: 'reason', label: 'Motivo', type: 'textarea', required: true },
            { key: 'notes', label: 'Observações', type: 'textarea' },
          ]}
          onCancel={() => setCreate(false)}
          onSave={async (data) => {
            await api('/leaves', send('POST', data));
            setCreate(false);
            await refresh();
            toast.success('Afastamento registrado.');
          }}
        />
      </Modal>
      <Modal open={!!returnId} onOpenChange={() => setReturn(null)} title="Retorno ao trabalho">
        <RecordForm
          fields={[
            { key: 'actualReturn', label: 'Data real de retorno', type: 'date', required: true },
          ]}
          onCancel={() => setReturn(null)}
          onSave={async (data) => {
            await api(`/leaves/${returnId}/return`, send('POST', data));
            setReturn(null);
            await refresh();
            toast.success('Retorno registrado.');
          }}
        />
      </Modal>
    </>
  );
}
