/** Таблица в CSV для Excel: «;», UTF-8 с BOM — как выгрузка клиники. Считается здесь, из уже полученных цифр. */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v)
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
