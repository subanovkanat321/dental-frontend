import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useAnamnesis } from '../api/anamnesis'
import { MedAlerts } from '../medical/Anamnesis'
import { WaitlistBox } from '../patients/WaitlistTab'
import { agoText } from '../lib/texts'
import { useClose } from '../lib/useClose'
import { addDays, dayTitle, formatPhone, minutesOf, slotInstant, somText, timeOf, todayIn, ZONE } from '../lib/time'
import { CommentEdit, Remind, Reschedule, ServiceEdit, Supplies, VisitNote } from './AppointmentExtras'
import { ContactButtons } from './Contact'
import { DepositBox } from './DepositBox'
import { PaymentBox } from './PaymentBox'
import type { Slot } from './NewAppointmentPanel'
import { statusOf } from './status'
import { refreshAppointmentData, useAppointmentAction } from './useAppointmentAction'
import { canEditDoctor, editableDoctors, isAssistant } from '../lib/roles'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']
type Patient = Schemas['PatientView']
type Status = NonNullable<Schemas['AppointmentRequestsChangeStatus']['status']>

/** День приёма по Бишкеку: 'YYYY-MM-DD'. */
function dateOf(instant: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(instant))
}

/**
 * Карточка приёма — как в прежнем приложении. Заявка: подтвердить, перенести, отклонить. Запись:
 * напомнить, ответ пациента, перенести, «Приём состоялся», неявка или отмена (с «Вернуть»).
 * Состоялся: оплата, связаться, «Записать на следующий визит», «Исправить: неявка». Неявка:
 * связаться, «Записать снова», «Исправить: приём состоялся». Отменён: «Восстановить». Приём
 * коллеги — только посмотреть и позвонить. Удалить запись — админ. Esc — закрыть.
 */
export function AppointmentPanel({ appointment: a, me, onClose, onOpenPatient, onBook, onMedical }: {
  appointment: Appointment
  me: Me
  onClose: () => void
  /** Имя пациента → его карточка в «Пациентах». */
  onOpenPatient?: (patientId: number) => void
  /** «Записать снова» / «на следующий визит» — «Новая запись» на этого пациента. */
  onBook?: (slot: Slot, patient: Patient) => void
  /** «Медкарта и снимки» прямо с приёма — карта зубов, план, анкета, снимки; «Назад» — к приёму. */
  onMedical?: (patient: Patient) => void
}) {
  useClose(onClose)
  const client = useQueryClient()
  const action = useAppointmentAction(a)
  // Какая форма открыта внутри карточки: одна за раз, чтобы карточка не превращалась в анкету
  const [editing, setEditing] = useState<'move' | 'service' | 'comment' | null>(null)
  // Только что отметили неявку или отмену — «Вернуть», как было (сервер проверит версию)
  const [undo, setUndo] = useState<{ label: string; previous: Status } | null>(null)
  const close = () => setEditing(null)
  // После переноса или передачи — что сделать дальше (напомнить заново)
  const [moved, setMoved] = useState('')
  const s = statusOf(a)
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  const doctor = (me.doctors ?? []).find((d) => d.id === a.doctorId)
  const date = a.startAt ? dateOf(a.startAt) : todayIn()
  // «Состоялся» сервер разрешает с дня приёма: будущий приём ещё не мог пройти
  const started = date <= todayIn()
  const future = a.startAt ? new Date(a.startAt) > new Date() : false
  const canEdit = canEditDoctor(me, a.doctorId)
  // Аллергия и важное из анкеты — перед лечением, тому, кто видит медкарту (врач приёма, админ)
  // …и ассистенту этого врача (смотрит медкарту, как сервер — ChartService)
  const clinical = (Boolean(me.admin) && !me.clinic?.independentDoctors) || a.doctorId === me.doctorId
    || Boolean(a.doctorId != null && me.assistantOf?.includes(a.doctorId))
  const anamnesis = useAnamnesis(a.patient?.id, clinical && a.status !== 'CANCELLED')
  const length = a.startAt && a.endAt ? (Date.parse(a.endAt) - Date.parse(a.startAt)) / 60_000 : 30
  const remove = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/appointments/{id}', { params: { path: { id: a.id! } } })),
    onSuccess: () => {
      // С записью удаляются её оплата и долг — «Касса» и отчёт тоже перечитываются
      refreshAppointmentData(client)
      onClose()
    },
  })

  // Удалить насовсем — деньги приёма исчезнут из «Кассы» и отчётов: называем суммы в вопросе
  const money = [
    a.paidSom ? `оплата ${somText(a.paidSom)}` : null,
    a.debtSom ? `долг ${somText(a.debtSom)}` : null,
    a.paidSom == null && a.chargeSom ? `счёт на кассу ${somText(a.chargeSom)}` : null,
    a.depositStatus === 'RECEIVED' && a.depositSom && !a.paidSom ? `предоплата ${somText(a.depositSom)}` : null,
  ].filter(Boolean)
  const removeQuestion = money.length
    ? `Удалить запись насовсем? Вместе с ней исчезнут ${money.join(', ')} — из «Кассы», отчёта и зарплаты. Для обычной отмены есть «Отменить запись».`
    : 'Удалить запись насовсем? Для обычной отмены есть «Отменить запись».'

  const setStatus = (status: Status, opts: { question?: string; undo?: string } = {}) => {
    if (opts.question && !window.confirm(opts.question)) return
    const previous = a.status as Status
    action.mutate({ kind: 'status', body: { version: a.version ?? 0, status } }, {
      onSuccess: () => setUndo(opts.undo ? { label: opts.undo, previous } : null),
    })
  }
  const back = (updated: Appointment) => action.mutate({ kind: 'undo', body: { version: updated.version ?? 0, previousStatus: undo!.previous } },
    { onSuccess: () => setUndo(null) })
  // То же время, что у этого приёма, — если оно ещё не прошло; иначе форма откроется без времени (сетка свободного)
  const bookAgain = (day: string) => {
    if (!a.patient) return
    const minutes = minutesOf(a.startAt!)
    const past = Date.parse(slotInstant(day, minutes)) < Date.now()
    onBook?.({ doctorId: a.doctorId!, date: day, minutes: past ? null : minutes, duration: length }, a.patient)
  }

  return (
    <aside className="panel" aria-label="Карточка приёма">
      <header className="panel-head">
        <div>
          <h2>{timeOf(a.startAt!)}–{timeOf(a.endAt!)}</h2>
          <span className="hint">{dayTitle(date)}{doctors.length > 1 && doctor ? ` · ${doctor.fullName}` : ''}</span>
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      <section>
        {onOpenPatient && a.patient?.id
          ? <button type="button" className="link patient-name" onClick={() => onOpenPatient(a.patient!.id!)}>{a.patient.fullName} ›</button>
          : <strong className="patient-name">{a.patient?.fullName}</strong>}
        {a.patient?.phone && <span className="num">{formatPhone(a.patient.phone)}</span>}
      </section>
      <MedAlerts an={anamnesis.data} compact />
      {clinical && onMedical && a.patient && a.status !== 'CANCELLED' && (
        <button type="button" className="btn" onClick={() => onMedical(a.patient!)}>Карта зубов и план лечения</button>
      )}
      <span className={`chip s-${s.kind}`}><span className="ico" aria-hidden="true">{s.icon}</span>{s.label}</span>
      {a.source === 'PATIENT' && <p className="hint">Запись через бота</p>}
      {a.reminderOpenedAt && a.status === 'SCHEDULED' && <p className="hint">Напоминание отправлено {agoText(a.reminderOpenedAt)}, в {timeOf(a.reminderOpenedAt)}</p>}
      {a.rating != null && (
        <p className="rating" aria-label={`Оценка пациента: ${a.rating} из 5`}>{'★'.repeat(a.rating)}{'☆'.repeat(5 - a.rating)} <span className="hint">оценка пациента</span></p>
      )}
      {a.reviewComment && <blockquote className="review-comment"><span className="hint">Пациент написал:</span><br />{a.reviewComment}</blockquote>}

      {editing === 'service' ? <ServiceEdit appointment={a} onDone={close} prices={!isAssistant(me)} /> : (
        <p className="line-edit">
          <span><span className="hint">Услуга:</span> {a.serviceName ?? '—'}</span>
          {canEdit && a.status !== 'CANCELLED' && <button type="button" className="link" onClick={() => setEditing('service')}>изменить</button>}
        </p>
      )}
      {editing === 'comment' ? <CommentEdit appointment={a} onDone={close} /> : a.comment ? (
        <p className="comment line-edit"><span>{a.comment}</span>
          {canEdit && <button type="button" className="link" onClick={() => setEditing('comment')}>изменить</button>}</p>
      ) : canEdit && a.status !== 'CANCELLED' && (
        <button type="button" className="link" onClick={() => setEditing('comment')}>＋ Комментарий</button>
      )}

      {undo && (
        <div className="undo" role="status">
          <span>{undo.label}</span>
          <button type="button" className="btn small" disabled={action.isPending} onClick={() => back(a)}>Вернуть</button>
        </div>
      )}

      {!canEdit ? (
        <>
          <p className="readonly-note">Это приём коллеги — менять его может врач{doctor?.fullName ? ` (${doctor.fullName})` : ''}, его ассистент, регистратура или администратор.</p>
          <ContactButtons phone={a.patient?.phone} whatsapp={false} />
        </>
      ) : (
        <>
          {a.status === 'REQUESTED' && (
            <div className="actions">
              <button type="button" className="btn primary" disabled={action.isPending} onClick={() => setStatus('SCHEDULED')}>Подтвердить</button>
              <ContactButtons phone={a.patient?.phone} whatsapp={false} />
            </div>
          )}
          {moved && <p className="tone-ok" role="status">{moved}</p>}
          {a.status === 'SCHEDULED' && <Remind appointment={a} />}
          {(a.status === 'REQUESTED' || a.status === 'SCHEDULED') && (editing === 'move'
            ? <Reschedule appointment={a} me={me} onDone={(text) => { close(); setMoved(text ?? '') }} />
            : <button type="button" className="btn" onClick={() => { setMoved(''); setEditing('move') }}>{editableDoctors(me, doctors).length > 1 ? 'Перенести или передать врачу' : 'Перенести'}</button>)}
          {/* Ассистенту деньги не показываем: попросить и отметить предоплату — врач, регистратура, админ */}
          {(a.status === 'REQUESTED' || a.status === 'SCHEDULED') && !isAssistant(me) && <DepositBox key={a.depositStatus ?? 'none'} appointment={a} />}
          {(a.status === 'REQUESTED' || a.status === 'SCHEDULED') && future && a.patient && (
            <div className="sub-form"><WaitlistBox patient={a.patient} me={me} defaultMinutes={length} /></div>
          )}
          {a.status === 'SCHEDULED' && !future && <ContactButtons phone={a.patient?.phone} />}
          {a.status === 'SCHEDULED' && started && (
            <button type="button" className="btn primary" disabled={action.isPending} onClick={() => setStatus('DONE')}>Приём состоялся</button>
          )}

          {a.status === 'CANCELLED' && (
            <>
              {a.depositStatus === 'RECEIVED' && <p className="tone-wait">Предоплата {somText(a.depositSom ?? 0)} получена — верните пациенту или запишите его снова.</p>}
              <p className="hint">Восстановленный приём попросит напомнить пациенту заново.</p>
              <button type="button" className="btn primary" disabled={action.isPending} onClick={() => setStatus('SCHEDULED')}>Восстановить</button>
            </>
          )}

          {a.status === 'DONE' && (
            <>
              {/* Ключ — по самим деньгам: оплата на сервере версию приёма не меняет, а блок после
                  сохранения должен открыться заново («оплачено», а не форма) */}
              {/* Ассистенту деньги не показываем: оплату принимает врач или регистратура */}
              {!isAssistant(me) && <PaymentBox key={[a.id, a.version, a.paidSom, a.chargeSom, a.debtSom, a.dueOn, a.depositStatus].join('-')} appointment={a} me={me} />}
              <ContactButtons phone={a.patient?.phone} />
              {onBook && <button type="button" className="btn primary" onClick={() => bookAgain(addDays(date > todayIn() ? date : todayIn(), 7))}>Записать на следующий визит</button>}
            </>
          )}

          {a.status === 'NO_SHOW' && (
            <>
              <ContactButtons phone={a.patient?.phone} />
              {onBook && <button type="button" className="btn primary" onClick={() => bookAgain(todayIn())}>Записать снова</button>}
              <button type="button" className="btn" disabled={action.isPending} onClick={() => setStatus('DONE')}>Исправить: приём состоялся</button>
            </>
          )}

          {/* Материалы и заметка — у приёма, который идёт или был (как в приложении) */}
          {(a.status === 'DONE' || (a.status === 'SCHEDULED' && started)) && <Supplies appointment={a} />}
          {(a.status === 'DONE' || a.status === 'NO_SHOW' || (a.status === 'SCHEDULED' && started)) && <VisitNote appointment={a} />}

          {/* Опасные — одной группой внизу; неявку и отмену можно «Вернуть» */}
          {(a.status === 'REQUESTED' || a.status === 'SCHEDULED' || a.status === 'DONE' || me.admin) && (
            <div className="danger-zone actions">
              {a.status === 'REQUESTED' && (
                <button type="button" className="btn danger" disabled={action.isPending}
                  onClick={() => setStatus('CANCELLED', { question: 'Отклонить заявку? Пациенту придёт сообщение.', undo: 'Заявка отклонена' })}>Отклонить заявку</button>
              )}
              {a.status === 'SCHEDULED' && started && (
                <button type="button" className="btn danger" disabled={action.isPending} onClick={() => setStatus('NO_SHOW', { undo: 'Отмечено: неявка' })}>Неявка</button>
              )}
              {a.status === 'SCHEDULED' && (
                <button type="button" className="btn danger" disabled={action.isPending}
                  onClick={() => setStatus('CANCELLED', { question: `Отменить запись ${a.patient?.fullName ?? ''}? Время освободится.`, undo: 'Запись отменена' })}>Отменить запись</button>
              )}
              {a.status === 'DONE' && (
                <button type="button" className="btn danger" disabled={action.isPending} onClick={() => setStatus('NO_SHOW', { undo: 'Отмечено: неявка' })}>Исправить: неявка</button>
              )}
              {/* Удалить насовсем (ошибочная или тестовая запись) — только админ; для отмены есть «Отменить» */}
              {me.admin && (
                <button type="button" className="btn danger" disabled={remove.isPending}
                  onClick={() => window.confirm(removeQuestion) && remove.mutate()}>Удалить запись</button>
              )}
            </div>
          )}
        </>
      )}
      {(action.error ?? remove.error) && <p className="error" role="alert">{(action.error ?? remove.error)!.message}</p>}
    </aside>
  )
}
