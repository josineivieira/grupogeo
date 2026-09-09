'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Actor, api, display, Field, Row, send, statusLabel } from '@/lib/api';
import { ArrowLeft, ArrowLeftRight, Pencil } from 'lucide-react';
import { useRouter } from '@/lib/navigation';
import { Button, ErrorBox, Loading, Modal } from '../ui';
import { RecordForm } from '../record-form';
import { DataTable } from '../data-table';
import { Heading, Registry } from './registry';
import { VacationView } from './workflows';
import { AssetUpload,SecurePhoto } from '../assets';
const addressFields: Field[] = [
  { key: 'postalCode', label: 'CEP', required: true },
  { key: 'street', label: 'Logradouro', required: true },
  { key: 'number', label: 'Número', required: true },
  { key: 'complement', label: 'Complemento' },
  { key: 'district', label: 'Bairro', required: true },
  { key: 'city', label: 'Cidade', required: true },
  { key: 'state', label: 'UF', required: true },
  { key: 'country', label: 'País', required: true },
];
const bankFields: Field[] = [
  ['bank', 'Banco'],
  ['bankCode', 'Código do banco'],
  ['agency', 'Agência'],
  ['account', 'Conta'],
  ['digit', 'Dígito'],
  ['type', 'Tipo de conta'],
  ['pix', 'Chave PIX'],
  ['holder', 'Titular'],
  ['holderCpf', 'CPF do titular'],
].map(([key, label]) => ({ key, label, required: key !== 'pix' }));
export function EmployeeDetail({ id, actor }: { id: string; actor: Actor }) {
  const router = useRouter(),
    client = useQueryClient(),
    [tab, setTab] = useState('personal'),
    [edit, setEdit] = useState(false),
    [movement, setMovement] = useState(false);
  const q = useQuery({ queryKey: ['employee', id], queryFn: () => api<Row>(`/employees/${id}`) });
  const fields = useQuery({
    queryKey: ['employee-fields'],
    queryFn: () => api<Field[]>('/employees/fields'),
  });
  const history = useQuery({
    queryKey: ['history', id],
    enabled: tab === 'history',
    queryFn: () => api<Row[]>(`/employees/${id}/history?limit=100`),
  });
  const address = useQuery({
    queryKey: ['address', id],
    enabled: tab === 'address',
    queryFn: () => api<Row | null>(`/employees/${id}/address`),
  });
  const bank = useQuery({
    queryKey: ['bank', id],
    enabled: tab === 'bank',
    queryFn: () => api<Row | null>(`/employees/${id}/bank`),
  });
  const salaries = useQuery({
    queryKey: ['salary-history', id],
    enabled: tab === 'salary',
    queryFn: () => api<Row[]>(`/employees/${id}/salary-history`),
  });
  const e = q.data?.data;
  const tabs = [
    ['personal', 'Dados pessoais', 'employees.view_personal'],
    ['professional', 'Profissional', 'employees.view'],
    ['address', 'Endereço', 'employees.view_personal'],
    ['bank', 'Dados bancários', 'employees.view_bank'],
    ['contacts', 'Emergência', 'contacts.view'],
    ['dependents', 'Dependentes', 'dependents.view'],
    ['documents', 'Documentos', 'employees.view_documents'],
    ['benefits', 'Benefícios', 'employees.view_salary'],
    ['allowances', 'Adicionais', 'employees.view_salary'],
    ['health', 'Saúde ocupacional', 'health.view_sensitive'],
    ['vacations', 'Férias', 'vacations.view'],
    ['salary', 'Histórico salarial', 'employees.view_salary'],
    ['history', 'Histórico funcional', 'employees.view'],
  ].filter(([, , p]) => actor.permissions.includes(p));
  const effective = tabs.some(([key]) => key === tab) ? tab : 'professional';
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['employee', id] });
    await client.invalidateQueries({ queryKey: ['history', id] });
    await client.invalidateQueries({ queryKey: ['salary-history', id] });
  };
  if (q.isLoading) return <Loading />;
  if (q.error || !e) return <ErrorBox error={q.error} />;
  return (
    <>
      <Button variant="ghost" onClick={() => router.push('/employees')}>
        <ArrowLeft size={15} />
        Voltar à lista
      </Button>
      <Heading
        title={e.name ?? 'Funcionário'}
        description={`${display(e.registration)} · ${display(e.jobPosition)} · ${display(e.branch)}`}
      >
        {actor.permissions.includes('employees.update') && (
          <Button variant="outline" onClick={() => setEdit(true)}>
            <Pencil size={15} />
            Editar ficha
          </Button>
        )}
        {actor.permissions.includes('movements.create') && (
          <Button onClick={() => setMovement(true)}>
            <ArrowLeftRight size={15} />
            Registrar movimentação
          </Button>
        )}
      </Heading>
      <div className="employee-summary">
        <SecurePhoto id={e.photoId as string|undefined} alt={e.name??'Funcionário'} className="employee-avatar"/>
        <div>
          <strong>{e.name}</strong>
          <small>
            {display(e.company)} · {display(e.department)}
          </small>
        </div>
        <span className={`badge badge-${String(e.status).toLowerCase()}`}>
          {statusLabel[String(e.status)]}
        </span>
        <div className="summary-detail">
          <small>Data de admissão</small>
          <strong>{display(e.admissionDate)}</strong>
        </div>
        <div className="summary-detail">
          <small>Gestor direto</small>
          <strong>{display(e.manager)}</strong>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={effective === key}
            className={effective === key ? 'selected' : ''}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {['personal', 'professional'].includes(effective) && (
        <section className="panel detail-panel">
          {effective==='personal'&&actor.permissions.includes('employees.update')&&<AssetUpload category="EMPLOYEE_PHOTO" employeeId={id} label="Foto do funcionário" onSaved={()=>void refresh()}/>}
          <h2>{effective === 'personal' ? 'Informações pessoais' : 'Dados profissionais'}</h2>
          <dl className="detail-grid">
            {fields.data?.data
              .filter((f) => f.section === (effective === 'personal' ? 'Pessoal' : 'Profissional'))
              .map((f) => (
                <div key={f.key}>
                  <dt>{f.label}</dt>
                  <dd>
                    {f.key === 'salary'
                      ? Number(e.salary).toLocaleString('pt-BR', {
                          style: 'currency',
                          currency: 'BRL',
                        })
                      : display(f.reference ? (e[f.key.replace(/Id$/, '')] ?? e[f.key]) : e[f.key])}
                  </dd>
                </div>
              ))}
          </dl>
        </section>
      )}
      {['contacts', 'dependents', 'documents', 'benefits', 'allowances', 'health'].includes(
        effective,
      ) && <Registry key={effective} module={effective} actor={actor} employeeId={id} />}
      {effective === 'vacations' && <VacationView actor={actor} employeeId={id} />}
      {effective === 'history' &&
        (history.isLoading ? (
          <Loading />
        ) : history.error ? (
          <ErrorBox error={history.error} />
        ) : (
          <DataTable
            rows={history.data?.data ?? []}
            columns={[
              { key: 'effectiveDate', label: 'Data efetiva' },
              { key: 'type', label: 'Movimentação' },
              { key: 'reason', label: 'Motivo' },
              { key: 'before', label: 'Dados anteriores' },
              { key: 'after', label: 'Dados posteriores' },
              { key: 'createdAt', label: 'Registro' },
            ]}
          />
        ))}
      {effective === 'salary' &&
        (salaries.isLoading ? (
          <Loading />
        ) : salaries.error ? (
          <ErrorBox error={salaries.error} />
        ) : (
          <DataTable
            rows={salaries.data?.data ?? []}
            columns={[
              { key: 'effectiveDate', label: 'Data efetiva' },
              { key: 'previousSalary', label: 'Salário anterior' },
              { key: 'newSalary', label: 'Novo salário' },
              { key: 'type', label: 'Tipo' },
              { key: 'reason', label: 'Motivo' },
            ]}
          />
        ))}
      {['address', 'bank'].includes(effective) && (
        <section className="panel detail-panel">
          {(effective === 'address' ? address : bank).isLoading ? (
            <Loading />
          ) : (effective === 'address' ? address : bank).error ? (
            <ErrorBox error={(effective === 'address' ? address : bank).error} />
          ) : (
            <RecordForm
              key={effective}
              fields={effective === 'address' ? addressFields : bankFields}
              initial={
                (effective === 'address' ? address.data?.data : bank.data?.data) ?? {
                  country: 'Brasil',
                }
              }
              onCancel={() => setTab('personal')}
              onSave={async (data) => {
                await api(`/employees/${id}/${effective}`, send('POST', data));
                await client.invalidateQueries({ queryKey: [effective, id] });
                toast.success('Dados salvos.');
              }}
            />
          )}
        </section>
      )}
      <Modal open={edit} onOpenChange={setEdit} title="Editar ficha do funcionário" wide>
        {fields.data && (
          <RecordForm
            fields={fields.data.data}
            initial={e}
            onCancel={() => setEdit(false)}
            onSave={async (data) => {
              await api(`/employees/${id}`, send('PATCH', data));
              setEdit(false);
              await refresh();
              toast.success('Ficha atualizada.');
            }}
          />
        )}
      </Modal>
      <Modal
        open={movement}
        onOpenChange={setMovement}
        title="Registrar movimentação"
        description="As informações anteriores serão preservadas no histórico. Registre a alteração na data em que ela produz efeito."
        wide
      >
        <RecordForm
          fields={[
            {
              key: 'type',
              label: 'Tipo de movimentação',
              type: 'select',
              required: true,
              options: ['TRANSFERENCIA', 'PROMOCAO', 'ALTERACAO_SALARIAL'],
            },
            { key: 'effectiveDate', label: 'Data efetiva', type: 'date', required: true },
            { key: 'reason', label: 'Motivo', type: 'textarea', required: true },
            ...(fields.data?.data ?? [])
              .filter((f) =>
                [
                  'companyId',
                  'branchId',
                  'departmentId',
                  'sectorId',
                  'jobPositionId',
                  'managerId',
                  'costCenterId',
                  'workScheduleId',
                  'workLocation',
                  ...(actor.permissions.includes('employees.update_salary') ? ['salary'] : []),
                ].includes(f.key),
              )
              .map((f) => ({ ...f, required: false })),
          ]}
          initial={{ effectiveDate: new Date().toISOString().slice(0, 10) }}
          onCancel={() => setMovement(false)}
          onSave={async (data) => {
            await api(`/employees/${id}/movements`, send('POST', data));
            setMovement(false);
            await refresh();
            toast.success('Movimentação registrada.');
          }}
        />
      </Modal>
    </>
  );
}
