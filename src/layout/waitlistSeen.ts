import { useEffect } from 'react'

/**
 * Что нового в «Листе ожидания» с прошлого захода — для красного счётчика в меню. Только время последнего захода
 * на этом устройстве (localStorage, не данные пациентов). Отметки ещё нет (лист на этом устройстве не открывали) —
 * новое считаем от открытия приложения: в день обновления весь прежний лист не загорится красным, а в хранилище до
 * первого захода в лист ничего не пишем. Открыли лист — отметка «сейчас», счётчик снова тихий (серое число —
 * сколько ждут всего).
 */
export const WAITLIST_SEEN_KEY = 'crm.waitlist.seenAt'

/** Когда открыли приложение — от этого считаем новое, пока отметки нет */
const OPENED_AT = Date.now()

function read(): string | null {
  try {
    return localStorage.getItem(WAITLIST_SEEN_KEY)
  } catch {
    return null
  }
}

function write(at: string): void {
  try {
    localStorage.setItem(WAITLIST_SEEN_KEY, at)
  } catch {
    // приватный режим — счётчик до перезагрузки
  }
}

/** Сколько записей листа появилось после отметки; `open` — лист сейчас на экране (отметка обновляется). */
export function useWaitlistNew(list: readonly { createdAt?: string }[] | undefined, open: boolean): number {
  const newest = (list ?? []).reduce<string | null>((max, w) => (w.createdAt && (!max || w.createdAt > max) ? w.createdAt : max), null)
  useEffect(() => {
    // Открыт лист: всё, что в нём сейчас, — увидели (часы устройства могут отставать от сервера — берём позднее)
    if (open) write(newest && newest > new Date().toISOString() ? newest : new Date().toISOString())
  }, [open, newest])
  if (open) return 0
  // Отметку читаем при каждой отрисовке: ушли из листа — меню перерисовалось и видит новую
  const saved = read()
  const seen = saved ? Date.parse(saved) : OPENED_AT
  return (list ?? []).filter((w) => w.createdAt && Date.parse(w.createdAt) > seen).length
}
