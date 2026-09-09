'use client';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueries } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError, Field, Row, maskCpf, maskBrazilian } from '@/lib/api';
import { Button } from './ui';
export function RecordForm({
  fields,
  initial = {},
  onSave,
  onCancel,
  submitLabel = 'Salvar registro',
}: {
  fields: Field[];
  initial?: Record<string, unknown>;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}) {
  const shape = useMemo(
    () =>
      Object.fromEntries(
        fields.map((f) => [
          f.key,
          f.type === 'checkbox'
            ? z.boolean().optional()
            : f.required
              ? z.string().min(1, `${f.label} é obrigatório.`)
              : z.string().optional(),
        ]),
      ),
    [fields],
  );
  const schema = z.object(shape);
  const defaults = Object.fromEntries(
    fields.map((f) => [
      f.key,
      f.type === 'checkbox'
        ? Boolean(initial[f.key])
        : initial[f.key] == null
          ? ''
          : String(initial[f.key]).slice(0, f.type === 'date' ? 10 : 10000),
    ]),
  );
  const form = useForm<Record<string, string | boolean | undefined>>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });
  const references = [...new Set(fields.flatMap((f) => (f.reference ? [f.reference] : [])))];
  const queries = useQueries({
    queries: references.map((ref) => ({
      queryKey: ['options', ref],
      queryFn: async () => {
        let all: Row[] = [];
        for (let page = 1; page <= 100; page++) {
          const r = await api<Row[]>(
            `${ref === 'employees' ? '/employees' : `/catalogs/${ref}`}?limit=100&page=${page}`,
          );
          all = [...all, ...r.data];
          if (!r.meta || page >= r.meta.totalPages) break;
        }
        return all;
      },
    })),
  });
  const options = Object.fromEntries(references.map((r, i) => [r, queries[i].data ?? []]));
  const current = form.watch();
  function matchingOptions(reference: string) {
    return (options[reference] ?? []).filter(row => {
      if (reference === 'employees') return true;
      return ['companyId', 'branchId', 'departmentId'].every(key =>
        !current[key] || !row[key] || row[key] === current[key]);
    });
  }
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (form.formState.isDirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [form.formState.isDirty]);
  const submit = form.handleSubmit(async (data) => {
    const clean = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== '' && v !== undefined),
    );
    try {
      await onSave(clean);
    } catch (e) {
      if (e instanceof ApiError)
        for (const field of e.fields) form.setError(field.field, { message: field.message });
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar o registro.');
    }
  });
  let section = '';
  return (
    <form onSubmit={submit} className="record-form">
      <div className="form-grid">
        {fields.map((f) => {
          const heading = f.section && section !== f.section ? f.section : null;
          if (f.section) section = f.section;
          const registered = form.register(f.key);
          return (
            <div
              key={f.key}
              className={f.type === 'textarea' || heading ? 'form-item full' : 'form-item'}
            >
              {heading && <h3 className="form-section">{heading}</h3>}
              <label htmlFor={f.key}>
                {f.label}
                {f.required && <span className="required"> *</span>}
              </label>
              {f.type === 'select' ? (
                <select id={f.key} {...registered}>
                  <option value="">Selecione…</option>
                  {f.options?.map((v) => (
                    <option value={v} key={v}>
                      {v}
                    </option>
                  ))}
                  {f.choices?.map(choice=><option key={choice.value} value={choice.value}>{choice.label}</option>)}
                  {f.reference &&
                    matchingOptions(f.reference).map((r) => (
                      <option value={r.id} key={r.id}>
                        {r.name ?? r.id}
                      </option>
                    ))}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea id={f.key} rows={3} {...registered} />
              ) : f.type === 'checkbox' ? (
                <input id={f.key} type="checkbox" {...registered} />
              ) : (
                <input
                  id={f.key}
                  type={f.type ?? 'text'}
                  step={f.type === 'number' ? '0.01' : undefined}
                  {...registered}
                  onChange={(e) => {
                    if (f.key === 'cpf' || f.key === 'holderCpf')
                      e.target.value = maskCpf(e.target.value);
                    else e.target.value = maskBrazilian(f.key, e.target.value);
                    void registered.onChange(e);
                  }}
                  onBlur={async (e) => {
                    void registered.onBlur(e);
                    if(f.key !== 'postalCode') return;
                    const cep = e.target.value.replace(/\D/g, '');
                    if(cep.length !== 8) return;
                    try {
                      const result = await api<Record<string,string>>(`/addresses/${cep}`);
                      for(const [key, value] of Object.entries(result.data)) if(fields.some(field => field.key === key) && value) form.setValue(key,value,{shouldDirty:true});
                      toast.success('Endereço localizado. Confira o número e o complemento.');
                    } catch(err) { toast.error((err as Error).message); }
                  }}
                />
              )}
              {form.formState.errors[f.key] && (
                <small className="field-error">
                  {String(form.formState.errors[f.key]?.message)}
                </small>
              )}
            </div>
          );
        })}
      </div>
      {queries.some((q) => q.isError) && (
        <p className="field-error">
          Não foi possível carregar um cadastro relacionado. Verifique suas permissões e tente
          novamente.
        </p>
      )}
      <div className="form-footer">
        <span>{form.formState.isDirty ? 'Alterações ainda não salvas' : ''}</span>
        <Button
          variant="outline"
          type="button"
          onClick={() => {
            if (!form.formState.isDirty || window.confirm('Descartar as alterações não salvas?')) {
              form.reset();
              onCancel();
            }
          }}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Salvando…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
