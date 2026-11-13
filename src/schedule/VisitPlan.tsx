import { useQuery } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Fold } from '../layout/Fold'
import { TreatmentPlan } from '../medical/TreatmentPlan'
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
 */
export function VisitPlan({ appointment: a, me }: { appointment: Appointment; me: Me }) {
  const patientId = a.patient.id
  const plan = useQuery<Step[], ApiError>({
    queryKey: ['plan', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/plan', { params: { path: { patientId } } })),
    retry: false,
  })
  if (plan.error?.status === 403 || plan.error?.status === 404) return null
  return (
    <Fold title="План лечения" label="План лечения пациента" meta={plan.data ? planMeta(plan.data, a) : undefined}>
      <TreatmentPlan patient={a.patient} readOnly={!canMarkPlan(me, a)} heading={false} />
    </Fold>
  )
}
