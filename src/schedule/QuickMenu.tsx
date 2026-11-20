import { useCallback, useEffect, useState } from 'react'

import type { Schemas } from '../api/client'
import { ActionPopup, type ActionItem } from '../layout/ActionMenu'
import { canEditDoctor, editableDoctors, seesMoneyOf } from '../lib/roles'
import { dateOf, timeOf, todayIn } from '../lib/time'
import { contactActionItems } from './contactItems'
import type { Slot } from './NewAppointmentPanel'
import { askPlanDone } from './planDoneStore'
import { ReasonSheet } from './ReasonSheet'
import { marksArrival, nextStep } from './statusOptions'
import { useAppointmentAction } from './useAppointmentAction'
import { useAppointmentContacts } from './useAppointmentContacts'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']

/** Что открыть из меню: карточку приёма (с переносом или оплатой), карточку пациента, новую запись. */
export type QuickHandlers = {
  onOpen: (a: Appointment, intent?: 'move' | 'pay') => void
  onOpenPatient?: (patientId: number) => void
  onBook?: (slot: Slot, patient: Schemas['PatientView']) => void
}

/**
 * Пункты меню быстрых действий на записи — только разрешённые этой роли и статусу, те же действия и проверки, что в
 * карточке приёма (сервер всё равно проверит): следующий шаг (nextStep — как кнопка у пилюли статуса), «Принять оплату»
 * (состоявшийся, не оплачен, деньги этого врача видны), «Связаться» (useAppointmentContacts — как «📞 ▾» карточки),
 * «Перенести», «Записать повторно», карточки пациента и записи, «Неявка» / «Отменить запись» (с причиной — ReasonSheet).
 */
function useQuickItems(a: Appointment, me: Me, h: QuickHandlers, act: {
  step: () => void
  reason: (kind: 'CANCELLED' | 'NO_SHOW') => void
}): ActionItem[] {
  const canEdit = canEditDoctor(me, a.doctorId)
  const date = a.startAt ? dateOf(a.startAt) : todayIn()
  const started = date <= todayIn()
  const ended = a.endAt ? new Date(a.endAt) < new Date() : false
  const step = nextStep(a, { canEdit, started, ended, arrivals: marksArrival(me) })
  const contacts = useAppointmentContacts(a, { canEdit, debtSom: 0 })
  const active = a.status === 'REQUESTED' || a.status === 'SCHEDULED'
  const items: ActionItem[] = []
  if (step) items.push({ label: step.label, icon: step.icon, onSelect: act.step })
  if (a.status === 'DONE' && seesMoneyOf(me, a.doctorId) && a.paidSom == null) {
    items.push({ label: 'Принять оплату', icon: 'pay', onSelect: () => h.onOpen(a, 'pay') })
  }
  items.push(...contactActionItems(contacts.items))
  if (canEdit && active) items.push({ label: 'Перенести', icon: 'move', group: 'Запись', onSelect: () => h.onOpen(a, 'move') })
  if (h.onBook && a.patient && editableDoctors(me, me.doctors ?? []).length > 0) {
    // Тот же врач, если к нему можно записать; день — сегодня или день этой записи, если он впереди; время — в форме
    const doctorId = canEdit ? a.doctorId : editableDoctors(me, (me.doctors ?? []).filter((d) => d.active !== false))[0]?.id
    const length = a.startAt && a.endAt ? (Date.parse(a.endAt) - Date.parse(a.startAt)) / 60_000 : 30
    if (doctorId != null) {
      items.push({ label: 'Записать повторно', icon: 'repeat', group: 'Запись',
        onSelect: () => h.onBook!({ doctorId, date: date > todayIn() ? date : todayIn(), minutes: null, duration: length }, a.patient) })
    }
  }
  if (h.onOpenPatient && a.patient?.id) items.push({ label: 'Открыть карточку пациента', icon: 'user', group: 'Запись', onSelect: () => h.onOpenPatient!(a.patient.id) })
  items.push({ label: 'Открыть запись', icon: 'record', group: 'Запись', onSelect: () => h.onOpen(a) })
  if (canEdit && active) {
    const planned = a.status === 'SCHEDULED'
    if (planned && started) items.push({ label: 'Неявка', icon: 'noshow', danger: true, group: 'Запись', onSelect: () => act.reason('NO_SHOW') })
    items.push({ label: a.status === 'REQUESTED' ? 'Отклонить заявку' : 'Отменить запись', icon: 'cancel', danger: true, group: 'Запись', onSelect: () => act.reason('CANCELLED') })
  }
  return items
}

/**
 * Меню быстрых действий на записи в расписании (2026-11-20, по опыту Dentist Plus): регистратура не открывает
 * карточку ради одного действия. Компьютер — «⋯» на записи или правая кнопка (меню у точки), телефон — долгое
 * нажатие на строку (нижний лист). Меню закрылось, а действие ещё идёт или не удалось — компонент остаётся и
 * показывает ошибку плашкой; удалось — закрывается сам.
 */
export function QuickMenu({ appointment: a, me, at, onClose, ...h }: QuickHandlers & {
  appointment: Appointment
  me: Me
  /** Где открыть (правая кнопка, «⋯»); null — нижний лист (долгое нажатие на телефоне) */
  at: { x: number; y: number } | null
  onClose: () => void
}) {
  const action = useAppointmentAction(a)
  const [menu, setMenu] = useState(true)
  const [reason, setReason] = useState<'CANCELLED' | 'NO_SHOW' | null>(null)
  // Действие отправлено: ждём ответа (своим флагом — статус мутации обновляется не в том же рендере)
  const [busy, setBusy] = useState(false)
  type Action = Parameters<typeof action.mutate>[0]
  const send = (body: Action, after?: () => void) => {
    setBusy(true)
    action.mutate(body, { onSuccess: () => { after?.(); onClose() }, onError: () => setBusy(false) })
  }
  const canEdit = canEditDoctor(me, a.doctorId)
  const date = a.startAt ? dateOf(a.startAt) : todayIn()
  const step = nextStep(a, { canEdit, started: date <= todayIn(), ended: a.endAt ? new Date(a.endAt) < new Date() : false, arrivals: marksArrival(me) })
  const runStep = () => {
    if (!step) return
    if (step.kind === 'confirm') send({ kind: 'status', body: { version: a.version, status: 'SCHEDULED' } })
    if (step.kind === 'arrive') send({ kind: 'arrived', body: { version: a.version, arrived: true } })
    if (step.kind === 'seat') send({ kind: 'inChair', body: { version: a.version, inChair: true } })
    // «Состоялся» — как в карточке: блок «Что сделали сегодня?» ждёт в карточке приёма
    if (step.kind === 'done') send({ kind: 'status', body: { version: a.version, status: 'DONE' } }, () => askPlanDone(a.id))
  }
  const items = useQuickItems(a, me, h, { step: runStep, reason: setReason })
  // Пункт выбран: меню закрывается. Ни действия, ни окна причины — закрываем всё (открыли карточку, позвонили…)
  const closeMenu = useCallback(() => setMenu(false), [])
  useEffect(() => {
    if (!menu && !reason && !busy && !action.error) onClose()
  }, [menu, reason, busy, action.error, onClose])
  const sheet = reason === 'NO_SHOW'
    ? { question: `Отметить неявку: ${a.patient.fullName} не пришёл(ла) на приём? Почему — если знаете:`, ok: 'Отметить неявку' }
    : a.status === 'REQUESTED'
      ? { question: 'Отклонить заявку? Пациенту придёт сообщение. Причина — для отчёта, пациент её не увидит:', ok: 'Отклонить заявку' }
      : { question: `Отменить запись ${a.patient.fullName}? Время освободится. Причина — для отчёта:`, ok: 'Отменить запись' }
  return (
    <>
      {menu && <ActionPopup label={`Действия: ${a.patient.fullName}`} title={`${timeOf(a.startAt)} · ${a.patient.fullName}`} items={items} at={at} onClose={closeMenu} />}
      {reason && (
        <ReasonSheet kind={reason} question={sheet.question} ok={sheet.ok} onClose={() => setReason(null)}
          onPick={(r, note) => {
            const kind = reason
            setReason(null)
            send({ kind: 'status', body: { version: a.version, status: kind, reason: r ?? undefined, reasonNote: note ?? undefined } })
          }} />
      )}
      {action.error && (
        <div className="undo quick-error" role="alert">
          <span>{action.error.message}</span>
          <button type="button" className="btn small" onClick={onClose}>Понятно</button>
        </div>
      )}
    </>
  )
}
