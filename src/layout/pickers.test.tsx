import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { DateInput } from './DateInput'
import { MonthPicker } from './MonthPicker'
import { pickDate } from '../test/date'

function Month({ initial, max }: { initial: string; max?: string }) {
  const [month, setMonth] = useState(initial)
  return <><MonthPicker label="Месяц" value={month} max={max} onChange={setMonth} /><output>{month}</output></>
}

test('месяц: «‹ Ноябрь 2026 ›», стрелки через год, окошко с месяцами, будущее закрыто', async () => {
  render(<Month initial="2026-01" max="2026-11" />)
  const picker = screen.getByRole('group', { name: 'Месяц' })
  expect(within(picker).getByRole('button', { expanded: false })).toHaveTextContent('Январь 2026')
  await userEvent.click(within(picker).getByRole('button', { name: 'Предыдущий месяц' }))
  expect(screen.getByRole('status')).toHaveTextContent('2025-12')
  await userEvent.click(within(picker).getByRole('button', { expanded: false }))
  const dialog = within(picker).getByRole('dialog', { name: 'Выбор месяца' })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Следующий год' }))
  expect(within(dialog).getByRole('button', { name: 'Декабрь 2026' })).toBeDisabled()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Ноябрь 2026' }))
  expect(screen.getByRole('status')).toHaveTextContent('2026-11')
  expect(within(picker).queryByRole('dialog')).not.toBeInTheDocument()
  expect(within(picker).getByRole('button', { name: 'Следующий месяц' })).toBeDisabled()
})

test('дата: по-русски, свой календарь вместо системного — месяц, год, день; «Сегодня» и «Очистить»', async () => {
  function Day() {
    const [day, setDay] = useState('2026-11-02')
    return <label className="field"><span>День</span><DateInput weekday value={day} onChange={(e) => setDay(e.target.value)} /></label>
  }
  render(<Day />)
  const field = screen.getByLabelText('День')
  expect(field).toHaveTextContent('пн, 2 ноября 2026')
  await pickDate(field, '1985-03-14')
  expect(field).toHaveTextContent('чт, 14 марта 1985')
  // Открыть ещё раз — календарь на выбранном месяце, Esc закрывает
  await userEvent.click(field)
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByRole('button', { name: /Март 1985/ })).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: 'чт, 14 марта 1985' })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('дата: min/max — дни вне диапазона не выбрать', async () => {
  render(<label className="field"><span>Доплатит до</span><DateInput value="" min="2026-11-10" max="2026-11-20" onChange={() => {}} /></label>)
  await userEvent.click(screen.getByLabelText('Доплатит до'))
  const dialog = screen.getByRole('dialog')
  expect(dialog.querySelector('[data-date="2026-11-09"]')).toBeDisabled()
  expect(dialog.querySelector('[data-date="2026-11-15"]')).toBeEnabled()
})

test('дата рождения: пустое поле открывается на выборе года, без «Сегодня»; год → месяц → день', async () => {
  function Birth() {
    const [day, setDay] = useState('')
    return <label className="field"><span>Дата рождения</span><DateInput birth min="1900-01-01" max="2026-11-03" value={day} onChange={(e) => setDay(e.target.value)} /></label>
  }
  render(<Birth />)
  const field = screen.getByLabelText('Дата рождения')
  await userEvent.click(field)
  const dialog = screen.getByRole('dialog')
  // Сразу годы вокруг 1990, «Сегодня» для даты рождения не нужна
  expect(within(dialog).getByRole('button', { name: '1990' })).toBeInTheDocument()
  expect(within(dialog).queryByRole('button', { name: 'Сегодня' })).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await pickDate(field, '1978-07-21')
  expect(field).toHaveTextContent('21 июля 1978')
})
