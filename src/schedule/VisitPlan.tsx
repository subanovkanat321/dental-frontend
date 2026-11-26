import { useQuery } from '@tanstack/react-query'
import { Fragment } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Fold } from '../layout/Fold'
import { TreatmentPlan } from '../medical/TreatmentPlan'
import { totalsOf } from '../medical/stepDiscount'
import { progressShort, usePlanStatus } from '../lib/planStatus'
import { PlanStatusChip } from '../medical/PlanProgress'
import { canMarkPlan, planMeta } from './planDoneStore'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']
type Step = Schemas['TreatmentStepView']
type Progress = Schemas['PlanStatesProgress']

const number = new Intl.NumberFormat('ru-RU')

/**
 * Строка «План лечения» в карточке приёма — рядом с «Зубами», «Материалами» и «Снимками». Пришли на осмотр, конкретный
 * зуб не лечили — врач здесь же добавляет этапы плана и отмечает сделанное, не уходя в медкарту. Редактор — тот же, что
 * во вкладке медкарты ({@link TreatmentPlan}), и тот же кэш ['plan', id]: отметили этапы в «Что сделали сегодня?» —
 * счётчик в строке обновится сам. Нет доступа к медкарте (сервер ответил 403) — строки нет; ассистент план только смотрит.
 *
 * Сводка — один раз, в заголовке: «План лечения [Предложен]», под ним «0 из 12 этапов · 99 000 сом · 113 000 − 14 000
 * скидка · +1 сегодня» (суммы — кто видит деньги: ассистенту сервер их не отдаёт). Внутри статус и прогресс не повторяем.
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
  const progress = status.data
  const summary = plan.data?.length && progress?.status ? { steps: plan.data, progress } : null
  return (
    <Fold title="План лечения" label="План лечения пациента"
      badge={summary ? <PlanStatusChip progress={summary.progress} /> : undefined}
      sub={summary ? <Summary steps={summary.steps} a={a} progress={summary.progress} /> : undefined}
      meta={!summary && plan.data ? planMeta(plan.data, a) : undefined}>
      <TreatmentPlan patient={a.patient} readOnly={!canMarkPlan(me, a)} heading={false} />
    </Fold>
  )
}

/** «0 из 12 этапов · 99 000 сом · 113 000 − 14 000 скидка · +1 сегодня»; куски не рвём посередине — только между « · ». */
function Summary({ steps, a, progress }: { steps: Step[]; a: Appointment; progress: Progress }) {
  // «2 сделано сегодня» → «+2 сегодня»
  const today = planMeta(steps, a).split(', ').slice(1).map((t) => `+${t.split(' ')[0]} сегодня`)
  // Скидка — один раз и мелко; суммы видит не каждый (ассистенту сервер их не отдаёт — тогда и скидки нет)
  const t = progress.totalSom ? totalsOf(steps) : null
  const off = t && t.off > 0 ? `${number.format(t.full)} − ${number.format(t.off)} скидка` : null
  const pieces = [
    ...progressShort(progress).map((x) => ({ x, cls: 'nowrap' })),
    ...(off ? [{ x: off, cls: 'nowrap plan-meta-off' }] : []),
    ...today.map((x) => ({ x, cls: 'nowrap plan-meta-today' })),
  ]
  // « ·» — в конце куска: перенос на телефоне начинает строку с числа, а не с точки. Пробел между кусками — отдельным
  // текстом (на экране его не видно, расстояние даёт gap): скринридер и копирование читают «… этапов · 99 000 сом»
  return (
    <span className="plan-meta" aria-label="Прогресс плана лечения">
      {pieces.map(({ x, cls }, i) => (
        <Fragment key={x}>{i > 0 && ' '}<span className={cls}>{x}{i < pieces.length - 1 ? ' ·' : ''}</span></Fragment>
      ))}
    </span>
  )
}
