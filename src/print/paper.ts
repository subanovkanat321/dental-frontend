import { telegram } from '../lib/telegram'
import { ZONE } from '../lib/time'

/**
 * Печать — только в браузере компьютера: в Telegram (Mini App) window.print не работает, там
 * кнопки «Печать» нет — вместо неё подсказка «печать — с компьютера».
 */
export function canPrint(): boolean {
  return !telegram()
}

/** A4 — лист; receipt — чековая лента 80 мм (квитанция). */
export type PaperFormat = 'a4' | 'receipt'

/** '2026-11-02T08:00:00Z' → «02.11.2026» — по Бишкеку. */
export function docDate(instant: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: ZONE, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(instant))
}
