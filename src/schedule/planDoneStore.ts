import { useQuery } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { isAssistant, seesAllMoney } from '../lib/roles'
import { dateOf } from '../lib/time'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']
type Step = Schemas['TreatmentStepView']

/*
 * «Что сделали сегодня?» — после «Приём состоялся» спросить, какие этапы плана лечения сделали.
 * Врачи забывают отмечать этапы в медкарте, и пациент висит в «Позвать снова» с причиной «лечение не
 * закончено». Вопрос задаём один раз на приём за сеанс: отметили «состоялся» (кнопкой в карточке или
 * свайпом в «Дне») — приём попадает в список «спросить»; «Отметить сделанным» или «Ничего из плана» —
 * выходит из него. Список — только в памяти вкладки (номера приёмов, без данных пациента), не в localStorage.
 */
const asked = new Set<number>()
const listeners = new Set<() => void>()
let version = 0

function changed() {
  version++
  listeners.forEach((f) => f())
}

/** Приём только что отметили «состоялся» — спросить про этапы плана. */
export function askPlanDone(appointmentId: number): void {
  asked.add(appointmentId)
  changed()
}

/** Ответили или закрыли — больше не спрашивать. */
export function forgetPlanDone(appointmentId: number): void {
  if (asked.delete(appointmentId)) changed()
}

function subscribe(f: () => void) {
  listeners.add(f)
  return () => { listeners.delete(f) }
}

/** Спросить ли про этапы плана у этого приёма (подписка на список). */
export function useAskPlanDone(appointmentId: number): boolean {
  useSyncExternalStore(subscribe, () => version)
  return asked.has(appointmentId)
}

/**
 * Отмечать этапы плана может тот, кому сервер разрешит правку плана (ChartService.requireEdit): руководитель,
 * который видит всех врачей, и врач приёма. Ассистент и регистратура — нет (ассистент план только смотрит).
 */
export function canMarkPlan(me: Me, a: Appointment): boolean {
  if (a.patient?.id == null || isAssistant(me)) return false
  return seesAllMoney(me) || (a.doctorId != null && a.doctorId === me.doctorId)
}

/** Несделанные этапы плана пациента — тот же ключ, что у медкарты и «Продолжения лечения». */
export function usePlanLeft(a: Appointment, enabled: boolean): Step[] {
  const patientId = a.patient.id
  const plan = useQuery({
    queryKey: ['plan', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/plan', { params: { path: { patientId } } })),
    enabled: enabled && patientId != null,
    retry: false,
  })
  return (plan.data ?? []).filter((s) => !s.doneAt)
}

const norm = (s: string | undefined | null) => (s ?? '').trim().toLowerCase()

/**
 * Предвыбор: этап по услуге приёма (та же услуга прайса или то же название) — если зуб не мешает: у этапа
 * нет зуба, зубы приёма не отмечены или среди них есть зуб этапа; и этап по зубу, отмеченному на этом приёме.
 * Остальные — без галочки: лишнее «сделано» хуже забытого.
 */
export function preselected(steps: Step[], a: Appointment, services: Schemas['ServiceTypeView'][], teeth: number[]): number[] {
  const service = a.serviceName ? services.find((s) => norm(s.name) === norm(a.serviceName)) : undefined
  return steps.filter((s) => {
    const byTooth = s.tooth != null && teeth.includes(s.tooth)
    const sameService = Boolean(a.serviceName) && ((service != null && s.serviceTypeId === service.id) || norm(s.title) === norm(a.serviceName))
    const toothFits = s.tooth == null || teeth.length === 0 || byTooth
    return byTooth || (sameService && toothFits)
  }).map((s) => s.id)
}

/** «нет», «3 этапа», «3 этапа, 1 сделан сегодня», «всё сделано». */
export function planMeta(steps: Step[], a: Appointment): string {
  if (steps.length === 0) return 'нет'
  const left = steps.filter((s) => !s.doneAt).length
  const day = a.startAt ? dateOf(a.startAt) : null
  const today = steps.filter((s) => s.doneAt && (s.doneAppointmentId === a.id || (day != null && dateOf(s.doneAt) === day))).length
  const parts = [left > 0 ? `${left} ${stepsWord(left)}` : 'всё сделано']
  if (today > 0) parts.push(`${today} ${today === 1 ? 'сделан' : 'сделано'} сегодня`)
  return parts.join(', ')
}

/** «1 этап», «2 этапа», «5 этапов». */
export function stepsWord(n: number): string {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'этап'
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'этапа'
  return 'этапов'
}
