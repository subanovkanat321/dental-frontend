import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { dayTitle, formatPhone, slotInstant } from '../lib/time'

type Me = Schemas['BookingViewsMe']
type Patient = Schemas['PatientView']
type Appointment = Schemas['AppointmentView']

const DURATIONS = [15, 30, 45, 60, 90, 120]

/** Слот, на который нажали: врач, день и минуты от полуночи по Бишкеку. */
export type Slot = { doctorId: number; date: string; minutes: number }

function timeText(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** Пауза перед поиском: не дёргать сервер на каждую букву. */
function useDebounced(value: string, ms = 300): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

/**
 * «Новая запись» справа: нажали на пустое место в колонке врача — время уже стоит (кратно 15
 * минутам). Пациента — найти по имени или номеру, или завести нового (+996). Занятое время
 * не пустит база (appointment_no_overlap → 409): показываем её ответ.
 */
export function NewAppointmentPanel({ slot, me, onClose, onCreated }: {
  slot: Slot
  me: Me
  onClose: () => void
  onCreated: (a: Appointment) => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const client = useQueryClient()
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  const [doctorId, setDoctorId] = useState(slot.doctorId)
  const [time, setTime] = useState(timeText(slot.minutes))
  const [duration, setDuration] = useState(30)
  const [serviceId, setServiceId] = useState<number | ''>('')
  const [comment, setComment] = useState('')
  const [patient, setPatient] = useState<Patient | null>(null)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [duplicate, setDuplicate] = useState<Patient | null>(null)
  const [problem, setProblem] = useState('')

  // Новый слот (нажали в другое место) — новое время и врач, введённое о пациенте остаётся.
  // Меняем состояние прямо при отрисовке, а не в эффекте: React перерисует сразу, без мигания
  const [shown, setShown] = useState(slot)
  if (shown !== slot) {
    setShown(slot)
    setDoctorId(slot.doctorId)
    setTime(timeText(slot.minutes))
  }

  const services = useQuery({
    queryKey: ['service-types'],
    queryFn: () => unwrap(api.GET('/api/service-types')),
    staleTime: 5 * 60_000,
    select: (list) => list.filter((s) => s.active !== false),
  })

  const search = useDebounced(query.trim())
  const found = useQuery({
    queryKey: ['patients', 'search', search],
    queryFn: () => unwrap(api.POST('/api/patients/search', { body: { query: search } })),
    enabled: search.length >= 2 && !patient,
  })

  const createPatient = useMutation<Patient, ApiError, { allowDuplicate: boolean }>({
    mutationFn: ({ allowDuplicate }) => unwrap(api.POST('/api/patients', {
      body: { fullName: name.trim(), phone: `+996${phone.replace(/\D/g, '')}`, allowDuplicate },
    })),
  })

  const create = useMutation<Appointment, ApiError, Patient>({
    mutationFn: (p) => {
      const [h, m] = time.split(':').map(Number)
      return unwrap(api.POST('/api/appointments', {
        body: {
          doctorId,
          patientId: p.id!,
          startAt: slotInstant(slot.date, (h ?? 0) * 60 + (m ?? 0)),
          durationMinutes: duration,
          serviceTypeId: serviceId === '' ? undefined : serviceId,
          comment: comment.trim() || undefined,
        },
      }))
    },
    onSuccess: (a) => {
      void client.invalidateQueries({ queryKey: ['appointments'] })
      onCreated(a)
    },
  })

  const submit = async (e: FormEvent, allowDuplicate = false) => {
    e.preventDefault()
    setProblem('')
    create.reset()
    let who = patient
    if (!who) {
      if (!adding) {
        setProblem('Выберите пациента или добавьте нового')
        return
      }
      try {
        who = await createPatient.mutateAsync({ allowDuplicate })
        setDuplicate(null)
      } catch (error) {
        // Номер уже есть — скорее всего, тот же человек: предлагаем выбрать его (D19 бэкенда)
        if (error instanceof ApiError && error.code === 'duplicate-patient') {
          setDuplicate((error.problem.patient as Patient | undefined) ?? null)
        }
        return
      }
      setPatient(who)
      setAdding(false)
    }
    create.mutate(who)
  }

  const fieldError = (field: string) =>
    create.error?.fieldErrors[field] ?? createPatient.error?.fieldErrors[field]
  const error = problem
    || (create.error && !create.error.fieldErrors.startAt && create.error.message)
    || (createPatient.error && !Object.keys(createPatient.error.fieldErrors).length && createPatient.error.code !== 'duplicate-patient'
      && createPatient.error.message)
  const busy = create.isPending || createPatient.isPending

  return (
    <aside className="panel" aria-label="Новая запись">
      <header className="panel-head">
        <div>
          <h2>Новая запись</h2>
          <span className="hint">{dayTitle(slot.date)}</span>
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <div className="row">
          <label className="field">
            <span>Время</span>
            <input type="time" step={900} value={time} required onChange={(e) => setTime(e.target.value)} />
          </label>
          <label className="field">
            <span>Длительность</span>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {[...new Set([...DURATIONS, duration])].sort((x, y) => x - y).map((d) => <option key={d} value={d}>{d} мин</option>)}
            </select>
          </label>
        </div>
        {fieldError('startAt') && <p className="error">{fieldError('startAt')}</p>}
        <label className="field">
          <span>Врач</span>
          <select value={doctorId} onChange={(e) => setDoctorId(Number(e.target.value))}>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
          </select>
        </label>

        <fieldset className="field">
          <legend>Пациент</legend>
          {patient ? (
            <div className="chosen">
              <span><strong>{patient.fullName}</strong>{patient.phone && <span className="hint"> · {formatPhone(patient.phone)}</span>}</span>
              <button type="button" className="btn ghost small" onClick={() => setPatient(null)}>Другой</button>
            </div>
          ) : adding ? (
            <>
              <input aria-label="Имя и фамилия" placeholder="Имя и фамилия" value={name} required autoFocus
                onChange={(e) => setName(e.target.value)} />
              {fieldError('fullName') && <p className="error">{fieldError('fullName')}</p>}
              <div className="phone">
                <span>+996</span>
                <input aria-label="Телефон" type="tel" inputMode="tel" placeholder="555 123 456" value={phone} required
                  onChange={(e) => { setPhone(e.target.value); setDuplicate(null) }} />
              </div>
              {fieldError('phone') && <p className="error">{fieldError('phone')}</p>}
              {createPatient.error?.code === 'duplicate-patient' && (
                <div className="duplicate" role="alert">
                  <p>{createPatient.error.message}{duplicate ? `: ${duplicate.fullName}` : ''}</p>
                  {duplicate && (
                    <button type="button" className="btn small" onClick={() => { setPatient(duplicate); setAdding(false); createPatient.reset() }}>
                      Выбрать его
                    </button>
                  )}
                  <button type="button" className="btn small" onClick={(e) => void submit(e, true)}>Это другой человек</button>
                </div>
              )}
              <button type="button" className="link" onClick={() => { setAdding(false); createPatient.reset() }}>← Найти в списке</button>
            </>
          ) : (
            <>
              <input type="search" aria-label="Найти пациента" placeholder="Имя или номер" value={query} autoFocus
                onChange={(e) => setQuery(e.target.value)} />
              {found.data && found.data.length > 0 && (
                <ul className="found" aria-label="Найденные пациенты">
                  {found.data.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => setPatient(p)}>
                        <strong>{p.fullName}</strong>{p.phone && <span className="hint"> · {formatPhone(p.phone)}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {found.data?.length === 0 && <p className="hint small">Не нашли «{search}»</p>}
              <button type="button" className="link" onClick={() => {
                setAdding(true)
                // Ввели номер в поиск — подставим его; имя — в имя
                const digits = query.replace(/\D/g, '')
                if (digits.length >= 9) setPhone(digits.slice(-9))
                else if (query.trim()) setName(query.trim())
              }}>＋ Новый пациент</button>
            </>
          )}
        </fieldset>

        <label className="field">
          <span>Услуга (необязательно)</span>
          <select value={serviceId} onChange={(e) => {
            const id = e.target.value === '' ? '' : Number(e.target.value)
            setServiceId(id)
            const service = services.data?.find((s) => s.id === id)
            if (service?.durationMinutes) setDuration(service.durationMinutes)
          }}>
            <option value="">—</option>
            {services.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Комментарий</span>
          <textarea rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Записываем…' : 'Записать'}</button>
      </form>
    </aside>
  )
}
