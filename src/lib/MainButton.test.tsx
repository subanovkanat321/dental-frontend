import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { MainButton } from './MainButton'

afterEach(() => {
  delete window.Telegram
})

function fakeMainButton() {
  const button = {
    setText: vi.fn(), show: vi.fn(), hide: vi.fn(), enable: vi.fn(), disable: vi.fn(),
    showProgress: vi.fn(), hideProgress: vi.fn(), onClick: vi.fn(), offClick: vi.fn(),
  }
  window.Telegram = { WebApp: { initData: 'query_id=1&hash=abc', ready() {}, expand() {}, MainButton: button } } as unknown as typeof window.Telegram
  return button
}

/** Как форма записи: пока имя пустое — «Дальше», с первой буквы — «Записаться». */
function Form() {
  const [name, setName] = useState('')
  return (
    <>
      <input aria-label="Имя" value={name} onChange={(e) => setName(e.target.value)} />
      <MainButton text={name ? 'Записаться' : 'Дальше'} onClick={() => {}} />
    </>
  )
}

test('iPhone: пока печатают, надпись MainButton не меняется (иначе Telegram закрывает клавиатуру), после — меняется', () => {
  const button = fakeMainButton()
  render(<Form />)
  expect(button.setText).toHaveBeenLastCalledWith('Дальше')
  const input = screen.getByRole('textbox', { name: 'Имя' })
  input.focus()
  fireEvent.change(input, { target: { value: 'А' } })
  expect(button.setText).toHaveBeenCalledTimes(1)
  vi.useFakeTimers()
  input.blur()
  vi.runAllTimers()
  vi.useRealTimers()
  expect(button.setText).toHaveBeenLastCalledWith('Записаться')
})
