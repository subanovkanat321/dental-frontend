import { ApiError, type Schemas } from '../api/client'
import { ask, notify } from '../lib/confirm'
import { dayMinutes, timeOf } from '../lib/time'
import { workSpans } from './workSpans'

/** Код 409: время попадает в рабочие часы коллеги по креслу (V187). */
export const CHAIR_COLLEAGUE_TIME = 'chair-colleague-time'

/**
 * Запись или перенос с вопросом о часах коллеги по креслу (V187). Сервер ответил 409 `chair-colleague-time`:
 * - режим кресла «Предупреждать» — окно «Это время врача Айгерим (Кресло 1). Коллега предупреждён?» с кнопками
 *   «Записать» и «Отмена»; «Записать» — тот же запрос с `confirmChairTime: true`;
 * - режим «Запрещать» (`strict`) — то же окно с одной кнопкой «Понятно»: записать нельзя, пока коллега не поставит
 *   себе перерыв.
 * Как остальные подтверждения приложения — своим окном `ask` (lib/confirm), а не системным.
 *
 * @param send запрос; confirm — повторить с подтверждением
 * @throws ApiError ответ сервера; «Отмена» или запрет — ApiError 409 с понятным текстом (экран покажет его под формой)
 */
export async function withChairConfirm<T>(send: (confirm: boolean) => Promise<T>): Promise<T> {
  try {
    return await send(false)
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== CHAIR_COLLEAGUE_TIME) throw error
    if (error.problem.strict === true) {
      await notify(error.message)
      throw error
    }
    if (!await ask(error.message, { ok: 'Записать' })) {
      const name = typeof error.problem.doctorName === 'string' ? error.problem.doctorName : 'коллеги'
      throw new ApiError(409, `Не записали: это время врача ${name}`, {}, { ...error.problem, code: 'chair-colleague-cancelled' })
    }
    return send(true)
  }
}

/** Подпись полосы «время коллеги»: «15:00–19:00: время Айгерим С.». */
export function chairTimeText(t: Schemas['SlotsViewChairTime']): string {
  return `${timeOf(t.start!)}–${timeOf(t.end!)}: время ${t.doctorName}`
}

type ChairTime = Schemas['SlotsViewChairTime']
type Appointment = Schemas['AppointmentView']

const ms = (instant: string) => new Date(instant).getTime()

/**
 * Часы коллеги по креслу, в которые попал приём (V187), — для пометки «🪑 время Айгерим» на нём в сетке, в списке
 * дня и в карточке. {@code chairTime} — из слотов врача приёма за его день: сервер отдаёт их за весь день, и вне
 * часов врача (запись «Другим временем» в 22:43 у врача с часами 8–18). Отменённый приём кресло не занимает;
 * часы самого врача приёма — не «чужие» (сервер их и не присылает, проверка на всякий случай).
 */
export function colleagueTimeOf(a: Appointment, chairTime: ChairTime[] | undefined): ChairTime | undefined {
  if (!a.startAt || !a.endAt || a.status === 'CANCELLED') return undefined
  const start = ms(a.startAt)
  const end = ms(a.endAt)
  return (chairTime ?? []).find((t) => t.doctorId !== a.doctorId && t.start && t.end && ms(t.start) < end && ms(t.end) > start)
}

/** Подпись пометки в карточке: «Записан в часы врача Айгерим С. (Кресло 1)». */
export function colleagueMarkText(t: ChairTime): string {
  return `Записан в часы врача ${t.doctorName}${t.chairName ? ` (${t.chairName})` : ''}`
}

/**
 * Какие «🪑 время X» показать строками в списке дня — без шума: часы коллеги, которые задевают рабочее время врача,
 * — всегда (как раньше); вне его часов (и в его выходной) — только если там стоит его приём: тогда строка объясняет
 * пометку на приёме, а пустой вечер коллеги в списке врача ни к чему.
 */
export function listedChairTime(sl: Schemas['SlotsView'] | undefined, date: string, appointments: Appointment[]): ChairTime[] {
  const work = workSpans(sl, date)
  return (sl?.chairTime ?? []).filter((t) => {
    if (!t.start || !t.end) return false
    const s = dayMinutes(t.start, date)
    const e = dayMinutes(t.end, date)
    return work.some(([ws, we]) => s < we && e > ws) || appointments.some((a) => colleagueTimeOf(a, [t]) != null)
  })
}
