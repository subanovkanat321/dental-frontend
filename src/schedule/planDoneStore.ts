import { useQuery } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { isAssistant, seesAllMoney } from '../lib/roles'

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
