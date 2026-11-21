import type { Schemas } from '../api/client'
import { dayMinutes, minutesOfTime } from '../lib/time'
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
  // Часы врача (минуты дня): внутри них полоса — заливка «ожидание»; вне их (серое «нерабочее») — без заливки, только
  // тонкая линия и подпись: целиком закрашенная колонка неработающего врача путала (2026-11-21, владелец)
  const work = slots.workingDay
    ? (slots.work?.length ? slots.work.map((w) => [dayMinutes(w.start, date), dayMinutes(w.end, date)] as const)
      : slots.workStart && slots.workEnd ? [[minutesOfTime(slots.workStart), minutesOfTime(slots.workEnd)] as const] : [])
    : []
  return list.flatMap((t) => {
    const start = Math.max(dayMinutes(t.start, date), from)
    const end = Math.min(dayMinutes(t.end, date), to)
    if (end <= start) return []
    const text = chairTimeText(t)
    return pieces(start, end, work).map(([a, b, inWork], i) => {
      const top = y(a)
      return (
        <div key={`colleague-${t.doctorId}-${t.start}-${i}`} className={inWork ? 'grid-colleague' : 'grid-colleague off'} role="note" aria-label={text}
          title={`${text} — «${t.chairName}» в эти часы за коллегой; записать можно, спросим, предупреждён ли он`}
          style={{ top, height: Math.max(y(b) - top, 14) }}>
          <span>🪑 время {t.doctorName}</span>
        </div>
      )
    })
  })
}

/** [start, end) по часам врача: куски «в часы врача» и «вне часов», по порядку. */
function pieces(start: number, end: number, work: readonly (readonly [number, number])[]): [number, number, boolean][] {
  const cuts = new Set([start, end])
  for (const [a, b] of work) {
    if (a > start && a < end) cuts.add(a)
    if (b > start && b < end) cuts.add(b)
  }
  const points = [...cuts].sort((x, z) => x - z)
  const out: [number, number, boolean][] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const inWork = work.some(([ws, we]) => a >= ws && b <= we)
    const last = out.at(-1)
    if (last && last[2] === inWork && last[1] === a) last[1] = b
    else out.push([a, b, inWork])
  }
  return out
}
