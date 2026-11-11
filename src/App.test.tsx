import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { appointment, me, renderApp } from './test/fixtures'
import { server } from './test/server'

test('не вошли (401) — вход по номеру и паролю, кнопки «Войти через Telegram» нет; вошли — CRM', async () => {
  let session = false
  let posted: unknown = null
  server.use(
    http.get('*/api/patient/me', () => (session ? HttpResponse.json(me) : HttpResponse.json({ detail: 'Войдите' }, { status: 401 }))),
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot', smsLogin: false, passwordLogin: true, telegramCode: true })),
    http.post('*/web/login/phone/password', async ({ request }) => {
      posted = await request.json()
      session = true
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('*/api/appointments', () => HttpResponse.json([])),
  )
  window.history.replaceState(null, '', '/login')
  const user = userEvent.setup()
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Вход для клиники' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Telegram/ })).not.toBeInTheDocument()
  expect(await screen.findByText(/Нет пароля\? Нажмите «Забыли пароль\? \/ Первый вход» — пришлём код в Telegram/)).toBeInTheDocument()
  await user.type(await screen.findByRole('textbox', { name: 'Номер телефона' }), '0700 000 031')
  await user.type(screen.getByLabelText('Пароль'), 'Тишина2026')
  await user.click(screen.getByRole('button', { name: 'Войти' }))
  expect(await screen.findByRole('navigation', { name: 'Разделы' })).toBeInTheDocument()
  expect(posted).toEqual({ phone: '0700 000 031', password: 'Тишина2026' })
  // Скрипт окна входа Telegram больше не грузится
  expect(document.querySelector('script[src*="telegram-widget"]')).toBeNull()
  // Вошли — адрес чистый, без /login
  expect(window.location.pathname).toBe('/')
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
  expect(await screen.findByText(/Записей: 2/)).toBeInTheDocument()

  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  expect(panel).toHaveTextContent('Бакыт М.')
  expect(panel).toHaveTextContent('+996 555 123 456')
  expect(panel).toHaveTextContent('Осмотр')
  // Прежнего приложения больше нет — ссылки на него в карточке тоже
  expect(screen.queryByRole('link', { name: 'Открыть в приложении' })).not.toBeInTheDocument()

  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('complementary', { name: 'Карточка приёма' })).not.toBeInTheDocument()
})

test('пациенту — «для клиник», расписания нет', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ doctor: false })))
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Tish CRM — для клиник' })).toBeInTheDocument()
})

test('полоса «Сегодня»: заявки — открыть первую; склад заканчивается — перейти в «Склад»; линия «сейчас»', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => {
      const doctorId = new URL(request.url).searchParams.get('doctorId')
      return HttpResponse.json(doctorId === '1'
        ? [appointment(10, 1, '23:00', 'Бакыт М.', { status: 'REQUESTED' }), appointment(11, 1, '23:30', 'Айгуль Т.', { status: 'REQUESTED' })]
        : [])
    }),
    http.get('*/api/supplies', () => HttpResponse.json([{ id: 1, name: 'Анестетик', unit: 'карп.', quantity: 1, minQuantity: 5, low: true }])),
    http.get('*/api/appointments/revenue', () => HttpResponse.json({ totalSom: 12500, paidCount: 3, unpaidCount: 0, byMethod: {}, days: [] })),
  )
  renderApp()
  const strip = await screen.findByRole('group', { name: 'Требует внимания' })
  expect(await within(strip).findByRole('button', { name: /2 заявки из бота — подтвердить/ })).toBeInTheDocument()
  expect(await within(strip).findByRole('button', { name: /12\s500 сом сегодня/ })).toBeInTheDocument()

  await userEvent.click(within(strip).getByRole('button', { name: /заявки из бота/ }))
  expect(await screen.findByRole('complementary', { name: 'Карточка приёма' })).toHaveTextContent('Бакыт М.')

  await userEvent.click(await within(strip).findByRole('button', { name: /на складе заканчивается/ }))
  // Руководителю — «Склад → Материалы»: подраздел — открытой вкладкой и заголовком
  expect(await screen.findByRole('heading', { name: 'Материалы' })).toBeInTheDocument()
  expect(within(await screen.findByRole('navigation', { name: 'Подразделы: Склад' })).getByRole('link', { name: 'Материалы' })).toHaveAttribute('aria-current', 'page')
  window.location.hash = ''
})
