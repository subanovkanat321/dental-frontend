import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { EmptyState } from '../layout/EmptyState'
import { Loading, Spinner } from '../layout/Loading'
import { Segments } from '../layout/Segments'
import { ask } from '../lib/confirm'
import { PLAN_STATUS, progressText } from '../lib/planStatus'
import { dueText } from '../lib/planSteps'
import { haptic, openLink } from '../lib/telegram'
import { agoText, whatsappUrl } from '../lib/texts'
import { shortDate, somText } from '../lib/time'
import { ContactMenu } from '../schedule/ContactMenu'
import { talkItems, type ContactItem } from '../schedule/contactItems'
import { TaskDialog } from '../tasks/TaskDialog'
import { CalmRow, RowMenu } from './CalmList'
import { continueText, patientsWord } from './dropped'
import { GROUPS } from './groupsModel'

type Me = Schemas['BookingViewsMe']
type Row = Schemas['PlanStatesDropped']
type Patient = Schemas['PatientView']

/** Сколько дней не был: три готовых срока — как просил владелец (30 по умолчанию). */
const PERIODS = ['30', '60', '90'] as const
export type Period = (typeof PERIODS)[number]

const PAGE = 50

/**
 * Карточка «Бросили лечение» вкладки «Позвать снова» (до 2026-11-24 — своя вкладка): план согласован или в работе, впереди ничего не записано, не был больше 30 / 60 / 90
 * дней. Возврат таких пациентов — прямые деньги клиники (идея — воронка «Дошедшие и повторные» у Dentist Plus).
 * Считает и решает, кого кому показать, сервер (PlanStates): врач — своих, регистратура и руководитель — всех.
 * Строка по DESIGN.md (спокойный список): одно действие — «📞 Связаться ▾» (звонок, WhatsApp с готовым текстом), остальное
 * в «⋯»: «Записать», «＋ Задача», «Не напоминать 30 дней», «Отказался от лечения».
 */
export function DroppedList({ me, onOpen, onBook, callAll }: {
  me: Me
  onOpen: (patientId: number) => void
  onBook: (p: Patient) => void
  /** «Позвать всех» — группа «Бросили лечение» на сервере считает 30 дней: кнопка — только на этом сроке */
  callAll: (days: Period) => ReactNode
}) {
  const client = useQueryClient()
  const [days, setDays] = useState<Period>('30')
  const [limit, setLimit] = useState(PAGE)
  const [task, setTask] = useState<Row | null>(null)
  const board = useQuery({
    queryKey: ['dropped', days, limit],
    queryFn: () => unwrap(api.GET('/api/dropped', { params: { query: { days: Number(days), limit } } })),
    placeholderData: keepPreviousData,
  })
  const hide = useMutation<unknown, ApiError, { patientId: number; how: 'snooze' | 'refuse' }>({
    mutationFn: ({ patientId, how }) => unwrap(how === 'snooze'
      ? api.POST('/api/dropped/{patientId}/snooze', { params: { path: { patientId } } })
      : api.POST('/api/dropped/{patientId}/refuse', { params: { path: { patientId } } })),
    onSuccess: (_, { patientId }) => {
      haptic('success')
      void client.invalidateQueries({ queryKey: ['dropped'] })
      void client.invalidateQueries({ queryKey: ['plan', patientId] })
      void client.invalidateQueries({ queryKey: ['comebacks'] })
      void client.invalidateQueries({ queryKey: GROUPS })
    },
    onError: () => haptic('error'),
  })
  const clinic = me.clinic?.brandName || me.clinic?.name
  // Врач в строке — когда врачей больше одного
  const many = (me.doctors ?? []).filter((d) => d.active !== false).length > 1

  if (board.isPending) return <Loading />
  if (board.error) return <p className="error">{board.error.message}</p>
  const rows = board.data.patients ?? []
  const total = board.data.total

  const contacts = (r: Row): ContactItem[] => {
    const talk = talkItems({ phone: r.contactPhone }, { whatsapp: false })
    const phone = r.contactPhone
    return [...talk, ...(phone ? [{
      label: 'WhatsApp: продолжить лечение', group: 'contact' as const, icon: 'whatsapp', hint: 'готовый вежливый текст',
      onSelect: () => openLink(whatsappUrl(phone, continueText(r, clinic))),
    }] : [])]
  }

  return (
    <>
      <div className="cb-tools">
        <Segments label="Не был больше" value={days} onChange={(d) => { setDays(d); setLimit(PAGE) }}
          options={PERIODS.map((d) => ({ value: d, label: `${d} дней`, text: `Не был больше ${d} дней` }))} />
        {total > 0 && (
          <span className="head-note" aria-label="Итого">
            {total} {patientsWord(total)}{board.data.leftSom > 0 && <> · не долечено на <b className="num">{somText(board.data.leftSom)}</b></>}
          </span>
        )}
        {total > 0 && callAll(days)}
      </div>
      {!rows.length ? (
        <EmptyState fill title={`Никто не бросил лечение дольше ${days} дней`}>Здесь появятся те, кто согласился с планом или начал лечение и пропал.</EmptyState>
      ) : (
        <ul className="calm-list" aria-label="Бросили лечение">
          {rows.map((r) => {
            const status = r.status ? PLAN_STATUS[r.status] : null
            const busy = hide.isPending && hide.variables?.patientId === r.patientId
            return (
              <CalmRow key={r.patientId} open={() => onOpen(r.patientId)} name={r.fullName}
                flags={(
                  <>
                    {status && <span className={`chip calm-flag s-${status.tone}`}>{status.label}</span>}
                    {/* Срок несделанного этапа прошёл (V241) — ещё одна причина позвонить */}
                    {r.overdueOn && <span className="chip calm-flag s-bad" title={`Срок этапа: ${dueText(r.overdueOn)}`}>просрочен этап</span>}
                  </>
                )}
                sub={[progressText({ done: r.done, total: r.total }), ...(r.left ?? []).slice(0, 2), many ? r.doctor : null,
                  r.invitedAt ? `звали ${agoText(r.invitedAt)}` : null].filter(Boolean).join(' · ')}
                // Справа — коротко, как в «Позвать снова»: сумма остатка и последний визит (на телефоне — над действием)
                meta={(
                  <>
                    {r.leftSom > 0 && <span className="num calm-meta-strong">{somText(r.leftSom)}</span>}
                    <span>{r.lastVisit ? `был ${shortDate(r.lastVisit)}` : 'ещё не был'}</span>
                  </>
                )}
                action={<ContactMenu items={contacts(r)} />}
                menu={(
                  <RowMenu label={`Ещё: ${r.fullName ?? 'пациент'}`} items={[
                    { label: '＋ Записать', onSelect: () => onBook({ id: r.patientId, fullName: r.fullName ?? '', phone: r.phone, telegram: r.telegram }) },
                    { label: '＋ Задача', onSelect: () => setTask(r) },
                    { label: 'Не напоминать 30 дней', disabled: busy, onSelect: () => hide.mutate({ patientId: r.patientId, how: 'snooze' }) },
                    { label: 'Отказался от лечения', tone: 'bad', disabled: busy, onSelect: () => void ask(
                      `${r.fullName ?? 'Пациент'} отказался от лечения? Статус плана станет «Отказался», из списка уйдёт.`,
                      { ok: 'Отказался' },
                    ).then((ok) => ok && hide.mutate({ patientId: r.patientId, how: 'refuse' })) },
                  ]} />
                )} />
            )
          })}
        </ul>
      )}
      {hide.error && <p className="error" role="alert">{hide.error.message}</p>}
      {rows.length < total && (
        <button type="button" className="btn comeback-more" disabled={board.isFetching} onClick={() => setLimit(limit + PAGE)}>
          {board.isFetching ? <><Spinner />Загрузка…</> : `Показать ещё (${Math.min(PAGE, total - rows.length)} из ${total - rows.length})`}</button>
      )}
      {task && (
        <TaskDialog patient={{ id: task.patientId, fullName: task.fullName ?? 'Пациент' }}
          draft={{ kind: 'TASK', title: 'Позвонить: продолжить лечение по плану' }} onClose={() => setTask(null)} />
      )}
    </>
  )
}
