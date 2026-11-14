import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from '../api/client'
import { timeOf } from '../lib/time'
import { useDebounced } from '../lib/useDebounced'
import { chairBusyText, chairNotifiedText } from './chairTime'

/**
 * Одна строка о кресле до нажатия «Записать» (`/api/appointments/chair-check`) — сервер отвечает той же логикой и в
 * том же порядке, что и запись:
 * - кресло занято приёмом другого врача (V185) — только «🪑 «Кресло 1» занято: приём Айгерим 18:00–19:00» и свободное
 *   кресло кнопкой «Записать в «Кресло 2»». «Время врача …» тут не показываем: в занятое кресло не записать;
 * - кресло пустое, но это часы коллеги по креслу (V187) — «🪑 18:00–19:00 — время врача Айгерим. Предупредите коллегу…»
 *   (часы коллеги вне часов этого врача, ночные смены, перерывы, «записывает сам коллега», прошедшее время — решает сервер);
 * - кресло не основное у врача приёма (V210) — «Врачу кресла (Нурболот) придёт уведомление».
 *
 * @param action кнопка формы — «Записать», «Перенести», «Передать»: после неё сервер спросит «Коллега предупреждён?»
 */
export function ChairTimeHint({ doctorId, startAt, duration, action = 'Записать', chairId, appointmentId, onPickChair, hidden }: {
  doctorId: number; startAt: string; duration: number; action?: string
  /** Кресло, выбранное в форме (V210): часы врачей того кресла; нет — кресло врача */
  chairId?: number | null
  /** Приём, который переносят или которому меняют кресло: его старое время кресло не занимает */
  appointmentId?: number
  /** Есть поле «Кресло» — кнопка «Записать в «Кресло 2»» ставит свободное кресло в форму */
  onPickChair?: (chairId: number) => void
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
  const d = check.data
  if (!d || settled !== key || hidden) return null
  if (d.busy) {
    const free = d.freeChair
    const told = chairNotifiedText(free?.notified)
    return (
      <p className="notice tone-wait chair-busy-hint" role="status">
        <span>🪑 {chairBusyText(d.busy.chairName, d.busy.doctorName, d.busy.start, d.busy.end)}.
          {free && (onPickChair
            ? <> Свободно «{free.name}» —{' '}
              <button type="button" className="link" onClick={() => onPickChair(free.id)}>записать в «{free.name}»</button>.
              {told && ` ${told}.`}</>
            : <> Свободно «{free.name}» — после «{action}» предложим его.</>)}</span>
      </p>
    )
  }
  const told = chairNotifiedText(d.notified)
  const notice = told ? <p className="hint small chair-notify-hint" role="status">🔔 {told}.</p> : null
  const c = d.colleague
  if (!c) return notice
  const name = c.doctorName ?? 'коллеги'
  if (d.strict) {
    return (
      <p className="notice tone-wait chair-time-hint" role="status">
        🪑 Это время врача {name} — записать нельзя, пусть {name} поставит себе перерыв.
      </p>
    )
  }
  return (
    <>
      <p className="notice tone-wait chair-time-hint" role="status">
        🪑 {timeOf(c.start!)}–{timeOf(c.end!)} — время врача {name}{c.chairName ? ` (${c.chairName})` : ''}.
        Предупредите коллегу: после «{action}» спросим, предупреждён ли он.
      </p>
      {notice}
    </>
  )
}
