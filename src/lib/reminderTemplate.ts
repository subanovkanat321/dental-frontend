import { hasQuotes } from './clinicName'

/**
 * Свой текст напоминания клиники (V135 бэкенда, «Настройки» → «Напоминание о приёме»): шаблон с
 * переменными в фигурных скобках. Подстановка — та же, что ReminderTemplate.apply на сервере
 * (бот шлёт по ней): примеры в тестах у обоих одинаковые. Здесь — для WhatsApp/SMS из CRM и
 * предпросмотра в редакторе.
 *
 * - регистр не важен: {Имя} = {имя};
 * - неизвестная переменная остаётся как есть (редактор подсвечивает, сервер не сохранит — 422);
 * - пустое значение убирается аккуратно: без двойных пробелов, «()» и запятой перед точкой;
 *   строка только из пустых переменных пропадает целиком, и строка-подпись «Врач: {врач}» — тоже
 *   (от неё осталось бы одно «Врач:»).
 */

/** Переменные по порядку — кнопками в редакторе. */
export const VARIABLES = [
  ['имя', 'Имя пациента'],
  ['когда', '«завтра в 10:00»'],
  ['врач', 'Врач'],
  ['услуга', 'Услуга приёма'],
  ['клиника', 'Название клиники'],
  ['адрес', 'Адрес клиники'],
  ['телефон', 'Телефон клиники'],
  ['бот', 'Ссылка на бота (в WhatsApp и SMS)'],
] as const

export type Variable = (typeof VARIABLES)[number][0]

/**
 * Напоминание о долге (V219 бэкенда, ReminderTemplate.DEBT_VARIABLES): {сумма} — долг с сервера со словом «сом»,
 * {врач} — врач(и) приёмов с долгом через запятую, {оплата} — «Оплатить можно в клинике» и реквизиты (клиники или
 * врача, который берёт оплату сам), если заданы; {телефон} — клиники или, при «Номере врача приёма» (V252), врача,
 * если весь долг — за его приёмы (PayRequisites.debtDoctor бэкенда).
 */
export const DEBT_VARIABLES = [
  ['имя', 'Имя пациента'],
  ['сумма', 'Долг: «5 000 сом»'],
  ['клиника', 'Название клиники'],
  ['врач', 'Врач(и) приёмов с долгом'],
  ['оплата', 'Как оплатить (реквизиты)'],
  ['телефон', 'Телефон клиники или врача'],
] as const

export type DebtVariable = (typeof DEBT_VARIABLES)[number][0]

export const MAX_LENGTH = 1000

const NAMES: readonly string[] = VARIABLES.map(([name]) => name)

/** {что-то} без пробелов и скобок внутри: «{ }» и «{a b}» — просто текст. */
const VARIABLE = /\{([^{}\s]{1,30})\}/g

/** Неизвестные переменные по порядку, без повторов — как их написали. */
export function unknownVariables(template: string, names: readonly string[] = NAMES): string[] {
  const found = new Set<string>()
  for (const m of template.matchAll(VARIABLE)) {
    if (!names.includes(m[1]!.toLowerCase())) found.add(m[1]!)
  }
  return [...found]
}

/** Есть ли в шаблоне переменная ({адрес} — адрес отдельной строкой не дописываем). */
export function usesVariable(template: string, variable: Variable | DebtVariable): boolean {
  return [...template.matchAll(VARIABLE)].some((m) => m[1]!.toLowerCase() === variable)
}

const QUOTED = /«\{([^{}\s]{1,30})\}»/gu

/** Подставить значения; нет значения или пусто — переменная убирается аккуратно. */
export function applyTemplate<V extends string = Variable>(template: string, values: Partial<Record<V, string | null | undefined>>,
  names: readonly string[] = NAMES): string {
  const out: string[] = []
  // «{клиника}» в шаблоне, а название уже в кавычках — кавычки шаблона убираем (ReminderTemplate.unquote бэкенда)
  const unquoted = template.replace(QUOTED, (match, name: string) => {
    const key = name.toLowerCase()
    return names.includes(key) && hasQuotes(values[key as V]) ? `{${name}}` : match
  })
  for (const line of unquoted.replace(/\r\n/g, '\n').split('\n')) {
    let hadVariable = false
    let emptied = false
    let filled = false
    const text = line.replace(VARIABLE, (match, name: string) => {
      const key = name.toLowerCase()
      if (!names.includes(key)) return match
      hadVariable = true
      const value = (values[key as V] ?? '').trim()
      if (!value) emptied = true
      else filled = true
      return value
    })
    const result = emptied ? tidy(text) : text
    // Все переменные строки пусты и осталась одна подпись «Врач:» — строку убираем
    if (hadVariable && line.trim() && (!result.trim() || (!filled && result.endsWith(':')))) continue
    out.push(result)
  }
  return out.join('\n').trim()
}

/** Следы пустой переменной: «стоматолога ()» → «стоматолога», «Иванов , ждём» → «Иванов, ждём». */
function tidy(line: string): string {
  return line.replace(/\([ \t]*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.!?;:])/g, '$1')
    .replace(/([,;:])(?=[,.!?;:])/g, '')
    .replace(/^[ \t]*[,;:.][ \t]*/, '')
    .trim()
}
