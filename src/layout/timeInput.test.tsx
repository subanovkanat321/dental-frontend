import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { parseTime, suggestTime } from '../lib/time'
import { TimeInput } from './TimeInput'
import { waitForSlow } from '../test/wait'

function Field({ initial = '', step, disabled, min, max, onChange }: {
  initial?: string; step?: number; disabled?: boolean; min?: string; max?: string; onChange?: (v: string) => void
}) {
  const [time, setTime] = useState(initial)
  return (
    <>
      <label className="field"><span>Начало</span>
        <TimeInput value={time} step={step} disabled={disabled} min={min} max={max} onChange={(v) => { setTime(v); onChange?.(v) }} /></label>
      <output>{time}</output>
    </>
  )
}

test('показывает значение «15:30» (секунды отбрасывает), пустое — подсказка «чч:мм»', () => {
  const { unmount } = render(<Field initial="15:30:00" />)
  expect(screen.getByLabelText('Начало')).toHaveValue('15:30')
  unmount()
  render(<Field />)
  expect(screen.getByLabelText('Начало')).toHaveValue('')
  expect(screen.getByLabelText('Начало')).toHaveAttribute('placeholder', 'чч:мм')
})

test('панель: час, потом минута — значение выбрано, панель закрылась; системного поля времени нет', async () => {
  const user = userEvent.setup()
  const { container } = render(<Field initial="09:00" />)
  expect(container.querySelector('input[type=time]')).toBeNull()
  await user.click(screen.getByLabelText('Начало'))
  const panel = screen.getByRole('dialog', { name: 'Выбор времени' })
  const hours = within(panel).getByRole('group', { name: 'Час' })
  expect(within(hours).getAllByRole('button')).toHaveLength(24)
  expect(within(hours).getByRole('button', { name: '09 ч' })).toHaveAttribute('aria-pressed', 'true')
  const minutes = within(panel).getByRole('group', { name: 'Минуты' })
  // шаг по умолчанию — 5 минут: 00, 05 … 55
  expect(within(minutes).getAllByRole('button').map((b) => b.textContent)).toEqual(
    ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'])
  await user.click(within(hours).getByRole('button', { name: '15 ч' }))
  // час выбран — значение ещё прежнее, ждём минуту
  expect(screen.getByRole('status')).toHaveTextContent('09:00')
  await user.click(within(panel).getByRole('button', { name: '15:30' }))
  expect(screen.getByRole('status')).toHaveTextContent('15:30')
  expect(screen.getByLabelText('Начало')).toHaveValue('15:30')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('пустое поле: минуты закрыты, пока не выбран час', async () => {
  const user = userEvent.setup()
  render(<Field />)
  await user.click(screen.getByLabelText('Начало'))
  const minutes = screen.getByRole('group', { name: 'Минуты — сначала час' })
  expect(within(minutes).getAllByRole('button').every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
  await user.click(screen.getByRole('button', { name: '08 ч' }))
  await user.click(screen.getByRole('button', { name: '08:05' }))
  expect(screen.getByRole('status')).toHaveTextContent('08:05')
})

test('шаг 15 минут: 00, 15, 30, 45', async () => {
  const user = userEvent.setup()
  render(<Field initial="10:00" step={15} />)
  await user.click(screen.getByLabelText('Начало'))
  const minutes = screen.getByRole('group', { name: 'Минуты' })
  expect(within(minutes).getAllByRole('button').map((b) => b.textContent)).toEqual(['00', '15', '30', '45'])
  await user.click(within(minutes).getByRole('button', { name: '10:45' }))
  expect(screen.getByRole('status')).toHaveTextContent('10:45')
})

test('disabled: панель не открывается, набрать нельзя', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<Field initial="09:00" disabled onChange={onChange} />)
  const field = screen.getByLabelText('Начало')
  expect(field).toBeDisabled()
  await user.click(field)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(onChange).not.toHaveBeenCalled()
})

test('компьютер: время можно набрать цифрами — «1630» и «9:05»; недописанное не уходит наверх', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<Field initial="09:00" onChange={onChange} />)
  const field = screen.getByLabelText('Начало')
  await user.clear(field)
  await user.type(field, '163')
  expect(onChange).toHaveBeenLastCalledWith('')
  await user.type(field, '0')
  expect(screen.getByRole('status')).toHaveTextContent('16:30')
  await user.clear(field)
  await user.type(field, '9:05')
  expect(screen.getByRole('status')).toHaveTextContent('09:05')
  // ушли с недописанным — в поле снова последнее верное
  await user.type(field, '{Backspace}')
  await user.tab()
  expect(field).toHaveValue('09:05')
})

test('клавиатура: ↓ открывает панель, стрелки по часам, Enter выбирает, Esc закрывает', async () => {
  const user = userEvent.setup()
  render(<Field initial="09:00" />)
  const field = screen.getByLabelText('Начало')
  field.focus()
  await user.keyboard('{ArrowDown}')
  const panel = await screen.findByRole('dialog', { name: 'Выбор времени' })
  await waitForSlow(() => expect(within(panel).getByRole('button', { name: '09 ч' })).toHaveFocus())
  await user.keyboard('{ArrowRight}{ArrowDown}')
  expect(within(panel).getByRole('button', { name: '16 ч' })).toHaveFocus()
  await user.keyboard('{Enter}')
  await waitForSlow(() => expect(within(panel).getByRole('button', { name: '16:00' })).toHaveFocus())
  await user.keyboard('{ArrowRight}{Enter}')
  expect(screen.getByRole('status')).toHaveTextContent('16:05')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.keyboard('{ArrowDown}')
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('min/max: часы и минуты вне рамок закрыты', async () => {
  const user = userEvent.setup()
  render(<Field initial="09:30" min="09:15" max="18:00" step={15} />)
  await user.click(screen.getByLabelText('Начало'))
  expect(screen.getByRole('button', { name: '08 ч' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '19 ч' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '09:00' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '09:15' })).toBeEnabled()
})

test('Telegram: пока панель открыта — подтверждение закрытия Mini App, закрыли — снято', async () => {
  const on = vi.fn()
  const off = vi.fn()
  window.Telegram = { WebApp: { initData: 'signed', ready() {}, expand() {}, enableClosingConfirmation: on, disableClosingConfirmation: off } }
  try {
    const user = userEvent.setup()
    render(<Field initial="09:00" />)
    await user.click(screen.getByLabelText('Начало'))
    expect(on).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: '09:15' }))
    expect(off).toHaveBeenCalled()
  } finally {
    delete window.Telegram
  }
})

test('parseTime: полное время — да, недописанное и неверное — нет', () => {
  expect(parseTime('9:30')).toBe('09:30')
  expect(parseTime('0930')).toBe('09:30')
  expect(parseTime('16:3')).toBeNull()
  expect(parseTime('24:00')).toBeNull()
  expect(parseTime('12:60')).toBeNull()
})

test('suggestTime: сегодня — вверх до 5 минут (22:43 → 22:45), не раньше начала работы; другой день — начало работы или 09:00', () => {
  const now = new Date('2026-11-02T22:43:00+06:00')
  expect(suggestTime('2026-11-02', '09:00:00', 5, now)).toBe('22:45')
  expect(suggestTime('2026-11-02', null, 5, new Date('2026-11-02T10:50:00+06:00'))).toBe('10:50')
  expect(suggestTime('2026-11-02', '09:00:00', 5, new Date('2026-11-02T07:12:00+06:00'))).toBe('09:00')
  expect(suggestTime('2026-11-02', null, 5, new Date('2026-11-02T23:58:00+06:00'))).toBe('23:55')
  expect(suggestTime('2026-11-03', '08:30:00', 5, now)).toBe('08:30')
  expect(suggestTime('2026-11-03', undefined, 5, now)).toBe('09:00')
})
