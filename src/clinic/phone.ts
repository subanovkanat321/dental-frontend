/** Номер набран целиком (с кодом страны или с 0) — тогда «+996» не добавляем. */
export function isFullPhone(v: string): boolean {
  return /^(\+|00|996|0)/.test(v.replace(/[\s()-]/g, ''))
}

/** Из поля в запрос: «555 123 456» → «+996 555 123 456»; пусто — пусто. */
export function phoneFromInput(v: string): string {
  const t = v.trim()
  return !t || isFullPhone(t) ? t : `+996 ${t}`
}

/** Из ответа в поле: «996555123456» → «555 123 456»; иной номер — как есть. */
export function phoneToInput(digits?: string | null): string {
  const d = digits ?? ''
  return /^996\d{9}$/.test(d) ? `${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}` : d
}
