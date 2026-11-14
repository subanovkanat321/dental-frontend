import { act, render, screen } from '@testing-library/react'

import { ErrorBoundary } from './ErrorBoundary'
import { waitForSlow } from '../test/wait'

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

test('упал экран — отчёт владельцу: текст ошибки и имя компонента, без props', async () => {
  const { http, HttpResponse } = await import('msw')
  const { server } = await import('../test/server')
  const { resetErrorReports } = await import('../lib/clientErrors')
  resetErrorReports()
  const bodies: Record<string, string>[] = []
  server.use(http.post('*/web/client-error', async ({ request }) => {
    bodies.push(await request.json() as Record<string, string>)
    return new HttpResponse(null, { status: 204 })
  }))
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
  function Card({ phone }: { phone: string }): never {
    throw new Error(phone ? 'карточка сломалась' : 'нет номера')
  }
  render(<ErrorBoundary><Card phone="0555 000 111" /></ErrorBoundary>)
  await waitForSlow(() => expect(bodies).toHaveLength(1))
  expect(bodies[0]!.message).toBe('Error: карточка сломалась')
  expect(bodies[0]!.stack).toContain('in Card')
  expect(JSON.stringify(bodies)).not.toContain('0555')
  quiet.mockRestore()
})

test('сменили подраздел (адрес #/…) — упавший экран не держит соседний', () => {
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
  let broken = true
  function Maybe() {
    if (broken) throw new Error('сломалось')
    return <p>Соседняя вкладка</p>
  }
  render(<ErrorBoundary><Maybe /></ErrorBoundary>)
  expect(screen.getByRole('alert')).toHaveTextContent('Что-то пошло не так')
  broken = false
  act(() => { window.dispatchEvent(new HashChangeEvent('hashchange')) })
  expect(screen.getByText('Соседняя вкладка')).toBeInTheDocument()
  quiet.mockRestore()
})
