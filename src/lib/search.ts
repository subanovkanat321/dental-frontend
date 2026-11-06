/** Для поиска: без регистра, «ё» = «е», лишние пробелы — прочь. */
function searchKey(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
}

/** Текст подходит под поиск: все слова запроса есть в тексте («кар леч» → «Лечение кариеса»). */
export function textMatches(text: string | undefined, query: string): boolean {
  const q = searchKey(query)
  if (!q) return true
  const n = searchKey(text ?? '')
  return q.split(' ').every((word) => n.includes(word))
}
