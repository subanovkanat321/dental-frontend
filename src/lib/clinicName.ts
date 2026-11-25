/**
 * Название клиники в тексте — как ClinicNames бэкенда: название часто уже в кавычках («Стоматология «Улыбка»»,
 * ООО "Дент") — второй раз не оборачиваем (QA 2026-11-25: выходило «Стоматология «Демо»» в кавычках ещё раз).
 */
export function hasQuotes(name: string | null | undefined): boolean {
  return name != null && /[«"“]/.test(name)
}

/** «Улыбка» → «Улыбка» в ёлочках; «Стоматология «Улыбка»» — как есть. */
export function quoteClinic(name: string): string {
  const n = name.trim()
  return hasQuotes(n) ? n : `«${n}»`
}
