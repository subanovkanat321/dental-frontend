import type { Schemas } from '../api/client'

/** Срочность этапа плана (V267 бэкенда): URGENT, DESIRED (по умолчанию и у прежних этапов), LATER. */
export type Priority = NonNullable<Schemas['TreatmentStepView']['priority']>

/** Порядок групп — сначала срочное. */
export const PRIORITIES: Priority[] = ['URGENT', 'DESIRED', 'LATER']

/** Подписи врачу: значок, короткое название и подсказка — что сюда относится. */
export const PRIORITY: Record<Priority, { icon: string; label: string; hint: string; tone: string }> = {
  URGENT: { icon: '🔴', label: 'Срочно', hint: 'нельзя откладывать: боль, воспаление, пульпит, удаление', tone: 'urgent' },
  DESIRED: { icon: '🟡', label: 'Желательно', hint: 'обычный этап', tone: 'desired' },
  LATER: { icon: '🟢', label: 'Можно позже', hint: 'эстетика, отбеливание, протезирование без спешки', tone: 'later' },
}

/** «🔴 Срочно». */
export const priorityText = (p: Priority) => `${PRIORITY[p].icon} ${PRIORITY[p].label}`

/** Нет поля (старый ответ, ассистент) — «Желательно». */
export const priorityOf = (s: { priority?: Priority | null }): Priority => s.priority ?? 'DESIRED'

/** Группировать по срочности: есть хоть один этап не «Желательно». Только «Желательно» — план как раньше, без групп. */
export function priorityGrouped(steps: { priority?: Priority | null }[]): boolean {
  return steps.some((s) => priorityOf(s) !== 'DESIRED')
}

/**
 * Группы по срочности в порядке срочности, пустые не отдаём; внутри — как пришли с сервера (этап лечения, порядок).
 * Сумма группы — к оплате, со скидками этапов (netSom; скидка в плане всегда у этапа, делить нечего), без цены — 0.
 */
export function priorityGroups<T extends { priority?: Priority | null; priceSom?: number | null; netSom?: number | null }>(
  steps: T[],
): { priority: Priority; items: T[]; total: number }[] {
  return PRIORITIES
    .map((priority) => {
      const items = steps.filter((s) => priorityOf(s) === priority)
      return { priority, items, total: items.reduce((sum, s) => sum + (s.netSom ?? s.priceSom ?? 0), 0) }
    })
    .filter((g) => g.items.length > 0)
}

/**
 * Подсказка срочности по названию услуги — выбрали «Удаление зуба» → «Срочно», «Отбеливание» → «Можно позже». Только
 * пока врач сам не нажал срочность; null — не знаем (остаётся «Желательно»).
 */
export function suggestPriority(title: string): Priority | null {
  const t = title.toLowerCase()
  if (/удален|экстракц|пульпит|периодонтит|абсцесс|воспал|остр|боль|флюс|вскрыт/.test(t)) return 'URGENT'
  if (/отбел|винир|эстет|брекет|элайнер|капп/.test(t)) return 'LATER'
  return null
}
