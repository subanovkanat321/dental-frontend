import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Spinner } from '../layout/Loading'
import { planSaved } from '../lib/planStatus'
import { canMarkPlan, forgetPlanDone, preselected, stepsWord, useAskPlanDone, usePlanLeft } from './planDoneStore'
import { applyUpdatedAppointment } from './useAppointmentAction'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']
type Step = Schemas['TreatmentStepView']

/** Итог «Отметить сделанным»: сколько этапов, какие строки добавились в услуги приёма, какие этапы — без услуги прайса. */
type Marked = { count: number; added: string[]; unpriced: string[] }

/** «Коронка (14, 15) × 2» — строка услуги, добавленная из плана. */
function lineText(l: Schemas['ServiceLine']): string {
  return `${l.name}${l.teeth.length ? ` (${l.teeth.join(', ')})` : ''}${l.qty > 1 ? ` × ${l.qty}` : ''}`
}

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
  const [marked, setMarked] = useState<Marked | null>(null)
  const left = usePlanLeft(a, allowed && ask)
  if (!allowed) return null
  if (marked != null) {
    return (
      <div className="plan-done-ok">
        <p className="tone-ok" role="status">Отмечено сделанным: {marked.count} {stepsWord(marked.count)} плана</p>
        {marked.added.length > 0 && <p className="hint small">Добавлено в услуги приёма: {marked.added.join('; ')}</p>}
        {marked.unpriced.map((t) => <p key={t} className="hint small">«{t}» нет в прайсе — добавьте услугу вручную</p>)}
      </div>
    )
  }
  if (!ask || left.length === 0) return null
  return <PlanDoneForm a={a} me={me} steps={left} primary={primary} onMarked={setMarked} />
}

function PlanDoneForm({ a, me, steps, primary, onMarked }: {
  a: Appointment; me: Me; steps: Step[]; primary: boolean; onMarked: (m: Marked) => void
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
    onSuccess: async (plan, stepIds) => {
      planSaved(client, a.patient.id, plan)
      void client.invalidateQueries({ queryKey: ['comebacks'] })
      void client.invalidateQueries({ queryKey: ['dropped'] })
      // Этап без услуги прайса строку не добавит — подскажем добавить руками
      const unpriced = steps.filter((s) => stepIds.includes(s.id) && s.serviceTypeId == null).map((s) => s.title ?? 'Этап')
      // Скидку этапа сервер перенёс в строку услуги приёма (V258), а нет строки с услугой этапа — добавил строку: перечитать
      // приём, иначе в карточке и в оплате оставалась старая цена до повторного открытия (QA 2026-11-24). Новые строки — в итог
      const before = new Set((a.services ?? []).map((l) => l.id))
      const fresh = await unwrap(api.GET('/api/appointments/{id}', { params: { path: { id: a.id } } })).catch(() => null)
      if (fresh) applyUpdatedAppointment(client, fresh)
      onMarked({ count: stepIds.length, added: (fresh?.services ?? []).filter((l) => !before.has(l.id)).map(lineText), unpriced })
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
