import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { DiagnosisPicker } from '../schedule/DiagnosisPicker'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Select } from '../layout/Select'
import { ask } from '../lib/confirm'
import { TOOTH_STATES, type ToothState } from '../medical/toothStates'
import { cleanSections, hasText, SECTIONS, type Sections } from '../schedule/noteSections'
import { templateSummary } from '../schedule/templates'
import { SubHeader } from './SubHeader'

type Me = Schemas['BookingViewsMe']
type Template = Schemas['VisitTemplatesView']

function errorText(e: ApiError | null): string | null {
  if (!e) return null
  return Object.values(e.fieldErrors)[0] ?? e.message
}

/**
 * «Настройки → Шаблоны и заметка» (шаг 2, опыт Dentist Plus): переключатель «Разделы заметки» (руководитель) и шаблоны
 * приёма — свои (врач) и общие клиники (заводит руководитель): изменить, переименовать, удалить. Применяют шаблон в
 * карточке приёма («📄 Шаблон»), сохраняют туда же — «Сохранить как шаблон».
 */
export function VisitTemplatesPage({ me, onBack }: { me: Me; onBack: () => void }) {
  const list = useQuery({ queryKey: ['visit-templates'], queryFn: () => unwrap(api.GET('/api/visit-templates')) })
  const [editing, setEditing] = useState<Template | 'new' | null>(null)
  const mine = (list.data ?? []).filter((t) => !t.shared)
  const shared = (list.data ?? []).filter((t) => t.shared)
  return (
    <section className="schedule-main visit-templates-page">
      <SubHeader title="Шаблоны и заметка" onBack={onBack} />
      {me.admin && <SectionsSwitch />}
      <section className="card-block" aria-label="Шаблоны приёма">
        <h2>Шаблоны приёма</h2>
        <p className="hint small">Заполняют заметку (и её разделы), услугу приёма, состояние зубов и шаги плана — в карточке приёма «📄 Шаблон».
          {' {зуб}'} в тексте — номера выбранных зубов.</p>
        {list.error && <p className="error" role="alert">{list.error.message}</p>}
        {editing === 'new' ? <TemplateForm me={me} onDone={() => setEditing(null)} />
          : <button type="button" className="btn" onClick={() => setEditing('new')}>＋ Новый шаблон</button>}
        {list.isSuccess && list.data.length === 0 && editing !== 'new' && (
          <p className="hint">Шаблонов пока нет. Проще всего — в карточке приёма: напишите заметку и нажмите «Сохранить как шаблон».</p>
        )}
        {[['Мои', mine], ['Общие клиники', shared]].map(([title, items]) => (items as Template[]).length > 0 && (
          <div key={title as string} className="template-group" role="group" aria-label={title as string}>
            <h3>{title as string}</h3>
            <ul className="visits">
              {(items as Template[]).map((t) => (
                <li key={t.id} className="template-row">
                  {editing !== 'new' && editing?.id === t.id ? <TemplateForm me={me} template={t} onDone={() => setEditing(null)} /> : (
                    <>
                      <span><b>{t.title}</b><br /><span className="hint small">{templateSummary(t)}</span></span>
                      {t.editable && <TemplateActions template={t} onEdit={() => setEditing(t)} />}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </section>
  )
}

function SectionsSwitch() {
  const client = useQueryClient()
  const setting = useQuery({ queryKey: ['note-sections'], queryFn: () => unwrap(api.GET('/api/clinic/note-sections')) })
  const turn = useMutation<Schemas['ChartControllerSectionsSetting'], ApiError, boolean>({
    mutationFn: (on) => unwrap(api.PUT('/api/clinic/note-sections', { body: { on } })),
    onSuccess: (now) => {
      client.setQueryData(['note-sections'], now)
      void client.invalidateQueries({ queryKey: ['note'] })
    },
  })
  return (
    <section className="card-block" aria-label="Разделы заметки">
      <label className="check">
        <input type="checkbox" checked={Boolean(setting.data?.on)} disabled={!setting.isSuccess || turn.isPending}
          onChange={(e) => turn.mutate(e.target.checked)} /> <strong>Разделы заметки</strong>
      </label>
      <p className="hint small">Заметка о приёме — разделами: Жалобы · Объективно · Диагноз · Лечение · Рекомендации. Пустые разделы не занимают места.
        ИИ раскладывает диктовку по разделам, а «Лечение» и «Рекомендации» попадают в сообщение пациенту после приёма.
        Старые заметки остаются как были. Выключено — одно поле, как раньше.</p>
      {turn.error && <p className="error small" role="alert">{turn.error.message}</p>}
    </section>
  )
}

function TemplateActions({ template: t, onEdit }: { template: Template; onEdit: () => void }) {
  const client = useQueryClient()
  const remove = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/visit-templates/{id}', { params: { path: { id: t.id } } })),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['visit-templates'] }),
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

/** Новый или изменить: название, текст (или разделы), состояние зубов, шаги плана, услуга, «общий». */
function TemplateForm({ me, template: t, onDone }: { me: Me; template?: Template; onDone: () => void }) {
  const client = useQueryClient()
  const services = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')), staleTime: 5 * 60_000 })
  const onlyShared = !!me.admin && me.doctorId == null
  const [title, setTitle] = useState(t?.title ?? '')
  const [note, setNote] = useState(t?.note ?? '')
  const [sections, setSections] = useState<Sections>(t?.sections ?? {})
  const [withSections, setWithSections] = useState(!!t?.sections)
  const [state, setState] = useState<ToothState | ''>(t?.toothState ?? '')
  const [plan, setPlan] = useState((t?.plan ?? []).join('\n'))
  const [service, setService] = useState<number | ''>(t?.serviceTypeId ?? '')
  const [shared, setShared] = useState(t ? t.shared : onlyShared)
  const save = useMutation<Template, ApiError>({
    mutationFn: () => {
      const body = {
        title: title.trim(),
        note: note.trim() || undefined,
        sections: withSections && hasText(cleanSections(sections)) ? cleanSections(sections) : undefined,
        toothState: state || undefined,
        plan: plan.split('\n').map((s) => s.trim()).filter(Boolean),
        serviceTypeId: service === '' ? undefined : service,
        shared: shared || onlyShared,
      }
      return t
        ? unwrap(api.PUT('/api/visit-templates/{id}', { params: { path: { id: t.id } }, body }))
        : unwrap(api.POST('/api/visit-templates', { body }))
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['visit-templates'] })
      onDone()
    },
  })
  const offered = (services.data ?? []).filter((s) => s.active !== false || s.id === t?.serviceTypeId)
  return (
    <form className="form sub-form" aria-label={t ? `Шаблон «${t.title}»` : 'Новый шаблон'} onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <label className="field"><span>Название</span>
        <input required maxLength={80} value={title} autoFocus placeholder="например, Кариес — пломба" onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field"><span>Текст заметки</span>
        <textarea rows={3} maxLength={2000} value={note} placeholder="Кариес {зуб}, пломба светоотверждаемая" onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="check"><input type="checkbox" checked={withSections} onChange={(e) => setWithSections(e.target.checked)} />
        <span>Разделы заметки (Жалобы, Лечение, Рекомендации…)</span></label>
      {withSections && SECTIONS.map(([k, label]) => k === 'diagnosis' ? (
        // Диагноз шаблона (шаг 3): код МКБ ляжет на каждый зуб, выбранный при применении шаблона
        <div key={k} className="field" role="group" aria-label="Диагноз"><span>{label}</span>
          <DiagnosisPicker noTooth codes={sections.diagnosisCodes ?? []} text={sections.diagnosis ?? ''}
            onCodes={(codes) => setSections((x) => ({ ...x, diagnosisCodes: codes }))} onText={(v) => setSections((x) => ({ ...x, diagnosis: v }))} />
        </div>
      ) : (
        <label key={k} className="field"><span>{label}</span>
          <textarea rows={1} maxLength={2000} value={sections[k] ?? ''} onChange={(e) => setSections({ ...sections, [k]: e.target.value })} />
        </label>
      ))}
      <div className="row">
        <label className="field"><span>Зубам — состояние</span>
          <Select value={state} onChange={(e) => setState(e.target.value as ToothState | '')}>
            <option value="">Не менять</option>
            {Object.entries(TOOTH_STATES).map(([k, [label, icon]]) => <option key={k} value={k}>{`${icon} ${label}`}</option>)}
          </Select>
        </label>
        <label className="field"><span>Услуга приёма</span>
          <Select value={service} onChange={(e) => setService(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Не менять</option>
            {offered.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </label>
      </div>
      <label className="field"><span>Шаги плана — по одному в строке</span>
        <textarea rows={2} value={plan} placeholder="Контроль {зуб} через полгода" onChange={(e) => setPlan(e.target.value)} />
      </label>
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
