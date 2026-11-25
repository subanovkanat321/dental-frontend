/**
 * Текст, который Excel или Google Таблицы приняли бы за формулу (= + - @, табуляция, перевод строки в начале), —
 * с апострофом: название клиники «=HYPERLINK(…)» из регистрации не выполнится у владельца (CSV injection; как
 * CsvFormulas на бэкенде). Числа, в том числе «-1500», — как есть.
 */
export function csvText(s: string): string {
  return /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+([.,]\d+)?$/.test(s) ? `'${s}` : s
}

/** Таблица в CSV для Excel: «;», UTF-8 с BOM — как выгрузка клиники. Считается здесь, из уже полученных цифр. */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = typeof v === 'number' ? String(v) : csvText(v)
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return `\uFEFF${rows.map((r) => r.map(cell).join(';')).join('\r\n')}`
}

/** Скачать таблицу файлом «имя.csv». */
export function saveCsv(name: string, rows: (string | number)[][]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.csv`
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
