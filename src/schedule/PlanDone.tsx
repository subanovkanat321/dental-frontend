import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Spinner } from '../layout/Loading'
import { canMarkPlan, forgetPlanDone, preselected, useAskPlanDone, usePlanLeft } from './planDoneStore'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']
type Step = Schemas['TreatmentStepView']

/**
 * Блок «Что сделали сегодня?» внутри карточки приёма (не отдельное окно: после «состоялся» в карточке уже
 * открывается оплата — второе окно поверх неё было бы лишним). Показывается, только если приём недавно
 * отметили «состоялся», у пользователя есть право на план и у пациента есть несделанные этапы.
 *
 * @param primary залитая кнопка — когда в карточке нет другой главной (например, «Принять оплату»)
 */
export function PlanDone({ appointment: a, me, primary }: { appointment: Appointment; me: Me; primary: boolean }) {
  const ask = useAskPlanDone(a.id)
  const allowed = a.status === 'DONE' && canMarkPlan(me, a)
  const [marked, setMarked] = useState<number | null>(null)
  const left = usePlanLeft(a, allowed && ask)
  if (!allowed) return null
  if (marked != null) {
    return <p className="tone-ok plan-done-ok" role="status">Отмечено сделанным: {marked} {stepsWord(marked)} плана</p>
  }
  if (!ask || left.length === 0) return null
  return <PlanDoneForm a={a} me={me} steps={left} primary={primary} onMarked={setMarked} />
}

function PlanDoneForm({ a, me, steps, primary, onMarked }: {
  a: Appointment; me: Me; steps: Step[]; primary: boolean; onMarked: (n: number) => void
}) {
  const client = useQueryClient()
  // Зубы этого приёма — тот же ключ, что у «Зубов» в карточке (обычно уже в кэше)
  const teeth = useQuery({
    queryKey: ['visit-teeth', a.id],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}/teeth', { params: { path: { id: a.id } } })),
    retry: false,
  })
  const ready = !teeth.isPending
  const [picked, setPicked] = useState<number[] | null>(null)
  const chosen = picked ?? (ready ? preselected(steps, a, me.services ?? [], (teeth.data ?? []).map((t) => t.number)) : [])
  const toggle = (id: number) => setPicked(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id])
  const mark = useMutation<Step[], ApiError, number[]>({
    mutationFn: (stepIds) => unwrap(api.POST('/api/appointments/{id}/plan-done', { params: { path: { id: a.id } }, body: { stepIds } })),
    onSuccess: (plan, stepIds) => {
      client.setQueryData(['plan', a.patient.id], plan)
      void client.invalidateQueries({ queryKey: ['comebacks'] })
      onMarked(stepIds.length)
      forgetPlanDone(a.id)
    },
  })
  return (
    <section className="plan-done" aria-label="Что сделали сегодня?">
      <h3>Что сделали сегодня?</h3>
      <p className="hint small">Этапы плана лечения. Отмеченные уйдут из «Позвать снова → лечение не закончено».</p>
      <ul className="plan-done-list">
        {steps.map((s) => (
          <li key={s.id}>
            <label className="check">
              <input type="checkbox" checked={chosen.includes(s.id)} disabled={mark.isPending} onChange={() => toggle(s.id)} />
              <span>{s.tooth != null && <span className="num">{s.tooth} — </span>}{s.title}{s.stage > 1 && <span className="hint"> · этап {s.stage}</span>}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button type="button" className={primary ? 'btn primary' : 'btn'} disabled={chosen.length === 0 || mark.isPending}
          onClick={() => mark.mutate(chosen)}>{mark.isPending && <Spinner />}Отметить сделанным</button>
        <button type="button" className="btn ghost" disabled={mark.isPending} onClick={() => forgetPlanDone(a.id)}>Ничего из плана</button>
      </div>
      {mark.error && <p className="error" role="alert">{errorText(mark.error)}</p>}
    </section>
  )
}

function errorText(e: ApiError): string {
  if (e.status === 403) return 'План лечения ведёт врач приёма или руководитель — у вас нет права отмечать этапы.'
  if (e.status === 404) return 'Этап уже удалили или изменили. Откройте план лечения в медкарте.'
  return e.message || 'Не получилось отметить. Проверьте интернет и попробуйте ещё раз.'
}

function stepsWord(n: number): string {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'этап'
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'этапа'
  return 'этапов'
}
