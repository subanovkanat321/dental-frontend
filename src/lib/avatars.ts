/** Цвета аватаров врачей — по порядку, различимы рядом и на светлой, и на тёмной теме. */
export const AVATARS = ['#0E8A80', '#5B7FD6', '#C2793B', '#8E5BB5', '#2F8F5B', '#C2506B']

/** «Каримова Динара» → «КД», «Нурболот» → «Н». */
export function initials(name = ''): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

/**
 * Специальность врача для шапки колонки «Дня» — первая строка «Кратко о себе» (там пишут «Ортодонт,
 * брекеты»): отдельного поля специальности нет, а пациентам эту строку уже показывают.
 */
export function specialtyOf(about: string | undefined): string {
  return (about ?? '').trim().split(/\r?\n/)[0]!.trim()
}
