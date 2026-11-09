import type { Schemas } from '../api/client'
import { dayMinutes } from '../lib/time'
import { chairTimeText } from './chairTime'

type Slots = Schemas['SlotsView']

/**
 * Рабочие часы коллег по креслу (V187) в колонке «Дня» и «Недели»: своя штриховка цвета «ожидание» и подпись
 * «🪑 время Айгерим». Не то же, что «кресло занято» (там приём): записать можно, сервер спросит «Коллега
 * предупреждён?» (или запретит в строгом режиме). Полоса поверх «Свободно», но нажатия пропускает к нему.
 */
export function ChairTimeBands({ slots, date, y }: { slots: Slots | undefined; date: string; y: (minutes: number) => number }) {
  if (!slots?.workingDay) return null
  return (slots.chairTime ?? []).map((t) => {
    const top = y(dayMinutes(t.start!, date))
    const text = chairTimeText(t)
    return (
      <div key={`colleague-${t.doctorId}-${t.start}`} className="grid-colleague" role="note" aria-label={text}
        title={`${text} — «${t.chairName}» в эти часы за коллегой; записать можно, спросим, предупреждён ли он`}
        style={{ top, height: Math.max(y(dayMinutes(t.end!, date)) - top, 14) }}>
        <span>🪑 время {t.doctorName}</span>
      </div>
    )
  })
}
