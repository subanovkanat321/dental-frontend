import { expect, test } from 'vitest'

import { startTableLabels } from './tableLabels'

test('ячейки таблицы получают подпись колонки — на телефоне строка становится карточкой', async () => {
  const root = document.createElement('div')
  root.innerHTML = `<table class="table"><thead><tr><th>Клиника</th><th>Заходили</th><th colspan="2">Оплата</th><th></th></tr></thead>
    <tbody><tr><td>Улыбка</td><td>сегодня</td><td>оплачено</td><td>до 1 дек</td><td><button>›</button></td></tr>
    <tr><td colspan="5">Скрытые</td></tr></tbody></table>`
  const stop = startTableLabels(root)
  const [first, second] = Array.from(root.querySelectorAll('tbody tr'))
  expect(Array.from(first!.children).map((c) => c.getAttribute('data-label'))).toEqual(['Клиника', 'Заходили', 'Оплата', 'Оплата', null])
  expect(second!.children[0]!.hasAttribute('data-label')).toBe(false)
  // Новая строка — подпись появляется сама
  root.querySelector('tbody')!.insertAdjacentHTML('beforeend', '<tr><td>Дент</td><td>вчера</td><td></td><td></td><td></td></tr>')
  await new Promise((r) => requestAnimationFrame(() => r(null)))
  await new Promise((r) => setTimeout(r, 0))
  expect(root.querySelectorAll('tbody tr')[2]!.children[1]!.getAttribute('data-label')).toBe('Заходили')
  stop()
})
