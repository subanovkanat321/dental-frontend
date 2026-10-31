import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { appointment, me, renderApp } from './test/fixtures'
import { server } from './test/server'

test('не вошли (401) — экран входа со ссылкой на «Войти через Telegram»', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ detail: 'Войдите' }, { status: 401 })))
  renderApp()
  expect(await screen.findByRole('link', { name: 'Войти через Telegram' })).toHaveAttribute('href', '/login?next=/crm/')
})

test('расписание: все врачи колонками, нажать на приём — карточка справа, Esc — закрыть', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => {
      const doctorId = new URL(request.url).searchParams.get('doctorId')
      return HttpResponse.json(doctorId === '1'
        ? [appointment(10, 1, '10:00', 'Бакыт М.', { serviceName: 'Осмотр', reply: 'CONFIRMED' })]
        : [appointment(20, 2, '11:30', 'Айгуль Т.')])
    }),
  )
  renderApp()
  expect(await screen.findByRole('group', { name: 'Айгерим Садыкова' })).toBeInTheDocument()
  expect(screen.getByRole('group', { name: 'Дастан Т.' })).toBeInTheDocument()
  expect(await screen.findByText('Записей: 2')).toBeInTheDocument()

  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  expect(panel).toHaveTextContent('Бакыт М.')
  expect(panel).toHaveTextContent('+996 555 123 456')
  expect(panel).toHaveTextContent('Осмотр')
  expect(screen.getByRole('link', { name: 'Открыть в приложении' })).toHaveAttribute('href', '/?appointment=10')

  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('complementary', { name: 'Карточка приёма' })).not.toBeInTheDocument()
})

test('пациенту — «для клиник», расписания нет', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ doctor: false })))
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Tish CRM — для клиник' })).toBeInTheDocument()
})
