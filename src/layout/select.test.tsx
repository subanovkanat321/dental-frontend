import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { Select } from './Select'

function Doctors({ onPick = () => {} }: { onPick?: (v: string) => void }) {
  const [v, setV] = useState('')
  return (
    <label>Чья касса
      <Select value={v} onChange={(e) => { setV(e.target.value); onPick(e.target.value) }}>
        <option value="">Вся клиника</option>
        {[['1', 'Айгерим'], ['2', 'Дастан']].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </Select>
    </label>
  )
}

afterEach(() => vi.unstubAllGlobals())

test('нажать — список, выбрать пункт — значение в поле, список закрылся', async () => {
  const onPick = vi.fn()
  render(<Doctors onPick={onPick} />)
  const field = screen.getByRole('combobox', { name: 'Чья касса' })
  expect(field).toHaveTextContent('Вся клиника')
  await userEvent.click(field)
  const list = screen.getByRole('listbox', { name: 'Чья касса' })
  expect(within(list).getByRole('option', { name: 'Вся клиника' })).toHaveAttribute('aria-selected', 'true')
  await userEvent.click(within(list).getByRole('option', { name: 'Дастан' }))
  expect(onPick).toHaveBeenCalledWith('2')
  expect(field).toHaveTextContent('Дастан')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

test('клавиатура: ↓ открывает, ↓ ↓ Enter выбирает, Esc закрывает без выбора', async () => {
  const onPick = vi.fn()
  render(<Doctors onPick={onPick} />)
  screen.getByRole('combobox').focus()
  await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')
  expect(onPick).toHaveBeenCalledWith('2')
  await userEvent.keyboard('{ArrowDown}')
  expect(screen.getByRole('listbox')).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(onPick).toHaveBeenCalledTimes(1)
})

test('длинный список — с поиском; подсказка после « · » — серым, но в названии пункта', async () => {
  render(
    <Select aria-label="Материал со склада" value="">
      <option value="">Материал со склада…</option>
      {Array.from({ length: 10 }, (_, i) => <option key={i} value={i + 1}>{`Материал ${i + 1} · осталось ${i} шт`}</option>)}
    </Select>,
  )
  await userEvent.click(screen.getByRole('combobox'))
  await userEvent.type(screen.getByRole('searchbox', { name: 'Поиск в списке' }), 'риал 10')
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Материал 10 · осталось 9 шт'])
  await userEvent.clear(screen.getByRole('searchbox'))
  await userEvent.type(screen.getByRole('searchbox'), 'нет такого')
  expect(screen.getByText('Ничего не нашлось')).toBeInTheDocument()
})

test('в форме: name уходит в FormData, defaultValue — по умолчанию, подсказки «…» в списке нет', async () => {
  const sent: Record<string, string>[] = []
  render(
    <form aria-label="Лист ожидания" onSubmit={(e) => { e.preventDefault(); sent.push(Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>) }}>
      <Select name="minutes" aria-label="Сколько нужно времени" defaultValue={30}>
        <option value="" disabled>Сколько…</option>
        {[15, 30, 45].map((m) => <option key={m} value={m}>{m} мин</option>)}
      </Select>
      <button type="submit">Добавить</button>
    </form>,
  )
  await userEvent.click(screen.getByRole('combobox'))
  expect(screen.queryByRole('option', { name: 'Сколько…' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('option', { name: '45 мин' }))
  await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))
  expect(sent).toEqual([{ minutes: '45' }])
})

test('телефон — лист снизу с заголовком из подписи поля; нажали на фон — закрылся', async () => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width'), addEventListener() {}, removeEventListener() {} }))
  render(<Doctors />)
  await userEvent.click(screen.getByRole('combobox'))
  const list = screen.getByRole('listbox', { name: 'Чья касса' })
  expect(list.closest('.ui-select-pop')).toHaveClass('sheet')
  expect(screen.getByText('Чья касса', { selector: '.ui-select-title' })).toBeInTheDocument()
  await userEvent.click(document.querySelector('.ui-select-backdrop')!)
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  // «✕» в шапке листа — тоже закрывает (на iPhone нажатие на фон не всегда срабатывало)
  await userEvent.click(screen.getByRole('combobox'))
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

test('группы (<optgroup>): заголовки с role="group", стрелки их пропускают, поиск — без «ё/е» и по названию группы', async () => {
  const onPick = vi.fn()
  render(
    <Select aria-label="Услуга" value="" onChange={(e) => onPick(e.target.value)}>
      <option value="">Найти услугу…</option>
      <optgroup label="Терапия">
        <option value="1">Лечение кариеса</option>
        <option value="2">Пломба</option>
      </optgroup>
      <optgroup label="Детская стоматология">
        {['Осмотр ребёнка', 'Лечение молочного зуба', 'Серебрение', 'Герметизация', 'Фторирование', 'Удаление молочного', 'Пластинка']
          .map((name, i) => <option key={name} value={10 + i}>{name}</option>)}
      </optgroup>
    </Select>,
  )
  screen.getByRole('combobox').focus()
  await userEvent.keyboard('{ArrowDown}')
  const list = screen.getByRole('listbox', { name: 'Услуга' })
  const groups = within(list).getAllByRole('group')
  expect(groups).toHaveLength(2)
  expect(groups[0]).toHaveAccessibleName('Терапия')
  expect(within(groups[1]!).getAllByRole('option')).toHaveLength(7)
  // Первый пункт подсвечен; ↓ ↓ — через заголовок «Детская стоматология» сразу к «Осмотр ребёнка»
  await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
  expect(onPick).toHaveBeenCalledWith('10')

  await userEvent.click(screen.getByRole('combobox'))
  await userEvent.type(screen.getByRole('searchbox', { name: 'Поиск в списке' }), 'РЕБЕНКА')
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Осмотр ребёнка'])
  expect(screen.getByRole('group')).toHaveAccessibleName('Детская стоматология')
  await userEvent.clear(screen.getByRole('searchbox'))
  await userEvent.type(screen.getByRole('searchbox'), 'терап')
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Лечение кариеса', 'Пломба'])
})
