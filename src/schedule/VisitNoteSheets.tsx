import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Sheet } from '../layout/Sheet'
import { Spinner } from '../layout/Loading'
import { shortDate } from '../lib/time'
import { parseTeeth, templateSummary } from './templates'
import { SECTION_TITLE, SECTIONS, type SectionKey, type Sections } from './noteSections'

type Appointment = Schemas['AppointmentView']
type Me = Schemas['BookingViewsMe']
type Template = Schemas['VisitTemplatesView']
type Proposal = Schemas['VisitDictationProposal']

function errorText(e: ApiError | null): string | null {
  if (!e) return null
  return Object.values(e.fieldErrors)[0] ?? e.message
}

/**
 * «📄 Шаблон»: свои шаблоны и общие клиники. Шаблону нужны зубы ({зуб}, состояние, план) — сначала номера
 * зубов; потом сервер собирает предложение, а карточка показывает тот же экран «Проверьте», что у диктовки.
 */
export function TemplateSheet({ appointment: a, onProposal, onClose }: {
  appointment: Appointment
  onProposal: (p: Proposal, title: string) => void
  onClose: () => void
}) {
  const list = useQuery({
    queryKey: ['visit-templates'],
    queryFn: () => unwrap(api.GET('/api/visit-templates')),
  })
  const [picked, setPicked] = useState<Template | null>(null)
  const [teeth, setTeeth] = useState('')
  const proposal = useMutation<Proposal, ApiError, { t: Template; teeth: number[] }>({
    mutationFn: ({ t, teeth: numbers }) => unwrap(api.POST('/api/appointments/{id}/visit-templates/{templateId}/proposal', {
      params: { path: { id: a.id, templateId: t.id } }, body: { teeth: numbers },
    })),
    onSuccess: (p, { t }) => onProposal(p, t.title),
  })
  const choose = (t: Template) => {
    if (t.usesTeeth) setPicked(t)
    else proposal.mutate({ t, teeth: [] })
  }
  const mine = (list.data ?? []).filter((t) => !t.shared)
  const shared = (list.data ?? []).filter((t) => t.shared)
  const numbers = parseTeeth(teeth)
  return (
    <Sheet label="Шаблоны приёма" title={picked ? `Шаблон «${picked.title}»` : 'Шаблон приёма'} onClose={onClose} wide>
      {list.isPending && <Spinner />}
      {list.error && <p className="error" role="alert">{list.error.message}</p>}
      {picked ? (
        <form className="form" onSubmit={(e) => { e.preventDefault(); proposal.mutate({ t: picked, teeth: numbers }) }}>
          <label className="field"><span>Зубы</span>
            <input autoFocus inputMode="numeric" value={teeth} placeholder="например, 36 37" aria-label="Номера зубов"
              onChange={(e) => setTeeth(e.target.value)} />
          </label>
          <p className="hint small">Номера встанут вместо {'{зуб}'} в тексте; состояние и шаги плана — каждому зубу. Без зубов — только текст.</p>
          <div className="confirm-actions">
            <button type="button" className="btn" onClick={() => setPicked(null)}>Назад</button>
            <button type="submit" className="btn primary" disabled={proposal.isPending}>{numbers.length ? 'Применить' : 'Без зубов'}</button>
          </div>
        </form>
      ) : list.isSuccess && (
        list.data.length === 0 ? (
          <p className="hint">Шаблонов пока нет. Напишите заметку и нажмите «Сохранить как шаблон» — или заведите их в «Настройки → Шаблоны и заметка».</p>
        ) : (
          <div className="template-list">
            {[['Мои', mine], ['Общие клиники', shared]].map(([title, items]) => (items as Template[]).length > 0 && (
              <div key={title as string} role="group" aria-label={title as string}>
                <div className="menu-group">{title as string}</div>
                {(items as Template[]).map((t) => (
                  <button key={t.id} type="button" className="template-item" disabled={proposal.isPending} onClick={() => choose(t)}>
                    <b>{t.title}</b>
                    <span className="hint small">{templateSummary(t)}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )
      )}
      {proposal.error && <p className="error" role="alert">{errorText(proposal.error)}</p>}
      {!picked && <p className="hint small"><a href="#/settings/visit-templates" onClick={onClose}>Настроить шаблоны</a></p>}
    </Sheet>
  )
}

/**
 * «Сохранить как шаблон»: текущая (сохранённая) заметка — с разделами — становится шаблоном. Услуга приёма — по
 * галочке. Общий для клиники — только руководитель; у руководителя без кресла личных шаблонов нет.
 */
export function SaveTemplateSheet({ appointment: a, me, note, sections, onSaved, onClose }: {
  appointment: Appointment
  me?: Me
  note: string | null
  sections: Sections | null
  onSaved: (title: string) => void
  onClose: () => void
}) {
  const client = useQueryClient()
  const services = useQuery({
    queryKey: ['service-types'],
    queryFn: () => unwrap(api.GET('/api/service-types')),
    staleTime: 5 * 60_000,
    enabled: !!a.serviceName,
  })
  // Все услуги приёма (шаг 5А), что ещё в прайсе: шаблон запомнит их списком
  const lineIds = (a.services ?? []).map((l) => l.serviceTypeId).filter((id): id is number => id != null)
  const kept = lineIds.length
    ? lineIds.map((id) => services.data?.find((s) => s.id === id && s.active !== false)).filter((s) => s != null)
    : (services.data ?? []).filter((s) => s.name === a.serviceName && s.active !== false).slice(0, 1)
  const service = kept[0]
  const onlyShared = !!me?.admin && me.doctorId == null
  const [title, setTitle] = useState(a.serviceName ?? '')
  const [withService, setWithService] = useState(true)
  const [shared, setShared] = useState(onlyShared)
  const save = useMutation<Template, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/visit-templates', {
      body: {
        title: title.trim(),
        note: note?.trim() || undefined,
        sections: sections ?? undefined,
        serviceTypeId: withService && service ? service.id : undefined,
        serviceTypeIds: withService && kept.length > 1 ? kept.map((s) => s.id) : undefined,
        shared: shared || onlyShared,
      },
    })),
    onSuccess: (t) => {
      void client.invalidateQueries({ queryKey: ['visit-templates'] })
      onSaved(t.title)
    },
  })
  return (
    <Sheet label="Сохранить как шаблон" title="Сохранить как шаблон" onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <label className="field"><span>Название</span>
          <input autoFocus required maxLength={80} value={title} placeholder="например, Кариес — пломба" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <p className="hint small">В шаблон попадёт заметка{sections ? ' с разделами' : ''}. Номера зубов в тексте можно заменить на {'{зуб}'} — потом подставятся выбранные.</p>
        {service && (
          <label className="check"><input type="checkbox" checked={withService} onChange={(e) => setWithService(e.target.checked)} />
            <span>{kept.length > 1 ? `С услугами приёма: ${kept.map((s) => s.name).join(', ')}` : `С услугой приёма: ${service.name}`}</span></label>
        )}
        {me?.admin && (
          <label className="check"><input type="checkbox" checked={shared || onlyShared} disabled={onlyShared} onChange={(e) => setShared(e.target.checked)} />
            <span>Общий для клиники — увидят все врачи</span></label>
        )}
        {save.error && <p className="error" role="alert">{errorText(save.error)}</p>}
        <div className="confirm-actions">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn primary" disabled={save.isPending || !title.trim()}>Сохранить шаблон</button>
        </div>
      </form>
    </Sheet>
  )
}

type Part = { key: string; section: SectionKey | 'other'; text: string }

/** Части прошлой заметки: разделы с текстом; простая заметка — одна часть «Заметка». */
function partsOf(n: Schemas['VisitNoteView']): Part[] {
  if (!n.sections) return n.note?.trim() ? [{ key: `${n.appointmentId}:other`, section: 'other', text: n.note.trim() }] : []
  const keys: (SectionKey | 'other')[] = [...SECTIONS.map(([k]) => k), 'other']
  return keys.filter((k) => (n.sections?.[k] ?? '').trim()).map((k) => ({ key: `${n.appointmentId}:${k}`, section: k, text: n.sections![k]!.trim() }))
}

/**
 * «↩ Из прошлого визита»: прошлые заметки пациента (видны те же, что в «Заметках о визитах» медкарты), галочки
 * по разделам с текстом под ними, «Отметить все / Сбросить». «Вставить» — выбранное дописывается в заметку:
 * раздел — в тот же раздел, простая заметка — текстом.
 */
export function PreviousSheet({ notes, onInsert, onClose }: {
  notes: Schemas['VisitNoteView'][]
  onInsert: (parts: Sections) => void
  onClose: () => void
}) {
  const visits = notes.slice(0, 5).map((n) => ({ n, parts: partsOf(n) })).filter((v) => v.parts.length > 0)
  const all = visits.flatMap((v) => v.parts)
  const [chosen, setChosen] = useState<string[]>([])
  const toggle = (key: string) => setChosen(chosen.includes(key) ? chosen.filter((k) => k !== key) : [...chosen, key])
  const insert = () => {
    const out: Sections = {}
    for (const p of all.filter((x) => chosen.includes(x.key))) {
      out[p.section] = out[p.section] ? `${out[p.section]}\n${p.text}` : p.text
    }
    onInsert(out)
  }
  return (
    <Sheet label="Из прошлого визита" title="Из прошлого визита" onClose={onClose} wide>
      <div className="actions previous-bulk">
        <button type="button" className="btn small" onClick={() => setChosen(all.map((p) => p.key))}>Отметить все</button>
        <button type="button" className="btn small ghost" onClick={() => setChosen([])}>Сбросить</button>
      </div>
      <div className="previous-list">
        {visits.map(({ n, parts }) => (
          <fieldset key={n.appointmentId} className="previous-visit">
            <legend>{n.startAt ? shortDate(n.startAt) : '—'}{n.visitDoctorName ? ` · ${n.visitDoctorName}` : ''}</legend>
            {parts.map((p) => (
              <label key={p.key} className="check previous-part">
                <input type="checkbox" checked={chosen.includes(p.key)} onChange={() => toggle(p.key)}
                  aria-label={`${SECTION_TITLE[p.section]} от ${n.startAt ? shortDate(n.startAt) : ''}`} />
                <span><b>{SECTION_TITLE[p.section]}</b><span className="previous-text">{p.text}</span></span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <div className="confirm-actions">
        <button type="button" className="btn" onClick={onClose}>Отмена</button>
        <button type="button" className="btn primary" disabled={!chosen.length} onClick={insert}>
          {chosen.length ? `Вставить (${chosen.length})` : 'Вставить'}</button>
      </div>
    </Sheet>
  )
}
