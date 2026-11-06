/** Подписи «Платформа → Здоровье» (HealthTab). */

/** 93784 с → «1 д 2 ч», 5400 → «1 ч 30 мин». */
export function uptimeText(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d} д ${h} ч`
  if (h > 0) return `${h} ч ${m} мин`
  return `${m} мин`
}

/** 1536 МБ → «1,5 ГБ»; меньше гигабайта — в мегабайтах. */
export function mbText(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1).replace('.', ',')} ГБ` : `${mb} МБ`
}
