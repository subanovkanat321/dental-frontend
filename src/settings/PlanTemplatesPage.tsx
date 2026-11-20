import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Select } from '../layout/Select'
import { ask } from '../lib/confirm'
import { somText } from '../lib/time'
import { NoTemplates } from '../medical/PlanTemplateSheet'
import { SubHeader } from './SubHeader'
import '../medical/plan.css'

type Me = Schemas['BookingViewsMe']
type Template = Schemas['PlanTemplatesView']
type Row = { title: string; service: string; stage: string; perTooth: boolean }

const STAGES = [1, 2, 3, 4, 5, 6, 7, 8, 9]

function errorText(e: ApiError | null): string | null {
  if (!e) return null
  return Object.values(e.fieldErrors)[0] ?? e.message
}

/** «Имплантация → Формирователь → Коронка · 3 этапа» — строка шаблона в списке. */
function summary(t: Template): string {
  const stages = Math.max(1, ...t.steps.map((s) => s.stage))
  return `${t.steps.map((s) => s.title).join(' → ')} · ${stages} ${stages === 1 ? 'этап' : stages < 5 ? 'этапа' : 'этапов'}`
}

/**
 * «Настройки → Приём → Шаблоны плана» (шаг 4А, опыт Dentist Plus): шаблоны плана лечения — свои (врач) и общие
 * клиники (заводит руководитель). Шаг: что сделать, услуга прайса (цена — из прайса, когда шаблон применяют), этап и
 * «каждому зубу». Применяют в плане лечения пациента — «📄 Из шаблона». Готовые («Имплант под ключ», «Санация»…) у новой
 * клиники уже есть (V246); «Добавить готовые» внизу возвращает удалённые.
 */
export function PlanTemplatesPage({ me, onBack }: { me: Me; onBack: () => void }) {
  const list = useQuery({ queryKey: ['plan-templates'], queryFn: () => unwrap(api.GET('/api/plan-templates')) })
  const [editing, setEditing] = useState<Template | 'new' | null>(null)
  const mine = (list.data ?? []).filter((t) => !t.shared)
  const shared = (list.data ?? []).filter((t) => t.shared)
  return (
    <section className="schedule-main visit-templates-page">
      <SubHeader title="Шаблоны плана" onBack={onBack} />
      <section className="card-block" aria-label="Шаблоны плана">
        <h2>Шаблоны плана лечения</h2>
        <p className="hint small">Этапы плана одним нажатием: в плане лечения пациента — «📄 Из шаблона», выбрать зубы и с какого
          этапа начать. Цены — из прайса на день применения.</p>
        {list.error && <p className="error" role="alert">{list.error.message}</p>}
        {editing === 'new' ? <TemplateForm me={me} onDone={() => setEditing(null)} />
          : <button type="button" className="btn" onClick={() => setEditing('new')}>＋ Новый шаблон</button>}
        {list.isSuccess && list.data.length === 0 && editing !== 'new' && <NoTemplates />}
        {[['Мои', mine], ['Общие клиники', shared]].map(([title, items]) => (items as Template[]).length > 0 && (
          <div key={title as string} className="template-group" role="group" aria-label={title as string}>
            <h3>{title as string}</h3>
            <ul className="visits">
              {(items as Template[]).map((t) => (
                <li key={t.id} className="template-row">
                  {editing !== 'new' && editing?.id === t.id ? <TemplateForm me={me} template={t} onDone={() => setEditing(null)} /> : (
                    <>
                      <span><b>{t.title}</b><br /><span className="hint small">{summary(t)}</span></span>
                      {t.editable && <TemplateActions template={t} onEdit={() => setEditing(t)} />}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {list.isSuccess && list.data.length > 0 && editing == null && <NoTemplates empty={false} />}
      </section>
    </section>
  )
}

function TemplateActions({ template: t, onEdit }: { template: Template; onEdit: () => void }) {
  const client = useQueryClient()
  const remove = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/plan-templates/{id}', { params: { path: { id: t.id } } })),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['plan-templates'] }),
  })
  return (
    <span className="actions">
      <button type="button" className="btn small" onClick={onEdit} aria-label={`Изменить: ${t.title}`}>Изменить</button>
      <button type="button" className="btn small ghost" disabled={remove.isPending} aria-label={`Удалить: ${t.title}`}
        onClick={async () => { if (await ask(`Удалить шаблон «${t.title}»?`, { ok: 'Удалить', danger: true })) remove.mutate() }}>Удалить</button>
      {remove.error && <span className="error small" role="alert">{remove.error.message}</span>}
    </span>
  )
}

/** Новый или изменить: название, шаги (что сделать, услуга, этап, «каждому зубу»), «общий для клиники». */
function TemplateForm({ me, template: t, onDone }: { me: Me; template?: Template; onDone: () => void }) {
  const client = useQueryClient()
  const services = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')), staleTime: 5 * 60_000 })
  const onlyShared = !!me.admin && me.doctorId == null
  const [title, setTitle] = useState(t?.title ?? '')
  const [rows, setRows] = useState<Row[]>(() => (t?.steps ?? []).map((s) => ({
    title: s.title, service: s.serviceTypeId != null ? String(s.serviceTypeId) : '', stage: String(s.stage), perTooth: s.perTooth,
  })).concat(t ? [] : [{ title: '', service: '', stage: '1', perTooth: false }]))
  const [shared, setShared] = useState(t ? t.shared : onlyShared)
  const offered = (services.data ?? []).filter((s) => s.active !== false || rows.some((r) => r.service === String(s.id)))
  const save = useMutation<Template, ApiError>({
    mutationFn: () => {
      const body = {
        title: title.trim(),
        steps: rows.filter((r) => r.title.trim()).map((r) => ({
          title: r.title.trim(), serviceTypeId: r.service ? Number(r.service) : undefined, stage: Number(r.stage), perTooth: r.perTooth,
        })),
        shared: shared || onlyShared,
      }
      return t
        ? unwrap(api.PUT('/api/plan-templates/{id}', { params: { path: { id: t.id } }, body }))
        : unwrap(api.POST('/api/plan-templates', { body }))
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['plan-templates'] })
      onDone()
    },
  })
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <form className="form sub-form" aria-label={t ? `Шаблон «${t.title}»` : 'Новый шаблон плана'} onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <label className="field"><span>Название</span>
        <input required maxLength={80} value={title} autoFocus placeholder="например, Имплант под ключ" onChange={(e) => setTitle(e.target.value)} />
      </label>
      <ol className="plan-template-rows" aria-label="Шаги шаблона">
        {rows.map((r, i) => (
          <li key={i} className="plan-template-row">
            <input aria-label={`Шаг ${i + 1}: что сделать`} maxLength={200} value={r.title} placeholder="Что сделать"
              onChange={(e) => set(i, { title: e.target.value })} />
            <Select aria-label={`Шаг ${i + 1}: услуга`} value={r.service} onChange={(e) => {
              const picked = offered.find((s) => String(s.id) === e.target.value)
              set(i, { service: e.target.value, title: r.title.trim() ? r.title : picked?.name ?? r.title })
            }}>
              <option value="">Без услуги</option>
              {offered.map((s) => <option key={s.id} value={String(s.id)}>{s.name}{s.priceSom != null ? ` · ${somText(s.priceSom)}` : ''}</option>)}
            </Select>
            <Select aria-label={`Шаг ${i + 1}: этап`} value={r.stage} onChange={(e) => set(i, { stage: e.target.value })}>
              {STAGES.map((n) => <option key={n} value={String(n)}>Этап {n}</option>)}
            </Select>
            <label className="check"><input type="checkbox" checked={r.perTooth} onChange={(e) => set(i, { perTooth: e.target.checked })} />
              <span>Каждому зубу</span></label>
            <button type="button" className="btn ghost small" aria-label={`Убрать шаг ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
          </li>
        ))}
      </ol>
      <button type="button" className="btn small" disabled={rows.length >= 30}
        onClick={() => setRows([...rows, { title: '', service: '', stage: rows.at(-1)?.stage ?? '1', perTooth: rows.at(-1)?.perTooth ?? false }])}>＋ Шаг</button>
      {me.admin && (
        <label className="check"><input type="checkbox" checked={shared || onlyShared} disabled={onlyShared} onChange={(e) => setShared(e.target.checked)} />
          <span>Общий для клиники — увидят все врачи</span></label>
      )}
      {save.error && <p className="error" role="alert">{errorText(save.error)}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={save.isPending || !title.trim()}>Сохранить</button>
        <button type="button" className="btn ghost" onClick={onDone}>Отмена</button>
      </div>
    </form>
  )
}
