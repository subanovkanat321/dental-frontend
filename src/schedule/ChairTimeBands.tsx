import type { Schemas } from '../api/client'
import { dayMinutes } from '../lib/time'
import { chairTimeText, listedChairTime } from './chairTime'

type Slots = Schemas['SlotsView']

/**
 * Рабочие часы коллег по креслу (V187) в колонке «Дня» и «Недели»: своя штриховка цвета «ожидание» и подпись
 * «🪑 время Айгерим». Не то же, что «кресло занято» (там приём): записать можно, сервер спросит «Коллега
 * предупреждён?» (или запретит в строгом режиме). Полоса поверх «Свободно», но под приёмами (на них — своя
 * пометка 🪑) и нажатия пропускает к «Свободно».
 *
 * Сервер отдаёт часы коллег за весь день, и вне часов врача: там фон и так серый, полоса поверх него показывает,
 * что вечер кресла — за коллегой (приём туда «Другим временем» помечен). В выходной врача — только часы, где стоит
 * его приём (иначе выходной весь в полосах). Видна только часть внутри сетки [from, to).
 */
export function ChairTimeBands({ slots, date, y, from, to, appointments }: {
  slots: Slots | undefined
  date: string
  y: (minutes: number) => number
  /** Видимые часы сетки (минуты от полуночи) */
  from: number
  to: number
  /** Приёмы врача в этот день — для выходного */
  appointments: Schemas['AppointmentView'][]
}) {
  if (!slots) return null
  const list = slots.workingDay ? slots.chairTime ?? [] : listedChairTime(slots, date, appointments)
  return list.map((t) => {
    const start = Math.max(dayMinutes(t.start, date), from)
    const end = Math.min(dayMinutes(t.end, date), to)
    if (end <= start) return null
    const top = y(start)
    const text = chairTimeText(t)
    return (
      <div key={`colleague-${t.doctorId}-${t.start}`} className="grid-colleague" role="note" aria-label={text}
        title={`${text} — «${t.chairName}» в эти часы за коллегой; записать можно, спросим, предупреждён ли он`}
        style={{ top, height: Math.max(y(end) - top, 14) }}>
        <span>🪑 время {t.doctorName}</span>
      </div>
    )
  })
}
