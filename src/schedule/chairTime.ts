import { ApiError, type Schemas } from '../api/client'
import { ask, notify } from '../lib/confirm'
import { timeOf } from '../lib/time'

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
