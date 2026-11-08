/**
 * Подстановки шаблона договора с пациентом — тот же алгоритм, что ContractTemplate бэкенда (там
 * собирается настоящий текст; здесь — только предпросмотр в «Настройках» на вымышленном пациенте).
 * {клиника}, {Пациент} — регистр не важен; пустое значение — линия, чтобы дописать от руки;
 * неизвестная подстановка остаётся как есть.
 */
export const BLANK = '________________'

const VARIABLE = /\{([^{}\n]{1,30})\}/g

const normalize = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()

export function fillContract(template: string, values: Record<string, string | null | undefined>): string {
  return template.replace(VARIABLE, (token, name: string) => {
    const key = normalize(name)
    if (!(key in values)) return token
    const value = values[key]
    return value && value.trim() ? value.trim() : BLANK
  })
}

/** Подстановки, которых нет в списке: сервер такой шаблон не сохранит (422). */
export function unknownContractVariables(template: string, known: readonly string[]): string[] {
  const found = new Set<string>()
  for (const m of template.matchAll(VARIABLE)) {
    if (!known.includes(normalize(m[1]!))) found.add(m[0])
  }
  return [...found]
}
