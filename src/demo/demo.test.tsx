import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { DEMO_SIGNUP, demoRole, markDemoTourSeen } from '../lib/demo'
import { isDemoPath } from '../lib/route'
import { About } from '../site/About'
import { Go } from '../site/Go'
import { Tour } from '../site/Tour'
import { fetchTour } from '../tour/state'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

const SESSION: Schemas['DemoControllerSession'] = {
  role: 'OWNER',
  roles: [{ role: 'OWNER', label: 'Руководитель и врач' }, { role: 'RECEPTION', label: 'Регистратура' }, { role: 'DOCTOR', label: 'Врач' }],
}

function demoCookie(role: string | null) {
  document.cookie = role ? `tish_demo=${role}; path=/` : 'tish_demo=; path=/; max-age=0'
}

afterEach(() => {
  demoCookie(null)
  sessionStorage.clear()
  vi.unstubAllGlobals()
})

test('метка демо: роль из cookie tish_demo, пустая или чужая — не демо', () => {
  expect(demoRole('a=1; tish_demo=reception; b=2')).toBe('reception')
  expect(demoRole('tish_demo=')).toBeNull()
  expect(demoRole('dental_session=x')).toBeNull()
  expect(isDemoPath('/demo')).toBe(true)
  expect(isDemoPath('/Demo/')).toBe(true)
  expect(isDemoPath('/demos')).toBe(false)
  expect(DEMO_SIGNUP).toBe('/start?from=demo')
})

test('/demo: входит гостем нужной ролью и открывает CRM', async () => {
  const sent: unknown[] = []
  server.use(http.post('*/web/demo/enter', async ({ request }) => {
    sent.push(await request.json())
    return HttpResponse.json({ role: 'RECEPTION', expiresAt: '2026-11-21T10:00:00Z' } satisfies Schemas['DemoControllerEntered'])
  }))
  const replace = vi.fn()
  vi.stubGlobal('location', { ...window.location, pathname: '/demo', search: '?as=reception', hash: '', replace, origin: window.location.origin })

  renderApp()

  await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
  expect(sent).toEqual([{ role: 'RECEPTION' }])
})

test('/demo: демо выключено — понятный текст и «Начать бесплатно»', async () => {
  server.use(http.post('*/web/demo/enter', () => HttpResponse.json({ status: 404, detail: 'Демо-клиника сейчас выключена' }, { status: 404 })))
  vi.stubGlobal('location', { ...window.location, pathname: '/demo', search: '', hash: '', replace: vi.fn(), origin: window.location.origin })

  renderApp()

  expect(await screen.findByRole('alert')).toHaveTextContent('Демо-клиника сейчас выключена')
  expect(screen.getByRole('link', { name: 'Начать бесплатно' })).toHaveAttribute('href', DEMO_SIGNUP)
})

test('плашка демо на экранах CRM: вымышленные данные, «Начать бесплатно →», «Смотреть как» и «Выйти из демо»', async () => {
  demoCookie('owner')
  const roles: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/demo/session', () => HttpResponse.json(SESSION)),
    http.post('*/api/demo/role', async ({ request }) => {
      roles.push(await request.json())
      return HttpResponse.json({ role: 'RECEPTION', expiresAt: '2026-11-21T10:00:00Z' } satisfies Schemas['DemoControllerEntered'])
    }),
  )
  const reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload, origin: window.location.origin, pathname: '/', search: '', hash: '' })
  const user = userEvent.setup()

  renderApp()

  const banner = await screen.findByRole('note', { name: 'Демо-клиника' })
  expect(banner).toHaveTextContent('Это демо-клиника с вымышленными данными')
  expect(screen.getByRole('link', { name: 'Начать бесплатно →' })).toHaveAttribute('href', '/start?from=demo')
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Смотреть как' }), 'RECEPTION')
  await waitFor(() => expect(reload).toHaveBeenCalled())
  expect(roles).toEqual([{ role: 'RECEPTION' }])
  expect(screen.getByRole('button', { name: 'Выйти из демо' })).toBeInTheDocument()
})

test('вне демо плашки нет и запроса /api/demo/session нет', async () => {
  let asked = false
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)), http.get('*/api/demo/session', () => {
    asked = true
    return HttpResponse.json(SESSION)
  }))

  renderApp()

  await screen.findByRole('navigation', { name: 'Разделы' })
  expect(screen.queryByRole('note', { name: 'Демо-клиника' })).toBeNull()
  expect(asked).toBe(false)
})

test('тур в демо: отметку помнит вкладка, сервер не спрашиваем', async () => {
  demoCookie('owner')
  let asked = false
  server.use(http.get('*/api/me/tour', () => {
    asked = true
    return HttpResponse.json({ seenAt: null })
  }))

  expect(await fetchTour()).toEqual({ seenAt: null })
  expect(asked).toBe(true)
  asked = false
  const at = markDemoTourSeen()
  expect(await fetchTour()).toEqual({ seenAt: at })
  expect(asked).toBe(false)
})

test('«Посмотреть демо» на /about, /go и /tour — только когда демо включено на сервере', async () => {
  const about = render(<About />)
  expect(screen.queryByRole('link', { name: /Посмотреть демо/ })).toBeNull()
  about.unmount()

  server.use(http.get('*/web/demo', () => HttpResponse.json({ enabled: true } satisfies Schemas['DemoControllerInfo'])))
  const shown = render(<About />)
  const links = await screen.findAllByRole('link', { name: /Посмотреть демо/ })
  expect(links.length).toBeGreaterThanOrEqual(2)
  for (const a of links) expect(a).toHaveAttribute('href', '/demo')
  shown.unmount()

  const go = render(<Go />)
  expect(await screen.findByRole('link', { name: /Посмотреть демо/ })).toHaveAttribute('href', '/demo')
  go.unmount()

  render(<Tour />)
  expect(await screen.findByRole('link', { name: /Посмотреть демо/ })).toHaveAttribute('href', '/demo')
})
