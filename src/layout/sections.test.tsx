import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { backDepth } from '../lib/back'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

afterEach(() => {
  window.location.hash = ''
})

test('ушли в другой раздел и вернулись — поиск и прокрутка на месте; новый раздел — с начала', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/patients/recent', () => HttpResponse.json([])),
    http.get('*/api/patients', () => HttpResponse.json([])),
  )
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const user = userEvent.setup()
  renderApp()
  const nav = await screen.findByRole('navigation', { name: 'Разделы' })
  await user.click(within(nav).getByRole('button', { name: /^Пациенты/ }))
  const search = await screen.findByPlaceholderText('Имя или номер телефона')
  await user.type(search, 'Бакыт')
  // Пролистали «Пациентов» вниз и ушли в «Расписание»: оно открывается с начала
  Object.defineProperty(window, 'scrollY', { value: 640, configurable: true })
  window.dispatchEvent(new Event('scroll'))
  await user.click(within(nav).getByRole('button', { name: /Расписание/ }))
  expect(scrollTo).toHaveBeenLastCalledWith(0, 0)
  // Вернулись — тот же поиск и та же прокрутка
  await user.click(within(nav).getByRole('button', { name: /^Пациенты/ }))
  expect(screen.getByPlaceholderText('Имя или номер телефона')).toHaveValue('Бакыт')
  expect(scrollTo).toHaveBeenCalledWith(0, 640)
  scrollTo.mockRestore()
})

test('скрытый раздел не перехватывает «назад»: открытая карточка ждёт, пока вернёмся', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/patients/recent', () => HttpResponse.json([])),
    http.get('*/api/patients', () => HttpResponse.json([])),
  )
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const user = userEvent.setup()
  renderApp()
  const nav = await screen.findByRole('navigation', { name: 'Разделы' })
  await user.click(within(nav).getByRole('button', { name: /^Пациенты/ }))
  await user.click(await screen.findByRole('button', { name: /Новый пациент/ }))
  const withCard = backDepth()
  expect(withCard).toBeGreaterThan(0)
  await user.click(within(nav).getByRole('button', { name: /^Касса/ }))
  expect(backDepth()).toBeLessThan(withCard)
  await user.click(within(nav).getByRole('button', { name: /^Пациенты/ }))
  expect(backDepth()).toBe(withCard)
  vi.restoreAllMocks()
})
