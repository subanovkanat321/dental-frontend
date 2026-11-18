import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import type { Schemas } from '../api/client'
import { useBack } from '../lib/back'
import { canEditDoctor } from '../lib/roles'
import { addDays, todayIn } from '../lib/time'
import { phoneFromInput, phoneToInput } from '../clinic/phone'
import { PhoneInput } from '../clinic/PhoneInput'
import { DateInput } from '../layout/DateInput'
import { DirectoryForm } from '../layout/DirectoryForm'
import { Select } from '../layout/Select'
import { useSwipeDown } from '../layout/useSwipeDown'
import { PatientField, type TaskPatient } from '../tasks/TaskDialog'
import { useLabs, useSaveLab, useSaveOrder, useVisits, type LabKind, type LabOrder } from './api'
import { KINDS, fittingText, seesLabMoney } from './text'
import './lab.css'

type Me = Schemas['BookingViewsMe']

/** Что подставить в новый заказ: из карточки приёма, пациента или этапа плана лечения. */
export type OrderPreset = {
  patient?: TaskPatient
  doctorId?: number
  /** Приём, из которого открыли: если он ещё впереди — это и есть примерка */
  appointment?: { id: number; startAt: string }
  kind?: LabKind
  teeth?: string
}

/**
 * «＋ Заказ в лабораторию» и правка заказа: пациент, врач, работа (вид кнопками и зубы через запятую), лаборатория
 * (из справочника или сразу новая), отправлено и срок готовности (кнопки «через 5 / 7 / 10 дней»), примерка (будущий
 * приём пациента), цена технику (кто видит расходы) и заметка. Компьютер — окно по центру, телефон — лист снизу.
 */
export function LabOrderDialog({ me, order, preset, onClose, onSaved }: {
  me: Me
  order?: LabOrder
  preset?: OrderPreset
  onClose: () => void
  onSaved?: (o: LabOrder) => void
}) {
  const today = todayIn()
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false && canEditDoctor(me, d.id))
  const [patient, setPatient] = useState<TaskPatient | null>(order ? { id: order.patientId, fullName: order.patientName } : preset?.patient ?? null)
  const [doctorId, setDoctorId] = useState<number | ''>(order?.doctorId ?? preset?.doctorId
    ?? (me.doctorId != null && doctors.some((d) => d.id === me.doctorId) ? me.doctorId : doctors.length === 1 ? doctors[0]!.id : ''))
  const [kind, setKind] = useState<LabKind>(order?.kind ?? preset?.kind ?? 'CROWN')
  const [kindNote, setKindNote] = useState(order?.kindNote ?? '')
  const [teeth, setTeeth] = useState(order?.teeth ?? preset?.teeth ?? '')
  const labs = useLabs(Boolean(order))
  const [labId, setLabId] = useState<number | ''>(order?.labId ?? '')
  const [sentOn, setSentOn] = useState(order?.sentOn ?? today)
  const [dueOn, setDueOn] = useState(order?.dueOn ?? addDays(today, 7))
  const futureVisit = preset?.appointment && preset.appointment.startAt > new Date().toISOString() ? preset.appointment.id : undefined
  const [fitting, setFitting] = useState<number | ''>(order?.fittingAppointmentId ?? futureVisit ?? '')
  const [price, setPrice] = useState(order?.priceSom != null ? String(order.priceSom) : '')
  const [note, setNote] = useState(order?.note ?? '')
  const visits = useVisits(patient?.id)
  const save = useSaveOrder()
  const err = (k: string) => save.error?.fieldErrors[k]
  const money = order ? order.canMoney : seesLabMoney(me)
  const fixedPatient = Boolean(order || preset?.patient)
  // Лаборатория одна — сразу она
  const active = (labs.data ?? []).filter((l) => !l.archived || l.id === order?.labId)
  const chosenLab = labId === '' && active.length === 1 ? active[0]!.id : labId

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!patient) return
    save.mutate({
      id: order?.id,
      body: {
        patientId: patient.id, doctorId: doctorId === '' ? undefined : doctorId, labId: chosenLab === '' ? 0 : chosenLab, kind,
        kindNote: kindNote.trim() || undefined, teeth: teeth.trim() || undefined, sentOn, dueOn,
        fittingAppointmentId: fitting === '' ? undefined : fitting,
        priceSom: money && price.trim() ? Number(price) : undefined, note: note.trim() || undefined,
      },
    }, { onSuccess: (o) => { onSaved?.(o); onClose() } })
  }

  return (
    <Sheet title={order ? `Заказ: ${order.work}` : 'Заказ в лабораторию'} onClose={onClose} onSubmit={submit} className="lab-dialog">
      {fixedPatient && patient ? <p className="lab-patient">Пациент: <strong>{patient.fullName}</strong></p> : (
        <PatientField patient={patient} onChange={(p) => { setPatient(p); setFitting('') }} label="Найти пациента для заказа" optional={false} />
      )}
      {err('patientId') && <p className="error">{err('patientId')}</p>}

      {doctors.length > 1 || (doctors.length === 1 && doctorId !== doctors[0]!.id) ? (
        <label className="field"><span>Врач</span>
          <Select value={doctorId} onChange={(e) => setDoctorId(Number(e.target.value))}>
            {doctorId === '' && <option value="">Выберите врача</option>}
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
          </Select></label>
      ) : null}
      {err('doctorId') && <p className="error">{err('doctorId')}</p>}

      <div className="field">
        <span id="lab-kind-label">Работа</span>
        <div className="chips-pick" role="group" aria-labelledby="lab-kind-label">
          {KINDS.map(([k, label]) => (
            <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>
          ))}
        </div>
        <div className="row lab-work-row">
          <input aria-label="Зубы" placeholder="Зубы: 36 или 34, 35, 36" value={teeth} inputMode="numeric" autoComplete="off"
            onChange={(e) => setTeeth(e.target.value)} />
          <input aria-label={kind === 'OTHER' ? 'Какая работа' : 'Уточнение'} placeholder={kind === 'OTHER' ? 'Какая работа' : 'Уточнение: цирконий, временная'}
            value={kindNote} maxLength={80} required={kind === 'OTHER'} onChange={(e) => setKindNote(e.target.value)} />
        </div>
      </div>
      {(err('teeth') ?? err('kindNote') ?? err('kind')) && <p className="error">{err('teeth') ?? err('kindNote') ?? err('kind')}</p>}

      <LabPicker labs={active} value={chosenLab} onChange={setLabId} loading={labs.isPending} />
      {err('labId') && <p className="error">{err('labId')}</p>}

      <div className="row lab-dates">
        <label className="field"><span>Отправили</span>
          <DateInput aria-label="Дата отправки" value={sentOn} max={today} onChange={(e) => setSentOn(e.target.value)} /></label>
        <label className="field"><span>Срок готовности</span>
          <DateInput aria-label="Срок готовности" value={dueOn} min={sentOn} onChange={(e) => setDueOn(e.target.value)} /></label>
      </div>
      <div className="chips-pick lab-quick" role="group" aria-label="Срок за">
        {[5, 7, 10, 14].map((d) => (
          <button key={d} type="button" className="chip" aria-pressed={dueOn === addDays(sentOn, d)} onClick={() => setDueOn(addDays(sentOn, d))}>
            {d === 7 ? 'неделя' : d === 14 ? '2 недели' : `${d} дней`}
          </button>
        ))}
      </div>
      {(err('sentOn') ?? err('dueOn')) && <p className="error">{err('sentOn') ?? err('dueOn')}</p>}

      {patient && (
        <label className="field"><span>Примерка</span>
          <Select value={fitting} onChange={(e) => setFitting(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Ещё не записан</option>
            {order?.fittingAppointmentId && order.fittingAt && !(visits.data ?? []).some((v) => v.appointmentId === order.fittingAppointmentId) && (
              <option value={order.fittingAppointmentId}>{fittingText(order.fittingAt)}</option>
            )}
            {(visits.data ?? []).map((v) => (
              <option key={v.appointmentId} value={v.appointmentId}>{fittingText(v.startAt)} — {v.doctorName}</option>
            ))}
          </Select></label>
      )}
      {err('fittingAppointmentId') && <p className="error">{err('fittingAppointmentId')}</p>}

      {money && (
        <label className="field"><span>Цена технику, сом <span className="hint">— необязательно</span></span>
          <input inputMode="numeric" value={price} disabled={Boolean(order?.paid)} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))}
            title={order?.paid ? 'Уже оплачено — сначала отмените оплату' : undefined} /></label>
      )}
      {err('priceSom') && <p className="error">{err('priceSom')}</p>}

      <label className="field"><span>Заметка <span className="hint">— необязательно</span></span>
        <textarea value={note} rows={2} maxLength={1000} placeholder="Цвет A2, слепок верх" onChange={(e) => setNote(e.target.value)} /></label>

      {save.error && !Object.keys(save.error.fieldErrors).length && <p className="error" role="alert">{save.error.message}</p>}
      <div className="confirm-actions">
        <button type="button" className="btn" onClick={onClose}>Отмена</button>
        <button type="submit" className="btn primary" disabled={save.isPending || !patient || chosenLab === '' || (kind === 'OTHER' && !kindNote.trim())}>
          {order ? 'Сохранить' : 'Создать заказ'}
        </button>
      </div>
    </Sheet>
  )
}

/** Лаборатория: список клиники и «＋ Новая» — название и телефон техника прямо здесь. */
function LabPicker({ labs, value, onChange, loading }: {
  labs: Schemas['LabView'][]
  value: number | ''
  onChange: (id: number) => void
  loading: boolean
}) {
  const [adding, setAdding] = useState(false)
  const showForm = adding || (!loading && labs.length === 0)
  return (
    <div className="field">
      <span>Лаборатория</span>
      {!showForm ? (
        <div className="row lab-picker">
          <Select aria-label="Лаборатория" value={value} onChange={(e) => onChange(Number(e.target.value))}>
            {value === '' && <option value="">Выберите</option>}
            {labs.map((l) => <option key={l.id} value={l.id}>{l.name}{l.archived ? ' (убрана)' : ''}</option>)}
          </Select>
          <button type="button" className="btn small" onClick={() => setAdding(true)}>＋ Новая</button>
        </div>
      ) : (
        <LabForm primary={false} onSaved={(l) => { onChange(l.id); setAdding(false) }} onCancel={labs.length ? () => setAdding(false) : undefined} />
      )}
    </div>
  )
}

/**
 * Новая лаборатория (или правка): название, телефон техника и WhatsApp — если на другом номере. Телефоны —
 * стандартным полем (+996 и страна, как у пациента); на сервер — как набрано, нормализует он.
 * @param primary «Добавить» залитой: в справочнике да, внутри «Заказа в лабораторию» — нет (там главная «Создать заказ»)
 */
export function LabForm({ lab, onSaved, onCancel, primary = true }: {
  lab?: Schemas['LabView']
  onSaved: (l: Schemas['LabView']) => void
  onCancel?: () => void
  primary?: boolean
}) {
  const [name, setName] = useState(lab?.name ?? '')
  const [phone, setPhone] = useState(phoneToInput(lab?.phone))
  const [whatsapp, setWhatsapp] = useState(phoneToInput(lab?.whatsapp))
  const save = useSaveLab()
  const err = (k: string) => save.error?.fieldErrors[k]
  const other = save.error && !err('name') && !err('phone') && !err('whatsapp') ? Object.values(save.error.fieldErrors)[0] ?? save.error.message : null
  return (
    <DirectoryForm label={lab ? `Лаборатория ${lab.name}` : 'Новая лаборатория'} saveText={lab ? 'Сохранить' : 'Добавить лабораторию'}
      canSave={Boolean(name.trim())} busy={save.isPending} error={other} onCancel={onCancel} primary={primary}
      onSave={() => save.mutate({
        id: lab?.id,
        body: { name: name.trim(), phone: phoneFromInput(phone) || undefined, whatsapp: phoneFromInput(whatsapp) || undefined },
      }, { onSuccess: onSaved })}>
      <label className="field"><span>Название</span>
        <input value={name} maxLength={80} autoComplete="off" placeholder="Например: Дент-Лаб" onChange={(e) => setName(e.target.value)} /></label>
      {err('name') && <p className="error">{err('name')}</p>}
      <label className="field"><span>Телефон техника <span className="hint">— необязательно</span></span>
        <PhoneInput label="Телефон техника" value={phone} onChange={setPhone} /></label>
      {err('phone') && <p className="error">{err('phone')}</p>}
      <label className="field"><span>WhatsApp <span className="hint">— если на другом номере</span></span>
        <PhoneInput label="WhatsApp техника" value={whatsapp} onChange={setWhatsapp} /></label>
      {err('whatsapp') && <p className="error">{err('whatsapp')}</p>}
    </DirectoryForm>
  )
}

/** Окно по центру (компьютер) или лист снизу (телефон), как «Новая задача». */
export function Sheet({ title, onClose, onSubmit, className, children }: {
  title: string
  onClose: () => void
  onSubmit: (e: FormEvent) => void
  className?: string
  children: ReactNode
}) {
  useBack(onClose)
  const box = useRef<HTMLFormElement>(null)
  const phone = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches
  useSwipeDown(box, phone ? onClose : null)
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    return () => back?.focus?.()
  }, [])
  const id = `sheet-${className ?? 'x'}`
  return createPortal(
    <div className="ui-select-backdrop confirm-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form ref={box} role="dialog" aria-modal="true" aria-labelledby={id} className={['confirm', 'lab-sheet', className, phone && 'sheet'].filter(Boolean).join(' ')}
        onSubmit={onSubmit} onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}>
        <h2 id={id}>{title}</h2>
        {children}
      </form>
    </div>,
    document.body,
  )
}
