/**
 * Подписи колонок для таблиц на телефоне. Узкий экран не вмещает 5–7 колонок, и таблица уезжала
 * вбок — «Оплата», «Договор» и дальше никто не видел. На телефоне строка таблицы — карточка
 * (crm.css, .table до 760px), а у каждой ячейки слева подпись её колонки: её и ставим здесь —
 * data-label из текста заголовка (thead). Следим за всем приложением, как buttonIcons: появилась
 * таблица или строки — подписи сами. Ячейки с colSpan и колонки без заголовка — без подписи.
 */
function label(table: HTMLTableElement): void {
  const head = table.tHead?.rows[0]
  if (!head) return
  const titles: string[] = []
  for (const th of Array.from(head.cells)) {
    const text = (th.textContent ?? '').replace(/\s+/g, ' ').replace(/[▲▼↑↓]/g, '').trim()
    for (let i = 0; i < th.colSpan; i++) titles.push(text)
  }
  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      let col = 0
      for (const cell of Array.from(row.cells)) {
        const title = cell.colSpan === 1 ? titles[col] ?? '' : ''
        if (title) {
          if (cell.getAttribute('data-label') !== title) cell.setAttribute('data-label', title)
        } else if (cell.hasAttribute('data-label')) {
          cell.removeAttribute('data-label')
        }
        col += cell.colSpan
      }
    }
  }
}

export function startTableLabels(root: HTMLElement = document.body): () => void {
  const all = () => root.querySelectorAll<HTMLTableElement>('table.table').forEach(label)
  all()
  let queued = false
  const observer = new MutationObserver(() => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      all()
    })
  })
  observer.observe(root, { childList: true, subtree: true, characterData: true })
  return () => observer.disconnect()
}
