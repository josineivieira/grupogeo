'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, Catalog, download, Field, send } from '@/lib/api';
import { Button } from '../ui';
import { DataTable } from '../data-table';
import { Heading } from './registry';
interface Validation {
  valid: boolean;
  total: number;
  errors: { line: number; field: string; value: unknown; message: string; suggestion: string }[];
}
export function ImportView() {
  const [kind, setKind] = useState('employees'),
    [headers, setHeaders] = useState<string[]>([]),
    [rows, setRows] = useState<Record<string, string>[]>([]),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [validation, setValidation] = useState<Validation | null>(null),
    [result, setResult] = useState<{
      imported: number;
      failed: number;
      results: { line: number; success: boolean; error?: string }[];
    } | null>(null),
    [busy, setBusy] = useState(false);
  const catalogs = useQuery({ queryKey: ['catalogs'], queryFn: () => api<Catalog[]>('/catalogs') });
  const employeeFields = useQuery({
    queryKey: ['employee-fields'],
    queryFn: () => api<Field[]>('/employees/fields'),
  });
  const fields =
    kind === 'employees'
      ? employeeFields.data?.data
      : catalogs.data?.data.find((c) => c.key === kind)?.fields;
  const mapped = () =>
    rows.map((row) =>
      Object.fromEntries(
        Object.entries(mapping)
          .filter(([, target]) => target)
          .map(([source, target]) => [target, row[source]]),
      ),
    );
  return (
    <>
      <Heading
        title="Importação de planilhas"
        description="Selecione, mapeie e valide os dados antes de confirmar a gravação."
      />
      <div className="panel detail-panel">
        <div className="filter-bar">
          <select
            aria-label="Tipo de importação"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setRows([]);
              setHeaders([]);
              setValidation(null);
              setResult(null);
            }}
          >
            {[
              ['employees', 'Funcionários'],
              ['contacts', 'Contatos'],
              ['companies', 'Empresas'],
              ['branches', 'Filiais'],
              ['departments', 'Departamentos'],
              ['sectors', 'Setores'],
              ['positions', 'Cargos'],
              ['benefits', 'Benefícios'],
            ].map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            onClick={() =>
              void download(`/imports/template/${kind}`, `modelo-${kind}.csv`).catch((e) =>
                toast.error(e.message),
              )
            }
          >
            Baixar modelo
          </Button>
          <input
            type="file"
            accept=".csv,.xlsx"
            aria-label="Selecionar planilha"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              setValidation(null);
              setResult(null);
              try {
                const form = new FormData();
                form.append('file', file);
                const r = await api<{ headers: string[]; rows: Record<string, string>[] }>(
                  '/imports/read',
                  { method: 'POST', body: form },
                );
                setHeaders(r.data.headers);
                setRows(r.data.rows);
                setMapping(
                  Object.fromEntries(
                    r.data.headers.map((h) => [h, fields?.some((f) => f.key === h) ? h : '']),
                  ),
                );
              } catch (err) {
                toast.error((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
        {headers.length > 0 && (
          <>
            <h2>Mapeamento de colunas · {rows.length} registros</h2>
            <div className="form-grid" style={{ marginTop: 15 }}>
              {headers.map((header) => (
                <label key={header}>
                  {header}
                  <select
                    style={{ display: 'block', width: '100%', marginTop: 5 }}
                    value={mapping[header] ?? ''}
                    onChange={(e) => {
                      setMapping({ ...mapping, [header]: e.target.value });
                      setValidation(null);
                    }}
                  >
                    <option value="">Não importar esta coluna</option>
                    {fields?.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                        {f.required ? ' *' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="form-footer">
              <span>
                Datas: AAAA-MM-DD · Valores: 1234.56 · Vínculos: identificador do cadastro
              </span>
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api<Validation>(
                      '/imports/validate',
                      send('POST', { kind, rows: mapped() }),
                    );
                    setValidation(r.data);
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Validar e visualizar prévia
              </Button>
            </div>
          </>
        )}
      </div>
      {validation && (
        <section className="detail-panel panel">
          <h2>{validation.valid ? 'Validação concluída' : 'Corrija os erros na planilha'}</h2>
          <p className="muted" style={{ margin: '8px 0 15px' }}>
            {validation.valid
              ? 'Os registros serão validados novamente pelo servidor durante a gravação. O resultado de cada linha será apresentado.'
              : `${validation.errors.length} erros encontrados. Nenhum registro foi gravado.`}
          </p>
          {validation.valid ? (
            <>
              <DataTable
                rows={mapped()
                  .slice(0, 20)
                  .map((r, i) => ({ ...r, id: String(i) }))}
                columns={Object.keys(mapped()[0] ?? {})
                  .slice(0, 8)
                  .map((key) => ({ key, label: fields?.find((f) => f.key === key)?.label ?? key }))}
              />
              <div className="form-footer">
                <Button
                  disabled={busy || !!result}
                  onClick={async () => {
                    if (!window.confirm(`Importar ${rows.length} registros?`)) return;
                    setBusy(true);
                    try {
                      const r = await api<NonNullable<typeof result>>(
                        '/imports/confirm',
                        send('POST', { kind, rows: mapped() }),
                      );
                      setResult(r.data);
                      toast.success('Processamento concluído. Consulte os resultados.');
                    } catch (e) {
                      toast.error((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Confirmar importação
                </Button>
              </div>
            </>
          ) : (
            <DataTable
              rows={validation.errors.map((r, i) => ({ ...r, id: String(i) }))}
              columns={[
                { key: 'line', label: 'Linha' },
                { key: 'field', label: 'Campo' },
                { key: 'value', label: 'Valor' },
                { key: 'message', label: 'Motivo' },
                { key: 'suggestion', label: 'Correção' },
              ]}
            />
          )}
        </section>
      )}
      {result && (
        <section className="panel detail-panel">
          <h2>
            Resultado: {result.imported} importados · {result.failed} rejeitados
          </h2>
          <DataTable
            rows={result.results.map((r) => ({ ...r, id: String(r.line) }))}
            columns={[
              { key: 'line', label: 'Linha' },
              { key: 'success', label: 'Importado' },
              { key: 'error', label: 'Motivo da rejeição' },
            ]}
          />
        </section>
      )}
    </>
  );
}
