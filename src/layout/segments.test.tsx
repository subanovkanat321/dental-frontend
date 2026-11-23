import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { Segments } from './Segments'

/** Ширина экрана для matchMedia: телефон — ≤640px. */
function screenWidth(px: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const max = Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity)
    return { matches: px <= max, media: query, addEventListener: () => {}, removeEventListener: () => {} }
  })
}

function Filter({ count = 5 }: { count?: number }) {
  const all: [string, string][] = [['all', 'Все · 9'], ['plan', 'Планы лечения · 3'], ['cancel', 'Отменили · 2'], ['noshow', 'Не пришли · 1'], ['recall', 'Пора на осмотр · 3']]
  const [v, setV] = useState('all')
  return (
    <>
      <Segments label="Кого позвать" value={v} onChange={setV} options={all.slice(0, count).map(([value, label]) => ({ value, label }))} />
      <output>{v}</output>
    </>
  )
}

afterEach(() => vi.unstubAllGlobals())

test('компьютер — таблетки: нажатая отмечена aria-pressed, выбор меняет значение', async () => {
  screenWidth(1366)
  render(<Filter />)
  const group = screen.getByRole('group', { name: 'Кого позвать' })
  expect(within(group).getAllByRole('button')).toHaveLength(5)
  await userEvent.click(within(group).getByRole('button', { name: 'Отменили · 2' }))
  expect(within(group).getByRole('button', { name: 'Отменили · 2' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('status')).toHaveTextContent('cancel')
})

test('телефон и 4+ пунктов — выпадающий список вместо таблеток в несколько строк', async () => {
  screenWidth(390)
  render(<Filter />)
  expect(screen.queryByRole('group', { name: 'Кого позвать' })).toBeNull()
  const field = screen.getByRole('combobox', { name: 'Кого позвать' })
  expect(field).toHaveTextContent('Все')
  await userEvent.click(field)
  await userEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Не пришли/ }))
  expect(screen.getByRole('status')).toHaveTextContent('noshow')
})

test('телефон и 2–3 пункта — таблетки одной строкой, как были', () => {
  screenWidth(320)
  render(<Filter count={3} />)
  expect(within(screen.getByRole('group', { name: 'Кого позвать' })).getAllByRole('button')).toHaveLength(3)
  expect(screen.queryByRole('combobox')).toBeNull()
})

test('телефон, пункты со значком и названием — поле и лист с карточками: пояснение, число, выбранный отмечен', async () => {
  screenWidth(390)
  function Rich() {
    const [v, setV] = useState('all')
    return (
      <>
        <Segments label="Кого позвать" value={v} onChange={setV} options={[
          { value: 'all', label: 'Все', icon: '👥', name: 'Все', hint: 'Все, кого стоит позвать', count: '9' },
          { value: 'plan', label: 'Планы', icon: '🦷', name: 'Планы лечения', hint: 'Начали лечение и не закончили', count: '48 000 сом' },
          { value: 'cancel', label: 'Отменили', icon: '↩️', name: 'Отменили', count: '2' },
          { value: 'noshow', label: 'Не пришли', icon: '🚫', name: 'Не пришли', count: '1' },
        ]} />
        <output>{v}</output>
      </>
    )
  }
  render(<Rich />)
  await userEvent.click(screen.getByRole('button', { name: 'Кого позвать: Все · 9' }))
  const list = screen.getByRole('listbox', { name: 'Кого позвать' })
  expect(within(list).getByRole('option', { name: /Все/ })).toHaveAttribute('aria-selected', 'true')
  const plan = within(list).getByRole('option', { name: /Планы лечения/ })
  expect(plan).toHaveTextContent('Начали лечение и не закончили')
  expect(plan).toHaveTextContent('48 000 сом')
  await userEvent.click(plan)
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(screen.getByRole('status')).toHaveTextContent('plan')
  expect(screen.getByRole('button', { name: 'Кого позвать: Планы лечения · 48 000 сом' })).toBeInTheDocument()
})
