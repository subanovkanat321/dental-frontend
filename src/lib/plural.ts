/** Русское окончание по числу: 1 месяц, 2 месяца, 5 месяцев (11–14 — «месяцев»). */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100
  const mod10 = mod100 % 10
  if (mod100 >= 11 && mod100 <= 14) return many
  return mod10 === 1 ? one : mod10 >= 2 && mod10 <= 4 ? few : many
}

/** «3 месяца», «12 месяцев». */
export const monthsText = (n: number) => `${n} ${plural(n, 'месяц', 'месяца', 'месяцев')}`
