import { render, screen } from '@testing-library/react'

import { ErrorBoundary } from './ErrorBoundary'

function Broken(): never {
  throw new Error('сломалось')
}

test('упал экран — «Что-то пошло не так» и «Обновить», а не белый экран', () => {
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
  render(<ErrorBoundary><Broken /></ErrorBoundary>)
  expect(screen.getByRole('alert')).toHaveTextContent('Что-то пошло не так')
  expect(screen.getByRole('button', { name: 'Обновить' })).toBeInTheDocument()
  quiet.mockRestore()
})

test('после обновления сервера старый кусок кода не загрузился — перезагрузка один раз', () => {
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
  const reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload })
  sessionStorage.clear()
  function Stale(): never {
    throw new TypeError('Failed to fetch dynamically imported module: /assets/CashPage-old.js')
  }
  render(<ErrorBoundary><Stale /></ErrorBoundary>)
  render(<ErrorBoundary><Stale /></ErrorBoundary>)
  expect(reload).toHaveBeenCalledTimes(1)
  vi.unstubAllGlobals()
  quiet.mockRestore()
})
