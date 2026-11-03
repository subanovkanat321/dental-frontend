import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { MainButton } from './MainButton'

afterEach(() => {
  delete window.Telegram
})

test('в Telegram — своя кнопка внизу экрана, MainButton Telegram спрятан (он не везде виден)', async () => {
  const native = { setText: vi.fn(), show: vi.fn(), hide: vi.fn(), enable: vi.fn(), disable: vi.fn(),
    showProgress: vi.fn(), hideProgress: vi.fn(), onClick: vi.fn(), offClick: vi.fn() }
  window.Telegram = { WebApp: { initData: 'query_id=1&hash=abc', ready() {}, expand() {}, MainButton: native } } as unknown as typeof window.Telegram
  const click = vi.fn()
  render(<MainButton text="Записаться" onClick={click} />)
  expect(native.hide).toHaveBeenCalled()
  expect(native.show).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Записаться' }))
  expect(click).toHaveBeenCalledTimes(1)
})

test('занято — кнопка выключена', () => {
  render(<MainButton text="Записаться" busy onClick={() => {}} />)
  expect(screen.getByRole('button', { name: 'Записаться' })).toBeDisabled()
})
