/**
 * Свой текст напоминания клиники (V135 бэкенда, «Настройки» → «Текст напоминания»): шаблон с
 * переменными в фигурных скобках. Подстановка — та же, что ReminderTemplate.apply на сервере
 * (бот шлёт по ней): примеры в тестах у обоих одинаковые. Здесь — для WhatsApp/SMS из CRM и
 * предпросмотра в редакторе.
 *
 * - регистр не важен: {Имя} = {имя};
 * - неизвестная переменная остаётся как есть (редактор подсвечивает, сервер не сохранит — 422);
 * - пустое значение убирается аккуратно: без двойных пробелов, «()» и запятой перед точкой;
 *   строка только из пустых переменных пропадает целиком.
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

export const MAX_LENGTH = 1000

const NAMES: readonly string[] = VARIABLES.map(([name]) => name)

/** {что-то} без пробелов и скобок внутри: «{ }» и «{a b}» — просто текст. */
const VARIABLE = /\{([^{}\s]{1,30})\}/g

/** Неизвестные переменные по порядку, без повторов — как их написали. */
export function unknownVariables(template: string): string[] {
  const found = new Set<string>()
  for (const m of template.matchAll(VARIABLE)) {
    if (!NAMES.includes(m[1]!.toLowerCase())) found.add(m[1]!)
  }
  return [...found]
}

/** Есть ли в шаблоне переменная ({адрес} — адрес отдельной строкой не дописываем). */
export function usesVariable(template: string, variable: Variable): boolean {
  return [...template.matchAll(VARIABLE)].some((m) => m[1]!.toLowerCase() === variable)
}

/** Подставить значения; нет значения или пусто — переменная убирается аккуратно. */
export function applyTemplate(template: string, values: Partial<Record<Variable, string | null | undefined>>): string {
  const out: string[] = []
  for (const line of template.replace(/\r\n/g, '\n').split('\n')) {
    let hadVariable = false
    let emptied = false
    const text = line.replace(VARIABLE, (match, name: string) => {
      const key = name.toLowerCase()
      if (!NAMES.includes(key)) return match
      hadVariable = true
      const value = (values[key as Variable] ?? '').trim()
      if (!value) emptied = true
      return value
    })
    const result = emptied ? tidy(text) : text
    if (hadVariable && !result.trim() && line.trim()) continue
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
