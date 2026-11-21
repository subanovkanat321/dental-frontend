import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput, phoneToInput } from '../clinic/phone'
import { useBack } from '../lib/back'
import { ask } from '../lib/confirm'
import { isAssistant } from '../lib/roles'
import { dateOf, formatPhone, minutesOfTime, shortDate, slotInstant, timeOf } from '../lib/time'
import { useDebounced } from '../lib/useDebounced'
import { DateInput } from '../layout/DateInput'
import { EditButton } from '../layout/EditButton'
import { EmptyState } from '../layout/EmptyState'
import { Fold } from '../layout/Fold'
import { Loading } from '../layout/Loading'
import { HeadTools, SubHelp } from '../layout/PageHead'
import { Select } from '../layout/Select'
import { CloseButton } from '../layout/SheetHead'
import { TimeInput } from '../layout/TimeInput'
import { useSwipeDown } from '../layout/useSwipeDown'
import { useAssignees } from '../tasks/api'
import { CalmRow, RowMenu } from './CalmList'
import {
  callbackText, CHANNEL_TITLE, CHANNELS, GROUP_TITLES, groupLeads, quickCallbacks, STATUS_TITLE, useDeleteLead, useLeads, useLeadStatus,
  useSaveLead, type Lead, type LeadChannel,
} from './leadsApi'
import './leads.css'

type Me = Schemas['BookingViewsMe']

/**
 * «Пациенты → Обращения» (шаг 8Б, опыт Dentist Plus): кто позвонил или написал, а записи ещё нет. Сначала — кому
 * перезвонить сегодня (просроченные — красным временем), потом новые, не дозвонились, думают; записанные и отказавшиеся
 * — свёрнуто внизу (30 дней). В строке одна главная кнопка: «Позвонить» — номер набирается, а под строкой сразу итог
 * разговора («Не дозвонились», «Думает — перезвонить …», «Записать», «Отказался»). Карандаш — изменить, «⋯» — удалить.
 * «Записать» — «Новая запись» с именем и номером; после записи обращение «Записан» само (сервер, fromLeadId).
 */
export function LeadsTab({ me, onOpenPatient, onBookLead }: {
  me: Me
  onOpenPatient?: (patientId: number) => void
  onBookLead: (lead: Lead) => void
}) {
  const leads = useLeads(!isAssistant(me))
  const remove = useDeleteLead()
  const [editing, setEditing] = useState<Lead | 'new' | null>(null)
  // Строка, по которой только что нажали «Позвонить»: под ней — итог разговора
  const [calling, setCalling] = useState<number | null>(null)
  const groups = useMemo(() => groupLeads(leads.data ?? []), [leads.data])

  const del = async (lead: Lead) => {
    if (await ask(`Удалить обращение ${lead.fullName ?? formatPhone(lead.phone)}?`, { ok: 'Удалить', danger: true })) remove.mutate(lead.id)
  }
  const row = (l: Lead) => (
    <LeadRow key={l.id} lead={l} calling={calling === l.id} onCall={() => setCalling(l.id)} onDone={() => setCalling(null)}
      onEdit={() => setEditing(l)} onDelete={() => void del(l)} onBook={() => onBookLead(l)} onOpenPatient={onOpenPatient} />
  )

  return (
    <div className="calm-stack leads">
      <SubHelp title="Обращения">Кто позвонил, написал в WhatsApp или Instagram, пришёл сам — а записи ещё нет. «＋ Обращение» — пока человек
        на линии. «Позвонить» — и сразу итог: не дозвонились, думает (когда перезвонить), записать, отказался. После записи обращение
        станет «Записан» само. В назначенное время ответственному придёт напоминание.</SubHelp>
      <HeadTools>
        <button type="button" className="btn primary head-end" onClick={() => setEditing('new')}>＋ Обращение</button>
      </HeadTools>
      {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
      {leads.isPending && <Loading />}
      {leads.error && <p className="error">{leads.error.message}</p>}
      {leads.isSuccess && groups.open.length === 0 && (
        <EmptyState fill={groups.closed.length === 0} title="Открытых обращений нет">
          Позвонили или написали, а записать сразу не вышло? «＋ Обращение» — Tish напомнит перезвонить.
        </EmptyState>
      )}
      {groups.open.map(([group, list]) => (
        <section key={group} className={`calm-day lead-group g-${group}`} aria-label={GROUP_TITLES[group]}>
          <h3>{GROUP_TITLES[group]} <span className="hint">{list.length}</span></h3>
          <ul className="calm-list">{list.map(row)}</ul>
        </section>
      ))}
      {groups.closed.map(([group, list]) => (
        <Fold key={group} title={GROUP_TITLES[group]} meta={list.length} label={`${GROUP_TITLES[group]} — за 30 дней`}>
          <ul className="calm-list">{list.map(row)}</ul>
        </Fold>
      ))}
      {editing && (
        <LeadDialog key={editing === 'new' ? 'new' : editing.id} lead={editing === 'new' ? undefined : editing}
          known={leads.data ?? []} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function LeadRow({ lead: l, calling, onCall, onDone, onEdit, onDelete, onBook, onOpenPatient }: {
  lead: Lead
  calling: boolean
  onCall: () => void
  onDone: () => void
  onEdit: () => void
  onDelete: () => void
  onBook: () => void
  onOpenPatient?: (patientId: number) => void
}) {
  const open = l.status === 'NEW' || l.status === 'NO_ANSWER' || l.status === 'THINKING'
  const who = l.fullName ?? formatPhone(l.phone)
  const sub = [CHANNEL_TITLE[l.channel], l.wish, l.fullName ? formatPhone(l.phone) : null].filter(Boolean).join(' · ')
  const meta = l.status === 'BOOKED'
    ? <span className="calm-meta-strong lead-booked">✅ Записан{l.appointmentAt ? ` ${shortDate(l.appointmentAt, true)}` : ''}</span>
    : l.status === 'REFUSED' ? <span>Отказался{l.refuseReason ? `: ${l.refuseReason}` : ''}</span>
      : l.callbackAt ? <span className={l.overdue ? 'lead-callback overdue' : 'lead-callback'}>перезвонить {callbackText(l.callbackAt)}</span>
        : <span>{STATUS_TITLE[l.status]}{l.status === 'NEW' ? ` · ${callbackText(l.createdAt).replace(/^в /, '')}` : ''}</span>
  return (
    <CalmRow open={onEdit} name={who}
      flags={l.patientId != null && l.patientName ? <button type="button" className="link lead-card-link"
        onClick={() => onOpenPatient?.(l.patientId!)}>карточка</button> : null}
      sub={<>{sub}{!l.mine && <span className="lead-resp"> · {l.responsibleName}</span>}</>}
      meta={meta}
      action={open ? <a className="btn" href={`tel:+${l.phone}`} onClick={onCall} aria-label={`Позвонить: ${who}`}>Позвонить</a> : undefined}
      menu={<>
        <EditButton label={`Изменить обращение: ${who}`} onClick={onEdit} />
        <RowMenu label={`Ещё: ${who}`} items={[
          ...(open ? [{ label: 'Записать', onSelect: onBook }] : []),
          { label: 'Удалить', tone: 'bad' as const, onSelect: onDelete },
        ]} />
      </>}>
      {calling && open ? <CallResult lead={l} onBook={onBook} onClose={onDone} /> : null}
    </CalmRow>
  )
}

/**
 * Итог разговора — сразу под строкой после «Позвонить»: одно нажатие на итог, у «Не дозвонились» и «Думает» — когда
 * перезвонить (быстрые кнопки), у «Отказался» — причина (необязательно).
 */
function CallResult({ lead, onBook, onClose }: { lead: Lead; onBook: () => void; onClose: () => void }) {
  const status = useLeadStatus()
  const [step, setStep] = useState<'pick' | 'NO_ANSWER' | 'THINKING' | 'REFUSED'>('pick')
  const [reason, setReason] = useState('')
  const quick = quickCallbacks()
  const save = (s: 'NO_ANSWER' | 'THINKING' | 'REFUSED', callbackAt?: string) =>
    status.mutate({ id: lead.id, status: s, callbackAt, reason: s === 'REFUSED' ? reason.trim() || undefined : undefined }, { onSuccess: onClose })
  return (
    <div className="lead-result" role="group" aria-label="Чем закончился разговор" data-row-skip>
      <div className="lead-result-head">
        <strong>{step === 'pick' ? 'Чем закончился разговор?' : step === 'REFUSED' ? 'Отказался — почему?' : `${STATUS_TITLE[step]} — когда перезвонить?`}</strong>
        <CloseButton onClick={onClose} />
      </div>
      {step === 'pick' && (
        <div className="chips-pick lead-result-pick">
          <button type="button" className="chip" onClick={() => setStep('NO_ANSWER')}>Не дозвонились</button>
          <button type="button" className="chip" onClick={() => setStep('THINKING')}>Думает — перезвонить…</button>
          <button type="button" className="chip lead-book" onClick={onBook}>Записать</button>
          <button type="button" className="chip" onClick={() => setStep('REFUSED')}>Отказался</button>
        </div>
      )}
      {(step === 'NO_ANSWER' || step === 'THINKING') && (
        <div className="chips-pick lead-result-pick">
          {quick.map((q) => (
            <button key={q.label} type="button" className="chip" disabled={status.isPending}
              onClick={() => save(step, slotInstant(q.date, minutesOfTime(q.time)))}>{q.label}</button>
          ))}
          <button type="button" className="chip" disabled={status.isPending} onClick={() => save(step)}>Не напоминать</button>
        </div>
      )}
      {step === 'REFUSED' && (
        <form className="lead-reason" onSubmit={(e) => { e.preventDefault(); save('REFUSED') }}>
          <input aria-label="Причина отказа" placeholder="Например: дорого, далеко — необязательно" maxLength={300} value={reason} autoFocus
            onChange={(e) => setReason(e.target.value)} />
          <button type="submit" className="btn" disabled={status.isPending}>Сохранить</button>
        </form>
      )}
      {status.error && <p className="error" role="alert">{status.error.message}</p>}
    </div>
  )
}

/**
 * «＋ Обращение» и карандаш: телефон, имя, откуда, что хочет, когда перезвонить, ответственный. Быстро, пока человек на
 * линии: обязательно только номер. Номер совпал с пациентом — «Это …? Связать»; уже есть открытое обращение с этим
 * номером — подсказка. Компьютер — окно по центру, телефон — лист снизу (как «Новая задача»).
 */
export function LeadDialog({ lead, known, onClose }: { lead?: Lead; known: readonly Lead[]; onClose: () => void }) {
  const [phone, setPhone] = useState(phoneToInput(lead?.phone))
  const [name, setName] = useState(lead?.fullName ?? '')
  const [channel, setChannel] = useState<LeadChannel>(lead?.channel ?? 'CALL')
  const [wish, setWish] = useState(lead?.wish ?? '')
  const [date, setDate] = useState(lead?.callbackAt ? dateOf(lead.callbackAt) : '')
  const [time, setTime] = useState(lead?.callbackAt ? timeOf(lead.callbackAt) : '')
  const [responsible, setResponsible] = useState<number | null>(lead?.responsibleId ?? null)
  const [patient, setPatient] = useState<{ id: number; fullName: string } | null>(
    lead?.patientId != null ? { id: lead.patientId, fullName: lead.patientName ?? 'Пациент' } : null)
  const assignees = useAssignees()
  const save = useSaveLead()
  const err = (k: string) => save.error?.fieldErrors[k]
  const quick = quickCallbacks()

  useBack(onClose)
  const box = useRef<HTMLFormElement>(null)
  const phoneScreen = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches
  useSwipeDown(box, phoneScreen ? onClose : null)
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    return () => back?.focus?.()
  }, [])

  // Номер набран целиком — ищем карточку с ним (у семьи номер один — может быть несколько)
  const digits = phoneFromInput(phone).replace(/\D/g, '')
  const search = useDebounced(digits.length >= 9 ? digits.slice(-9) : '')
  const matches = useQuery({
    queryKey: ['patients', 'search', search],
    queryFn: () => unwrap(api.POST('/api/patients/search', { body: { query: search } })),
    enabled: search.length === 9 && !patient,
  })
  const sameLead = digits.length >= 9 ? known.find((k) => k.id !== lead?.id && k.phone.endsWith(digits.slice(-9))
    && (k.status === 'NEW' || k.status === 'NO_ANSWER' || k.status === 'THINKING')) : undefined

  const mine = assignees.data?.find((a) => a.me)
  const chosen = responsible ?? mine?.telegramId ?? ''
  const callbackAt = date ? slotInstant(date, minutesOfTime(time || '10:00')) : undefined

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate({
      id: lead?.id,
      body: {
        phone: phoneFromInput(phone), fullName: name.trim() || undefined, channel, wish: wish.trim() || undefined, callbackAt,
        responsibleId: responsible ?? undefined, patientId: patient?.id,
      },
    }, { onSuccess: onClose })
  }

  return createPortal(
    <div className="ui-select-backdrop confirm-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form ref={box} role="dialog" aria-modal="true" aria-labelledby="lead-dialog-title"
        className={phoneScreen ? 'confirm task-dialog lead-dialog sheet' : 'confirm task-dialog lead-dialog'}
        onSubmit={submit} onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}>
        <div className="lead-dialog-head">
          <h2 id="lead-dialog-title">{lead ? 'Обращение' : 'Новое обращение'}</h2>
          <CloseButton onClick={onClose} />
        </div>
        <div className="field">
          <span>Телефон</span>
          <PhoneInput label="Телефон" value={phone} onChange={(v) => { setPhone(v); if (patient && !lead) setPatient(null) }} />
        </div>
        {err('phone') && <p className="error">{err('phone')}</p>}
        {sameLead && <p className="hint small lead-same">Уже есть обращение с этим номером: {STATUS_TITLE[sameLead.status].toLowerCase()}
          {sameLead.callbackAt ? `, перезвонить ${callbackText(sameLead.callbackAt)}` : ''}.</p>}
        {patient ? (
          <p className="task-patient">Карточка: <strong>{patient.fullName}</strong>{' '}
            <button type="button" className="link" onClick={() => setPatient(null)}>отвязать</button></p>
        ) : matches.data?.length ? (
          <div className="lead-match" role="group" aria-label="Пациент с этим номером">
            <span className="hint small">Есть в базе:</span>
            {matches.data.slice(0, 3).map((p) => (
              <button key={p.id} type="button" className="chip" onClick={() => { setPatient({ id: p.id, fullName: p.fullName }); if (!name.trim()) setName(p.fullName) }}>
                Это {p.fullName}? Связать</button>
            ))}
          </div>
        ) : null}

        <label className="field"><span>Имя <span className="hint">— если назвали</span></span>
          <input value={name} maxLength={200} autoComplete="off" onChange={(e) => setName(e.target.value)} /></label>

        <div className="field">
          <span id="lead-channel-label">Откуда</span>
          <div className="chips-pick" role="group" aria-labelledby="lead-channel-label">
            {CHANNELS.map(([key, title]) => (
              <button key={key} type="button" className="chip" aria-pressed={channel === key} onClick={() => setChannel(key)}>{title}</button>
            ))}
          </div>
        </div>

        <label className="field"><span>Что хочет</span>
          <input value={wish} maxLength={500} autoComplete="off" placeholder="Например: болит зуб, цена импланта" onChange={(e) => setWish(e.target.value)} /></label>
        {err('wish') && <p className="error">{err('wish')}</p>}

        <div className="field">
          <span id="lead-callback-label">Перезвонить</span>
          <div className="chips-pick" role="group" aria-labelledby="lead-callback-label">
            {quick.map((q) => (
              <button key={q.label} type="button" className="chip" aria-pressed={date === q.date && time === q.time}
                onClick={() => { setDate(q.date); setTime(q.time) }}>{q.label}</button>
            ))}
            <button type="button" className="chip" aria-pressed={!date} onClick={() => { setDate(''); setTime('') }}>Не нужно</button>
          </div>
          <div className="row task-due-row">
            <DateInput aria-label="Дата звонка" value={date} placeholder="Дата" onChange={(e) => { setDate(e.target.value); if (!time) setTime('10:00') }} />
            <TimeInput aria-label="Время звонка" value={time} disabled={!date} onChange={setTime} />
          </div>
        </div>

        <label className="field"><span>Ответственный</span>
          <Select value={chosen} onChange={(e) => setResponsible(Number(e.target.value))} disabled={!assignees.data}>
            {(assignees.data ?? []).map((a) => (
              <option key={a.telegramId} value={a.telegramId}>{a.me ? `Я (${a.fullName})` : `${a.fullName} — ${a.role}`}</option>
            ))}
          </Select></label>
        {err('responsibleId') && <p className="error">{err('responsibleId')}</p>}

        {save.error && !Object.keys(save.error.fieldErrors).length && <p className="error" role="alert">{save.error.message}</p>}
        <div className="confirm-actions">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn primary" disabled={save.isPending || digits.length < 9}>{lead ? 'Сохранить' : 'Добавить'}</button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
