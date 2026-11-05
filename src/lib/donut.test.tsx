import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Donut } from './Donut'
import { donutParts, percents } from './parts'

test('проценты в сумме ровно 100, нули остаются нулями', () => {
  expect(percents([1, 1, 1])).toEqual([34, 33, 33])
  expect(percents([2, 0, 1])).toEqual([67, 0, 33])
  expect(percents([1, 1, 1, 1, 1, 1, 1])).toEqual([15, 15, 14, 14, 14, 14, 14])
  expect(percents([0, 0])).toEqual([0, 0])
  for (const values of [[7, 11, 13], [1, 2, 3, 4, 5, 6], [999, 1, 1]]) expect(percents(values).reduce((a, b) => a + b, 0)).toBe(100)
})

test('больше 6 частей — крупные по убыванию и «Другое (n)» серым, цвета не повторяются', () => {
  const parts = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З'].map((name, i) => ({ key: name, name, value: i + 1 }))
  const shown = donutParts(parts)
  expect(shown).toHaveLength(6)
  expect(shown.map((p) => p.name)).toEqual(['З', 'Ж', 'Е', 'Д', 'Г', 'Другое (3)'])
  expect(shown.at(-1)).toMatchObject({ value: 1 + 2 + 3, color: 'var(--chart-other)', note: 'В, Б, А' })
  // Слотов на восемь не хватает — цвет по месту среди крупных, без повторов
  expect(shown.map((p) => p.color)).toEqual(['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--chart-other)'])
  // До шести во входе — цвет по месту во входе: у «Б» второй слот, даже когда «А» нулевая
  expect(donutParts([{ key: 'a', name: 'А', value: 0 }, { key: 'b', name: 'Б', value: 5 }]).map((p) => p.color)).toEqual(['var(--series-2)'])
  // Ровно 6 — без «Другого»
  expect(donutParts(parts.slice(0, 6)).map((p) => p.name)).toEqual(['А', 'Б', 'В', 'Г', 'Д', 'Е'])
})

test('бублик: нули не рисуются, aria-описание долей, легенда с суммой и процентом, итог в центре', () => {
  const { container } = render(
    <Donut label="Способы оплаты" format={(v) => `${v} сом`} caption="касса" parts={[
      { key: 'CASH', name: 'Наличные', value: 600 },
      { key: 'CARD', name: 'Карта', value: 0 },
      { key: 'TRANSFER', name: 'Перевод', value: 400 },
    ]} />,
  )
  expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Способы оплаты: Наличные 600 сом (60%), Перевод 400 сом (40%)')
  expect(container.querySelectorAll('circle')).toHaveLength(2)
  const rows = within(screen.getByRole('list', { name: 'Способы оплаты' })).getAllByRole('button')
  expect(rows.map((r) => r.textContent)).toEqual(['Наличные600 сом60%', 'Перевод400 сом40%'])
  expect(container.querySelector('.donut-center')).toHaveTextContent('1000 сомкасса')
})

test('бублик: наведение и фокус на строке легенды подсвечивают сегмент, нажатие закрепляет', async () => {
  const user = userEvent.setup()
  const { container } = render(
    <Donut label="Визиты" center="75%" caption="повторных" parts={[
      { key: 'FIRST', name: 'Первичные', value: 1 },
      { key: 'REPEAT', name: 'Повторные', value: 3 },
    ]} />,
  )
  const lit = () => container.querySelector('.donut-seg.on')?.getAttribute('data-key') ?? null
  const center = container.querySelector('.donut-center')!
  expect(lit()).toBeNull()
  expect(center).toHaveTextContent('75%повторных')
  const [first, repeat] = screen.getAllByRole('button')
  await user.hover(first!)
  expect(lit()).toBe('FIRST')
  expect(center).toHaveTextContent('25%Первичные')
  await user.unhover(first!)
  expect(lit()).toBeNull()
  // Клавиатура: Tab — на строку, подсветка; Enter — закрепить
  await user.tab()
  expect(document.activeElement).toBe(first)
  expect(lit()).toBe('FIRST')
  await user.tab()
  expect(lit()).toBe('REPEAT')
  await user.keyboard('{Enter}')
  expect(repeat).toHaveAttribute('aria-pressed', 'true')
  await user.tab() // ушли с бублика — закреплённая часть остаётся подсвеченной
  expect(lit()).toBe('REPEAT')
  // Наведение на сегмент — тоже подсветка
  await user.hover(container.querySelector('[data-key=FIRST]')!)
  expect(lit()).toBe('FIRST')
})

test('бублик: с onPick нажатие выбирает часть снаружи, «Другое» не выбирается', async () => {
  const user = userEvent.setup()
  const picks: string[] = []
  const parts = Array.from({ length: 8 }, (_, i) => ({ key: `k${i}`, name: `Статья ${i}`, value: 10 - i }))
  render(<Donut label="Расходы" parts={parts} picked="k1" onPick={(k) => picks.push(k)} />)
  const rows = screen.getAllByRole('button')
  expect(rows).toHaveLength(6)
  expect(rows[1]).toHaveAttribute('aria-pressed', 'true')
  await user.click(rows[0]!)
  await user.click(rows[5]!)
  expect(picks).toEqual(['k0'])
})

test('бублик: все части нулевые или пусто — компактный текст вместо кольца', () => {
  const { rerender } = render(<Donut label="Источники" empty="Новых пациентов нет." parts={[{ key: 'a', name: 'А', value: 0 }]} />)
  expect(screen.getByText('Новых пациентов нет.')).toBeInTheDocument()
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  rerender(<Donut label="Источники" parts={[]} />)
  expect(screen.getByText('Нет данных за этот период.')).toBeInTheDocument()
})
