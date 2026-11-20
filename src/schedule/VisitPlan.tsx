import { useQuery } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Fold } from '../layout/Fold'
import { TreatmentPlan } from '../medical/TreatmentPlan'
import { progressText, usePlanStatus } from '../lib/planStatus'
import { PlanStatusChip } from '../medical/PlanProgress'
import { canMarkPlan, planMeta } from './planDoneStore'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']
type Step = Schemas['TreatmentStepView']

/**
 * Строка «План лечения · 3 этапа, 1 сделан сегодня ›» в карточке приёма — рядом с «Зубами», «Материалами» и
 * «Снимками». Пришли на осмотр, конкретный зуб не лечили — врач здесь же добавляет этапы плана и отмечает
 * сделанное, не уходя в медкарту. Редактор — тот же, что во вкладке медкарты ({@link TreatmentPlan}), и тот же
 * кэш ['plan', id]: отметили этапы в «Что сделали сегодня?» — счётчик в строке обновится сам.
 * Нет доступа к медкарте (сервер ответил 403) — строки нет; ассистент план только смотрит.
 * Справа в строке — статус плана и прогресс: «[В работе] выполнено 3 из 7 · 12 000 из 40 000 сом · 1 сегодня» (суммы —
 * кто видит деньги: ассистенту сервер их не отдаёт).
 */
export function VisitPlan({ appointment: a, me }: { appointment: Appointment; me: Me }) {
  const patientId = a.patient.id
  const plan = useQuery<Step[], ApiError>({
    queryKey: ['plan', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/plan', { params: { path: { patientId } } })),
    retry: false,
  })
  const status = usePlanStatus(patientId, !plan.error)
  if (plan.error?.status === 403 || plan.error?.status === 404) return null
  return (
    <Fold title="План лечения" label="План лечения пациента" meta={plan.data ? <Meta steps={plan.data} a={a} progress={status.data} /> : undefined}>
      <TreatmentPlan patient={a.patient} readOnly={!canMarkPlan(me, a)} heading={false} />
    </Fold>
  )
}

/** Есть статус — «[В работе] выполнено 3 из 7 · … · 1 сделан сегодня»; нет (плана нет, ещё грузится) — прежний счётчик. */
function Meta({ steps, a, progress }: { steps: Step[]; a: Appointment; progress?: Schemas['PlanStatesProgress'] }) {
  if (!progress?.status || steps.length === 0) return <>{planMeta(steps, a)}</>
  // «2 сделано сегодня» → «+2 сегодня»: строка справа узкая; куски не рвём посередине — только между « · »
  const today = planMeta(steps, a).split(', ').slice(1).map((t) => `+${t.split(' ')[0]} сегодня`)
  const parts = [...progressText(progress).split(' · '), ...today]
  return (
    <span className="plan-meta" aria-label="Прогресс плана лечения">
      <PlanStatusChip progress={progress} />
      {parts.map((t, i) => <span key={t} className="nowrap">{i > 0 ? '· ' : ''}{t}</span>)}
    </span>
  )
}
