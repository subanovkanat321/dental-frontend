import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { timeOf } from '../lib/time'
import { useDebounced } from '../lib/useDebounced'
import { useChairs } from '../team/chairs'
import { chairNotifiedText } from './chairTime'

type Check = Schemas['ChairCheckView']

/**
 * Кресло в форме записи и переноса (`/api/appointments/chair-check`) — с 2026-11-19 только при конфликте: поля «Кресло»
 * нет, приём садится в кресло врача. Сервер отвечает той же логикой и в том же порядке, что и запись:
 * - кресло занято приёмом другого врача (V185) — «Кресло 1 в это время занято (Айгерим С.). Свободно: [Кресло 2] [Кресло 3]»;
 * - кресло пустое, но это часы коллеги по креслу (V187) — «… занято (часы врача Айгерим С., 15:00–19:00)»: режим
 *   «Предупреждать» — можно и сюда (после «Записать» спросим «Коллега предупреждён?»), «Запрещать» — сюда нельзя;
 * - свободные кресла (`freeChairs`) фильтрует сервер: без режима «Запрещать» и без занятых приёмом. Нажали — приём
 *   уйдёт в это кресло (chairId, chair_manual). Свободных нет — «выберите другое время»;
 * - выбрали другое кресло — «Запишем в «Кресло 2»» и «в кресло врача» (вернуть), плюс «врачу кресла придёт уведомление».
 * Конфликта нет — ничего. В клинике с одним креслом (`multi` — false) выбирать нечего: только сам конфликт.
 *
 * @param action кнопка формы — «Записать», «Перенести», «Передать»: после неё сервер спросит «Коллега предупреждён?»
 */
export function ChairTimeHint({ doctorId, startAt, duration, action = 'Записать', chairId, appointmentId, multi = false, picked,
  onPickChair, onReset, hidden }: {
  doctorId: number; startAt: string; duration: number; action?: string
  /** Какое кресло проверить: выбранное в форме или кресло переносимого приёма; нет — кресло врача */
  chairId?: number | null
  /** Приём, который переносят или которому меняют кресло: его старое время кресло не занимает */
  appointmentId?: number
  /** В клинике больше одного кресла — предлагать свободные */
  multi?: boolean
  /** Кресло, выбранное нажатием в этой форме (не кресло врача) */
  picked?: number
  onPickChair?: (chairId: number) => void
  /** «в кресло врача» — отменить выбранное кресло */
  onReset?: () => void
  /** Форма уже показывает ответ сервера о кресле (409): второе сообщение о том же не нужно */
  hidden?: boolean
}) {
  // «Другое время» печатают по цифре (22:0… → 22:04 → 22:43): спрашиваем, когда ввод замер, и не показываем
  // ответ про промежуточное время
  const key = `${doctorId}|${startAt}|${duration}|${chairId ?? ''}|${appointmentId ?? ''}`
  const settled = useDebounced(key, 300)
  const valid = duration > 0 && !Number.isNaN(Date.parse(startAt))
  const endAt = valid ? new Date(Date.parse(startAt) + duration * 60_000).toISOString() : ''
  const check = useQuery({
    queryKey: ['chair-check', doctorId, startAt, endAt, chairId ?? null, appointmentId ?? null],
    queryFn: () => unwrap(api.GET('/api/appointments/chair-check',
      { params: { query: { doctorId, startAt, endAt, chairId: chairId ?? undefined, appointmentId } } })),
    enabled: valid && settled === key,
    staleTime: 30_000,
  })
  const chairs = useChairs(picked != null)
  const d = check.data
  if (!d || settled !== key || hidden) return null
  const offer = multi && onPickChair
  const back = picked != null && onReset
    ? <button type="button" className="link" onClick={onReset}>в кресло врача</button> : null

  const conflict = conflictText(d)
  if (conflict) {
    // Записать в это кресло нельзя вовсе: занято приёмом или режим «Запрещать»
    const hard = Boolean(d.busy) || d.strict
    const free = d.freeChairs ?? []
    return (
      <div className="notice tone-wait chair-conflict" role="status">
        <p>🪑 {conflict}{hard
          ? (offer ? '' : ' Выберите другое время.')
          : ` Можно и сюда — после «${action}» спросим, предупреждён ли коллега.`}</p>
        {offer && (free.length ? (
          <p className="chair-offer"><span>Свободно:</span>
            {free.map((f) => (
              <button key={f.id} type="button" className="btn small" aria-label={`Записать в «${f.name}»${f.colleague ? ` (время ${f.colleague})` : ''}`}
                onClick={() => onPickChair(f.id)}>{f.name}{f.colleague && <span className="hint"> · время {f.colleague}</span>}</button>
            ))}
          </p>
        ) : (
          <p className="chair-offer">{hard ? 'Свободных кресел на это время нет — выберите другое время.' : 'Других свободных кресел на это время нет.'}</p>
        ))}
        {back && <p className="chair-offer">{back}</p>}
      </div>
    )
  }
  const told = chairNotifiedText(d.notified)
  if (back) {
    const name = chairs.data?.find((c) => c.id === picked)?.name
    return (
      <p className="hint small chair-picked" role="status">
        🪑 Запишем в «{name ?? 'выбранное кресло'}».{told && ` ${told}.`} {back}
      </p>
    )
  }
  return told ? <p className="hint small chair-notify-hint" role="status">🔔 {told}.</p> : null
}

/** «Кресло 1 в это время занято (Айгерим С.).» / «… (часы врача Айгерим С., 15:00–19:00).»; конфликта нет — null. */
function conflictText(d: Check): string | null {
  if (d.busy) return `${d.busy.chairName} в это время занято${d.busy.doctorName ? ` (${d.busy.doctorName})` : ''}.`
  const c = d.colleague
  if (!c) return null
  const when = c.start && c.end ? `, ${timeOf(c.start)}–${timeOf(c.end)}` : ''
  return `${c.chairName ?? 'Кресло врача'} в это время занято (часы врача ${c.doctorName ?? 'коллеги'}${when}).${d.strict ? ' Сюда записать нельзя.' : ''}`
}
