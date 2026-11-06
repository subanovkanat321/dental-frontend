import { todayIn } from './time'

/** «1 год», «3 года», «7 лет», «11 лет». */
export function yearsText(years: number): string {
  const n = years % 100
  const word = n >= 11 && n <= 14 ? 'лет' : years % 10 === 1 ? 'год' : [2, 3, 4].includes(years % 10) ? 'года' : 'лет'
  return `${years} ${word}`
}

/** Полных лет на сегодня (по Бишкеку) по дате рождения 'YYYY-MM-DD'; нет даты или она в будущем — null. */
export function ageYears(birth?: string | null, today = todayIn()): number | null {
  if (!birth) return null
  const years = Number(today.slice(0, 4)) - Number(birth.slice(0, 4)) - (today.slice(5) < birth.slice(5) ? 1 : 0)
  return years >= 0 ? years : null
}

/** До 18 лет — ребёнок: бейдж «Ребёнок, 7 лет» в карточках пациента и приёма. Нет даты рождения — null. */
export function childText(birth?: string | null, today = todayIn()): string | null {
  const years = ageYears(birth, today)
  return years != null && years < 18 ? `Ребёнок, ${yearsText(years)}` : null
}
