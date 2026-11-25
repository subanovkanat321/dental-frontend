import type { Schemas } from '../api/client'
import { timeOf } from '../lib/time'

type Appointment = Schemas['AppointmentView']
type Slots = Schemas['SlotsView']

/**
 * Что предложить, когда услуги не помещаются в приём («Услуги займут 1 ч 30 мин, а приём — 1 ч»):
 * - full — продлить до нужного времени: оно свободно;
 * - partial — до ближайшей границы (следующая запись, перерыв, конец смены): больше нельзя;
 * - none — сразу за приёмом занято: подсказка «Следующая запись в 12:00 — перенесите или сократите услуги».
 */
export type ExtendOffer =
  | { kind: 'full'; until: string; minutes: number }
  | { kind: 'partial'; until: string; minutes: number }
  | { kind: 'none'; text: string }

const MINUTE = 60_000

/**
 * Граница — по свободным окнам врача (/api/slots, тот же ответ, что у «Дня»: приёмы, перерывы, часы врача) и, если день
 * уже загружен расписанием, по его приёмам. Часов ещё нет — как раньше: «Продлить до …», занято — скажет сервер (QA 2026-11-25:
 * предлагали время поверх следующей записи и после конца смены).
 */
export function extendOffer(a: Appointment, needed: number, slots: Slots | undefined, day: Appointment[] | undefined,
  now = Date.now()): ExtendOffer {
  const start = Date.parse(a.startAt)
  const end = Date.parse(a.endAt)
  const wanted = start + needed * MINUTE
  const at = (ms: number) => timeOf(new Date(ms).toISOString())
  const next = (day ?? [])
    .filter((x) => x.id !== a.id && x.status !== 'CANCELLED' && Date.parse(x.startAt) >= end)
    .map((x) => Date.parse(x.startAt))
    .sort((x, y) => x - y)[0]
  if (!slots) {
    // Часов нет — только по приёмам дня, если они есть
    if (next == null || next >= wanted) return { kind: 'full', until: at(wanted), minutes: needed }
    return next > end ? { kind: 'partial', until: at(next), minutes: (next - start) / MINUTE }
      : { kind: 'none', text: `Следующая запись в ${at(next)} — перенесите или сократите услуги` }
  }
  // Свободное окно, которое начинается сразу за приёмом (идущий приём: окно — с «сейчас»)
  const window = (slots.free ?? []).find((w) => Date.parse(w.start) <= Math.max(end, now) && Date.parse(w.end) > end)
  let limit = window ? Date.parse(window.end) : end
  if (next != null) limit = Math.min(limit, next)
  if (limit >= wanted) return { kind: 'full', until: at(wanted), minutes: needed }
  if (limit > end) return { kind: 'partial', until: at(limit), minutes: Math.round((limit - start) / MINUTE) }
  // Сразу за приёмом занято: что именно — запись, перерыв или конец смены
  const soon = end + 15 * MINUTE
  const pause = (slots.breaks ?? []).find((b) => b.start && Date.parse(b.start) <= soon && (!b.end || Date.parse(b.end) > end))
  const shiftEnd = (slots.work ?? []).map((w) => Date.parse(w.end)).find((e) => e >= end - MINUTE && e <= soon)
  const text = next != null && next <= soon ? `Следующая запись в ${at(next)}`
    : pause?.start ? `Перерыв в ${at(Math.max(Date.parse(pause.start), end))}${pause.title ? ` (${pause.title})` : ''}`
      : shiftEnd != null ? `Смена врача до ${at(shiftEnd)}`
        : next != null ? `Следующая запись в ${at(next)}` : 'Сразу после приёма время занято'
  return { kind: 'none', text: `${text} — перенесите или сократите услуги` }
}
