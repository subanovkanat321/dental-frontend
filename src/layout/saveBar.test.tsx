import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { confirmLeave, LEAVE_TEXT, useDirty } from '../lib/unsaved'
import { SaveBar } from './SaveBar'

/** Ответ «сервера»: тест сам решает, когда сохранение закончится. */
let finish: (() => void) | null = null

/** Форма-образец: поле, «сохранение» по кнопке — успех или ошибка сервера, как скажет тест. */
function Form({ fail = false }: { fail?: boolean }) {
  const [name, setName] = useState('Улыбка')
  const { dirty, commit } = useDirty({ name })
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const save = () => {
    setState('saving')
    finish = () => {
      if (fail) {
        setState('error')
      } else {
        commit()
        setState('saved')
      }
    }
  }
  return (
    <form aria-label="Образец" onSubmit={(e) => { e.preventDefault(); save() }}>
      <label>Название<input value={name} onChange={(e) => { setState('idle'); setName(e.target.value) }} /></label>
      <SaveBar dirty={dirty} saving={state === 'saving'} saved={state === 'saved'} savedText="Название сохранено"
        error={state === 'error' ? 'Сервер недоступен' : null} />
    </form>
  )
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete window.Telegram
})

test('правок нет — полосы нет; правка — «Есть несохранённые изменения» и «Сохранить»', async () => {
  const user = userEvent.setup()
  render(<Form />)
  expect(screen.queryByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument()
  expect(screen.queryByText('Есть несохранённые изменения')).not.toBeInTheDocument()

  await user.type(screen.getByRole('textbox', { name: 'Название' }), '+')
  expect(screen.getByText('Есть несохранённые изменения')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled()

  // Вернули как было — правок снова нет
  await user.type(screen.getByRole('textbox', { name: 'Название' }), '{Backspace}')
  expect(screen.queryByText('Есть несохранённые изменения')).not.toBeInTheDocument()
})

test('сохранить: «Сохраняем…», потом «✅ Название сохранено» на 3 секунды; вибрация в Telegram', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const haptic = vi.fn()
  window.Telegram = { WebApp: { initData: 'test', ready() {}, expand() {}, HapticFeedback: { notificationOccurred: haptic } } } as unknown as typeof window.Telegram
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(<Form />)
  await user.type(screen.getByRole('textbox', { name: 'Название' }), '!')
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect(screen.getByRole('status')).toHaveTextContent('Сохраняем…')
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()

  act(() => finish?.())
  expect(screen.getByText('Название сохранено')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('✅ Название сохранено')
  expect(screen.queryByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument()
  expect(haptic).toHaveBeenCalledWith('success')

  act(() => { vi.advanceTimersByTime(3100) })
  expect(screen.queryByText('Название сохранено')).not.toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test('ошибка: красный текст остаётся, кнопка — тоже, можно повторить', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(<Form fail />)
  await user.type(screen.getByRole('textbox', { name: 'Название' }), '!')
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  act(() => finish?.())
  expect(screen.getByRole('alert')).toHaveTextContent('Сервер недоступен')
  act(() => { vi.advanceTimersByTime(10_000) })
  expect(screen.getByRole('alert')).toHaveTextContent('Сервер недоступен')
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled()
})

test('уход с несохранённым: спрашиваем; правок нет — не спрашиваем', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const user = userEvent.setup()
  const { unmount } = render(<Form />)
  expect(confirmLeave()).toBe(true)
  expect(confirm).not.toHaveBeenCalled()

  await user.type(screen.getByRole('textbox', { name: 'Название' }), '!')
  expect(confirmLeave()).toBe(false)
  expect(confirm).toHaveBeenCalledWith(LEAVE_TEXT)

  // Форма ушла с экрана — и правок больше нет
  unmount()
  confirm.mockClear()
  expect(confirmLeave()).toBe(true)
  expect(confirm).not.toHaveBeenCalled()
})
