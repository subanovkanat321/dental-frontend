import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { parseTime, suggestTime, workHours } from '../lib/time'
import { TimeInput } from './TimeInput'
import { waitForSlow } from '../test/wait'

function Field({ initial = '', step, disabled, min, max, hours, free, onChange }: {
  initial?: string; step?: number; disabled?: boolean; min?: string; max?: string; hours?: { from: number; to: number }; free?: string[]; onChange?: (v: string) => void
}) {
  const [time, setTime] = useState(initial)
  return (
    <>
      <label className="field"><span>Начало</span>
        <TimeInput value={time} step={step} disabled={disabled} min={min} max={max} hours={hours} free={free} onChange={(v) => { setTime(v); onChange?.(v) }} /></label>
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
  // без часов работы — обычный день клиники 07…21, а не все 24
  expect(within(hours).getAllByRole('button').map((b) => b.textContent)).toEqual(
    ['07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21'])
  expect(within(hours).getByRole('button', { name: '09 ч' })).toHaveAttribute('aria-pressed', 'true')
  const minutes = within(panel).getByRole('group', { name: 'Минуты' })
  // сразу — четверти часа, остальные через 5 минут — по «Точнее…»
  expect(within(minutes).getAllByRole('button').map((b) => b.textContent)).toEqual(['00', '15', '30', '45'])
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
  await user.click(screen.getByRole('button', { name: '08:15' }))
  expect(screen.getByRole('status')).toHaveTextContent('08:15')
})

test('шаг 15 минут: 00, 15, 30, 45 — и никакого «Точнее…»', async () => {
  const user = userEvent.setup()
  render(<Field initial="10:00" step={15} />)
  await user.click(screen.getByLabelText('Начало'))
  const minutes = screen.getByRole('group', { name: 'Минуты' })
  expect(within(minutes).getAllByRole('button').map((b) => b.textContent)).toEqual(['00', '15', '30', '45'])
  expect(screen.queryByRole('button', { name: 'Точнее…' })).not.toBeInTheDocument()
  await user.click(within(minutes).getByRole('button', { name: '10:45' }))
  expect(screen.getByRole('status')).toHaveTextContent('10:45')
})

test('шаг 10 минут: все по шагу сразу (не четверти), без «Точнее…»', async () => {
  const user = userEvent.setup()
  render(<Field initial="10:00" step={10} />)
  await user.click(screen.getByLabelText('Начало'))
  expect(within(screen.getByRole('group', { name: 'Минуты' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['00', '10', '20', '30', '40', '50'])
  expect(screen.queryByRole('button', { name: 'Точнее…' })).not.toBeInTheDocument()
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
  expect(screen.getByRole('status')).toHaveTextContent('16:15')
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

test('часы работы: сначала только они, «Другие часы» — все 24', async () => {
  const user = userEvent.setup()
  render(<Field initial="10:00" hours={{ from: 8, to: 19 }} />)
  await user.click(screen.getByLabelText('Начало'))
  const hours = screen.getByRole('group', { name: 'Час' })
  expect(within(hours).getAllByRole('button').map((b) => b.textContent)).toEqual(
    ['08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19'])
  await user.click(screen.getByRole('button', { name: 'Другие часы' }))
  expect(within(hours).getAllByRole('button')).toHaveLength(24)
  expect(screen.queryByRole('button', { name: 'Другие часы' })).not.toBeInTheDocument()
  await user.click(within(hours).getByRole('button', { name: '22 ч' }))
  await user.click(screen.getByRole('button', { name: '22:30' }))
  expect(screen.getByRole('status')).toHaveTextContent('22:30')
})

test('время вне часов работы — все 24 часа раскрыты сразу', async () => {
  const user = userEvent.setup()
  render(<Field initial="22:20" hours={{ from: 8, to: 19 }} />)
  await user.click(screen.getByLabelText('Начало'))
  expect(within(screen.getByRole('group', { name: 'Час' })).getAllByRole('button')).toHaveLength(24)
  expect(screen.getByRole('button', { name: '22 ч' })).toHaveAttribute('aria-pressed', 'true')
  // 20 минут — не четверть: минуты через 5 тоже раскрыты, выбранная видна
  expect(screen.getByRole('button', { name: '22:20' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('button', { name: 'Точнее…' })).not.toBeInTheDocument()
})

test('ночная смена 18–7: часы по порядку смены — 18…23, потом 00…07', async () => {
  const user = userEvent.setup()
  render(<Field initial="23:00" hours={{ from: 18, to: 7 }} />)
  await user.click(screen.getByLabelText('Начало'))
  expect(within(screen.getByRole('group', { name: 'Час' })).getAllByRole('button').map((b) => b.textContent)).toEqual(
    ['18', '19', '20', '21', '22', '23', '00', '01', '02', '03', '04', '05', '06', '07'])
  await user.click(screen.getByRole('button', { name: '02 ч' }))
  await user.click(screen.getByRole('button', { name: '02:45' }))
  expect(screen.getByRole('status')).toHaveTextContent('02:45')
})

test('«Точнее…» — минуты через 5', async () => {
  const user = userEvent.setup()
  render(<Field initial="09:00" />)
  await user.click(screen.getByLabelText('Начало'))
  await user.click(screen.getByRole('button', { name: 'Точнее…' }))
  expect(within(screen.getByRole('group', { name: 'Минуты' })).getAllByRole('button').map((b) => b.textContent)).toEqual(
    ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'])
  await user.click(screen.getByRole('button', { name: '09:05' }))
  expect(screen.getByRole('status')).toHaveTextContent('09:05')
})

test('workHours: часы врача → диапазон листа, ночная смена — from > to', () => {
  expect(workHours('08:00:00', '20:00:00')).toEqual({ from: 8, to: 19 })
  expect(workHours('08:30', '20:30')).toEqual({ from: 8, to: 20 })
  expect(workHours('09:00', '00:00')).toEqual({ from: 9, to: 23 })
  expect(workHours('18:00:00', '08:00:00')).toEqual({ from: 18, to: 7 })
  expect(workHours(null, '18:00')).toBeUndefined()
})

describe('телефон: лист снизу', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('pointer: coarse'), addEventListener() {}, removeEventListener() {} }))
  })
  afterEach(() => vi.unstubAllGlobals())

  test('сменили только час — время в шапке, поле прежнее; «Готово» применяет с прежней минутой', async () => {
    const user = userEvent.setup()
    render(<Field initial="09:30" />)
    await user.click(screen.getByLabelText('Начало'))
    const sheet = screen.getByRole('dialog', { name: 'Выбор времени' })
    await user.click(within(sheet).getByRole('button', { name: '14 ч' }))
    expect(within(sheet).getByText('14:30')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('09:30')
    await user.click(within(sheet).getByRole('button', { name: 'Готово' }))
    expect(screen.getByRole('status')).toHaveTextContent('14:30')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('выбор минуты — сразу «Готово»: применено и закрыто', async () => {
    const user = userEvent.setup()
    render(<Field initial="09:30" />)
    await user.click(screen.getByLabelText('Начало'))
    await user.click(screen.getByRole('button', { name: '11 ч' }))
    await user.click(screen.getByRole('button', { name: '11:45' }))
    expect(screen.getByRole('status')).toHaveTextContent('11:45')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('«✕», потянуть шапку вниз и фон — закрыть без изменений', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Field initial="09:30" onChange={onChange} />)
    const field = screen.getByLabelText('Начало')
    await user.click(field)
    await user.click(screen.getByRole('button', { name: '14 ч' }))
    await user.click(screen.getByRole('button', { name: 'Закрыть без изменений' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(field).toHaveValue('09:30')
    // открыли снова — в шапке снова прежнее время, а не брошенный выбор
    await user.click(field)
    expect(within(screen.getByRole('dialog')).getByText('09:30')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '09 ч' })).toHaveAttribute('aria-pressed', 'true')
    const head = screen.getByRole('dialog').querySelector('.ui-select-head')!
    // Ручка и шапка: тянем вниз дальше четверти высоты листа (layout/useSwipeDown.ts)
    fireEvent.touchStart(head, { touches: [{ identifier: 1, clientX: 50, clientY: 0 }] })
    fireEvent.touchMove(head, { touches: [{ identifier: 1, clientX: 50, clientY: 300 }] })
    fireEvent.touchEnd(head, { touches: [], changedTouches: [{ identifier: 1, clientX: 50, clientY: 300 }] })
    // Лист сперва уезжает вниз (180 мс), потом закрывается
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(field)
    await user.click(screen.getByRole('button', { name: '15 ч' }))
    await user.click(document.querySelector('.ui-select-backdrop')!)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  test('«Свободно»: чип — выбрать и закрыть; время вне min/max не показываем', async () => {
    const user = userEvent.setup()
    render(<Field initial="" free={['09:00', '09:30:00', '20:00']} max="19:00" />)
    await user.click(screen.getByLabelText('Начало'))
    const free = screen.getByRole('group', { name: 'Свободно' })
    expect(within(free).getAllByRole('button').map((b) => b.textContent)).toEqual(['09:00', '09:30'])
    expect(screen.getByRole('button', { name: 'Готово' })).toBeDisabled()
    await user.click(within(free).getByRole('button', { name: '09:30' }))
    expect(screen.getByRole('status')).toHaveTextContent('09:30')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
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
