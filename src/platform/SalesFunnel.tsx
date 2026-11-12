import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput } from '../clinic/phone'
import { Select } from '../layout/Select'
import { Loading } from '../layout/Loading'
import { formatPhone, shortDate, todayIn } from '../lib/time'

type Lead = Schemas['SalesFunnelLead']
type Stage = NonNullable<Lead['stage']>

/** Этапы воронки по порядку; «Отказ» — отдельно, в конце. */
const STAGES: [Stage, string][] = [['LEAD', 'Заявка'], ['CONTACTED', 'Связались'], ['DEMO', 'Демо показали'],
  ['TRIAL', 'Пробный период'], ['PAYING', 'Платит'], ['LOST', 'Отказ']]
const STAGE_TEXT = Object.fromEntries(STAGES) as Record<Stage, string>

/** 2026-11-12 → «12.11». */
function dayText(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`
}

/**
 * «Воронка продаж»: заявки с /join и клиники, внесённые вручную, по этапам «Заявка → Связались → Демо
 * показали → Пробный период → Платит» (или «Отказ»). Сверху — счётчики: сколько сейчас на этапе и сколько
 * дошло до него (конверсия от всех лидов). У лида — заметка и следующий шаг с датой; о сегодняшних шагах
 * бот напоминает владельцу утром.
 */
export function SalesFunnel() {
  const [stage, setStage] = useState<Stage | null>(null)
  const funnel = useQuery({
    queryKey: ['platform-funnel', stage ?? 'ALL'],
    // Другой этап — прежний список, пока грузится: переключатель этапов не мигает
    queryFn: () => unwrap(api.GET('/api/platform/funnel', { params: { query: stage ? { stage } : {} } })),
    placeholderData: keepPreviousData,
  })
  const [adding, setAdding] = useState(false)
  const data = funnel.data
  const today = todayIn()
  return (
    <section className="card-block" aria-label="Воронка продаж">
      <h2>Воронка продаж</h2>
      {funnel.error && <p className="error">{funnel.error.message}</p>}
      {funnel.isPending ? <Loading /> : data && (
        <>
          <div className="segments tabs" role="group" aria-label="Этап">
            <button type="button" aria-pressed={stage == null} onClick={() => setStage(null)}>Все · {data.total}</button>
            {(data.stages ?? []).map((s) => (
              <button key={s.stage} type="button" aria-pressed={stage === s.stage} onClick={() => setStage(s.stage!)}
                title={s.stage === 'LOST' ? `Отказались: ${s.conversion}%` : `Дошли до этапа: ${s.reached} (${s.conversion}%)`}>
                {STAGE_TEXT[s.stage!]} · <b className="num">{s.current}</b>
                {s.stage !== 'LEAD' && <span className="hint"> {s.conversion}%</span>}
              </button>
            ))}
          </div>
          <p className="hint">Число — сколько сейчас на этапе; % — сколько лидов дошли до этапа хоть раз.</p>
          {(data.leads ?? []).length === 0 ? <p className="hint">Здесь пока никого.</p>
            : <div role="list" className="funnel-list">{data.leads!.map((l) => <LeadCard key={l.id} lead={l} today={today} />)}</div>}
        </>
      )}
      {adding ? <NewLead onDone={() => setAdding(false)} /> : <button type="button" className="btn" onClick={() => setAdding(true)}>+ Добавить клинику в воронку</button>}
    </section>
  )
}

function LeadCard({ lead: l, today }: { lead: Lead; today: string }) {
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [stage, setStage] = useState<Stage>(l.stage ?? 'LEAD')
  const [note, setNote] = useState(l.note ?? '')
  const [nextStep, setNextStep] = useState(l.nextStep ?? '')
  const [nextStepOn, setNextStepOn] = useState(l.nextStepOn ?? '')
  const save = useMutation<Lead, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/platform/funnel/{id}', {
      params: { path: { id: l.id } },
      body: { stage, note: note || undefined, nextStep: nextStep || undefined, nextStepOn: nextStepOn || undefined },
    })),
    onSuccess: () => {
      setEditing(false)
      void client.invalidateQueries({ queryKey: ['platform-funnel'] })
      void client.invalidateQueries({ queryKey: ['platform-applications'] })
    },
  })
  const late = l.nextStepOn && l.nextStepOn < today
  const due = l.nextStepOn && l.nextStepOn <= today && l.stage !== 'PAYING' && l.stage !== 'LOST'
  return (
    <div role="listitem" className="sub-form form" aria-label={`Лид: ${l.clinicName}`}>
      <strong>{l.clinicName} <span className="chip small s-quiet">{STAGE_TEXT[l.stage!]}</span></strong>
      <span className="hint">{[l.city, l.contactName, l.stageAt ? `этап с ${shortDate(l.stageAt)}` : null].filter(Boolean).join(' · ')}
        {l.phone && <> · <a href={`tel:+${l.phone}`}>{formatPhone(l.phone)}</a></>}</span>
      {l.nextStep && <span className={due ? (late ? 'tone-bad' : 'tone-wait') : undefined}>
        Дальше: {l.nextStep} {l.nextStepOn && `· ${dayText(l.nextStepOn)}`}{late ? ' (просрочено)' : due ? ' (сегодня)' : ''}</span>}
      {l.note && !editing && <span className="hint">{l.note}</span>}
      {editing ? (
        <form className="form" aria-label={`Этап: ${l.clinicName}`} onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <label className="field"><span>Этап</span>
            <Select value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
              {STAGES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </Select></label>
          <label className="field"><span>Заметка</span><textarea value={note} maxLength={1000} rows={2} onChange={(e) => setNote(e.target.value)} /></label>
          <label className="field"><span>Следующий шаг</span>
            <input value={nextStep} maxLength={200} placeholder="позвонить" onChange={(e) => setNextStep(e.target.value)} /></label>
          <label className="field"><span>Когда</span><input type="date" value={nextStepOn} onChange={(e) => setNextStepOn(e.target.value)} /></label>
          {save.error && <p className="error" role="alert">{save.error.fieldErrors.nextStepOn ?? save.error.fieldErrors.nextStep ?? save.error.message}</p>}
          <div className="actions">
            <button type="submit" className="btn primary" disabled={save.isPending}>Сохранить</button>
            <button type="button" className="btn ghost" onClick={() => setEditing(false)}>Отмена</button>
          </div>
        </form>
      ) : <div className="actions"><button type="button" className="btn" onClick={() => setEditing(true)}>Изменить этап и шаг</button></div>}
    </div>
  )
}

function NewLead({ onDone }: { onDone: () => void }) {
  const client = useQueryClient()
  const [clinicName, setClinicName] = useState('')
  const [contactName, setContactName] = useState('')
  const [phone, setPhone] = useState('')
  const [nextStep, setNextStep] = useState('')
  const [nextStepOn, setNextStepOn] = useState('')
  const add = useMutation<Lead, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/funnel', {
      body: { clinicName, contactName, phone: phoneFromInput(phone), stage: 'CONTACTED', nextStep: nextStep || undefined, nextStepOn: nextStepOn || undefined },
    })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['platform-funnel'] })
      onDone()
    },
  })
  const f = add.error?.fieldErrors ?? {}
  return (
    <form className="form narrow sub-form" aria-label="Новая клиника в воронке" onSubmit={(e) => { e.preventDefault(); add.mutate() }}>
      <label className="field"><span>Клиника</span><input value={clinicName} required maxLength={100} onChange={(e) => setClinicName(e.target.value)} /></label>
      {f.clinicName && <p className="error">{f.clinicName}</p>}
      <label className="field"><span>Контакт</span><input value={contactName} required maxLength={100} onChange={(e) => setContactName(e.target.value)} /></label>
      {f.contactName && <p className="error">{f.contactName}</p>}
      <label className="field"><span>Телефон</span><PhoneInput label="Телефон" value={phone} onChange={setPhone} /></label>
      {f.phone && <p className="error">{f.phone}</p>}
      <label className="field"><span>Следующий шаг</span><input value={nextStep} maxLength={200} placeholder="позвонить" onChange={(e) => setNextStep(e.target.value)} /></label>
      <label className="field"><span>Когда</span><input type="date" value={nextStepOn} onChange={(e) => setNextStepOn(e.target.value)} /></label>
      {(f.nextStepOn || (add.error && !Object.keys(f).length)) && <p className="error" role="alert">{f.nextStepOn ?? add.error?.message}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={add.isPending}>Добавить</button>
        <button type="button" className="btn ghost" onClick={onDone}>Отмена</button>
      </div>
    </form>
  )
}
