import { ApiError, type Schemas } from '../api/client'
import { ask, notify } from '../lib/confirm'
import { dayMinutes, timeOf } from '../lib/time'
import { workSpans } from './workSpans'

/** Код 409: время попадает в рабочие часы коллеги по креслу (V187). */
export const CHAIR_COLLEAGUE_TIME = 'chair-colleague-time'

/**
 * Свободное кресло из ответа 409 (V210): сервер предлагает его вместо занятого. `notified` — врачи этого кресла, которым
 * после записи туда придёт уведомление.
 */
export type FreeChair = { id: number; name: string; colleague?: string; notified: string[] }

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

export function freeChairOf(error: ApiError): FreeChair | null {
  const p = error.problem
  if (typeof p.freeChairId !== 'number' || typeof p.freeChairName !== 'string') return null
  return {
    id: p.freeChairId, name: p.freeChairName, colleague: typeof p.freeChairColleague === 'string' ? p.freeChairColleague : undefined,
    notified: strings(p.freeChairNotified),
  }
}

/** ««Кресло 1» занято: приём Айгерим С. 18:00–19:00» — без времени, если сервер его не прислал. */
export function chairBusyText(chairName: string | undefined, doctorName: string | undefined, start?: string, end?: string): string {
  const chair = chairName ? `«${chairName}»` : 'Кресло врача'
  const when = start && end ? ` ${timeOf(start)}–${timeOf(end)}` : ''
  return doctorName ? `${chair} занято: приём ${doctorName}${when}` : `${chair} занято${when ? `:${when}` : ''}`
}

/** «Врачу кресла (Нурболот Т.) придёт уведомление» — запись в чужое кресло (V210); никому — пусто. */
export function chairNotifiedText(names: string[] | undefined): string {
  if (!names?.length) return ''
  return `${names.length > 1 ? 'Врачам' : 'Врачу'} кресла (${names.join(', ')}) придёт уведомление`
}

/** Ответ сервера — про кресло (занято, часы коллеги, «не записали»): форма уже показывает его, подсказка о кресле не нужна. */
export function isChairError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && typeof error.problem.chairName === 'string'
}

/**
 * Вопрос «записать в другое кресло?» по ответу 409 (V210) — одно сообщение: «Кресло 1» занято: приём Айгерим С.
 * 18:00–19:00. Свободно «Кресло 2» — записать туда? Кресло занято приёмом — только «занято», без «время коллеги»: в
 * занятое кресло не записать, чьи там часы — неважно. «Время врача …» — только когда кресло пустое (409
 * chair-colleague-time). Свободное — в часы его врача или чьё-то основное: скажем, что тому придёт уведомление.
 */
export function switchChairText(error: ApiError, free: FreeChair): string {
  const p = error.problem
  const chairName = typeof p.chairName === 'string' ? p.chairName : undefined
  const who = typeof p.doctorName === 'string' ? p.doctorName : undefined
  const head = error.code === CHAIR_COLLEAGUE_TIME
    ? `${chairName ? `«${chairName}»` : 'Кресло врача'} в это время — время врача ${who ?? 'коллеги'}.`
    : `${chairBusyText(chairName, who, typeof p.busyStart === 'string' ? p.busyStart : undefined,
      typeof p.busyEnd === 'string' ? p.busyEnd : undefined)}.`
  const told = chairNotifiedText(free.notified)
  return `${head} Свободно «${free.name}»${free.colleague ? ` (часы врача ${free.colleague})` : ''} — записать туда?${told ? ` ${told}.` : ''}`
}

/**
 * Запись или перенос с вопросами о кресле.
 * - Кресло занято (409 с `freeChairId`, V210) — «Кресло 1 занято: приём Айгерим 18:00–19:00. Свободно Кресло 2 — записать
 *   туда?» с кнопкой «Записать в «Кресло 2»»: тот же запрос с `chairId`. «Нет» — ошибка как раньше (её покажет экран).
 *   Свободное кресло — в часы его врача: вопрос уже сказал об этом («часы врача Нурболот, ему придёт уведомление»), поэтому
 *   повтор сразу с `confirmChairTime` — без второго окна «Коллега предупреждён?».
 * - Часы коллеги по креслу (409 `chair-colleague-time`, V187): сначала — то же предложение другого кресла, если сервер его
 *   прислал; дальше режим «Предупреждать» — окно «Это время врача Айгерим (Кресло 1). Коллега предупреждён?» с кнопками
 *   «Записать» и «Отмена» («Записать» — тот же запрос с `confirmChairTime: true`); режим «Запрещать» (`strict`) — то же
 *   окно с одной кнопкой «Понятно».
 * Как остальные подтверждения приложения — своим окном `ask` (lib/confirm), а не системным.
 *
 * @param send запрос; confirm — повторить с подтверждением, chairId — в это кресло (undefined — как выбрано в форме)
 * @throws ApiError ответ сервера; «Отмена» или запрет — ApiError 409 с понятным текстом (экран покажет его под формой)
 */
export async function withChairConfirm<T>(send: (confirm: boolean, chairId?: number) => Promise<T>): Promise<T> {
  let confirm = false
  let chairId: number | undefined
  const offered = new Set<number>()
  for (;;) {
    try {
      return await send(confirm, chairId)
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error
      const free = freeChairOf(error)
      if (free && !offered.has(free.id)) {
        offered.add(free.id)
        if (await ask(switchChairText(error, free), { ok: `Записать в «${free.name}»` })) {
          chairId = free.id
          confirm = Boolean(free.colleague)
          continue
        }
      }
      if (error.code !== CHAIR_COLLEAGUE_TIME || confirm) throw error
      if (error.problem.strict === true) {
        await notify(error.message)
        throw error
      }
      if (!await ask(error.message, { ok: 'Записать' })) {
        const name = typeof error.problem.doctorName === 'string' ? error.problem.doctorName : 'коллеги'
        throw new ApiError(409, `Не записали: это время врача ${name}`, {}, { ...error.problem, code: 'chair-colleague-cancelled' })
      }
      confirm = true
    }
  }
}

/** Подпись полосы «время коллеги»: «15:00–19:00: время Айгерим С.». */
export function chairTimeText(t: Schemas['SlotsViewChairTime']): string {
  return `${timeOf(t.start)}–${timeOf(t.end)}: время ${t.doctorName}`
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
