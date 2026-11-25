import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from './api/client'
import { me, renderApp } from './test/fixtures'
import { server } from './test/server'

/** Клиники и врачи — вымышленные. */
const CLINICS: Schemas['DirectoryControllerClinic'][] = [
  { name: 'Ак-Тиш', address: 'ул. Токтогула 10', city: 'Бишкек', pageUrl: '/c/aktish', bookingUrl: '/c/aktish#book',
    doctors: [{ fullName: 'Айгуль Асанова' }, { fullName: 'Нурлан Бекович' }] },
  { name: 'Жемчуг', address: 'ул. Ленина 5', city: 'Ош', pageUrl: '/c/jemchug', telegramUrl: 'https://t.me/tish_bot?start=c_jemchug', doctors: [] },
]

const unauthorized = () => http.get('*/api/patient/me', () => HttpResponse.json({ detail: 'Войдите' }, { status: 401 }))

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})
afterEach(() => { delete window.Telegram })

test('tish.kg без входа — главная для пациентов: поиск, клиники с «Записаться», вход для клиник рядом', async () => {
  server.use(unauthorized(), http.get('*/web/clinics', () => HttpResponse.json(CLINICS)),
    http.get('*/web/links', () => HttpResponse.json({ supportWhatsapp: '996700000999' } satisfies Schemas['LinksControllerLinks'])))
  const user = userEvent.setup()
  renderApp()
  expect(await screen.findByRole('heading', { level: 1, name: 'Запишитесь к стоматологу без звонков' })).toBeInTheDocument()
  expect(document.title).toBe('Tish — запись к стоматологу в Бишкеке онлайн')
  // Шапка: «Для клиник» (сайт-визитка) и «Вход для клиник» (тот же вход, что /login)
  const nav = screen.getByRole('navigation', { name: 'Главное меню' })
  expect(within(nav).getByRole('link', { name: 'Для клиник' })).toHaveAttribute('href', '/about')
  expect(within(nav).getByRole('link', { name: /Вход для клиник/ })).toHaveAttribute('href', '/login')
  // Карточки клиник из /web/clinics
  const cards = await screen.findAllByRole('article')
  expect(cards).toHaveLength(2)
  expect(within(cards[0]!).getByRole('link', { name: 'Записаться' })).toHaveAttribute('href', '/c/aktish#book')
  expect(within(cards[0]!).getByRole('list', { name: 'Врачи' })).toHaveTextContent('Айгуль Асанова')
  // Без записи на сайте — на страницу клиники (там бот); Telegram — отдельной кнопкой
  expect(within(cards[1]!).getByRole('link', { name: 'Записаться' })).toHaveAttribute('href', '/c/jemchug')
  expect(within(cards[1]!).getByRole('link', { name: 'В Telegram' })).toHaveAttribute('href', 'https://t.me/tish_bot?start=c_jemchug')
  // Поиск по врачу, потом пусто — «Показать все клиники»
  await user.type(screen.getByRole('searchbox', { name: 'Клиника, врач или адрес' }), 'нурлан')
  expect(screen.getAllByRole('article')).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: 'Найти' }))
  await user.clear(screen.getByRole('searchbox'))
  await user.type(screen.getByRole('searchbox'), 'нет такой')
  await user.click(screen.getByRole('button', { name: 'Показать все клиники' }))
  expect(screen.getAllByRole('article')).toHaveLength(2)
  // Город — выбор в шапке поиска
  await user.click(within(screen.getByRole('group', { name: 'Город' })).getByRole('button', { name: /Ош/ }))
  expect(screen.getAllByRole('article')).toHaveLength(1)
  // Три шага и полоса для клиник: подключить (/join, Telegram) или войти (/login)
  expect(screen.getByRole('heading', { name: 'Как записаться' })).toBeInTheDocument()
  const band = screen.getByRole('region', { name: 'Вы врач или руководитель клиники?' })
  expect(band).toHaveTextContent('получайте пациентов через онлайн-запись')
  expect(band).toHaveTextContent('Это бесплатно!')
  expect(within(band).getByRole('link', { name: 'Подключить клинику — бесплатно' })).toHaveAttribute('href', '/join')
  expect(within(band).getByRole('link', { name: 'Войти' })).toHaveAttribute('href', '/login')
  // Внизу — связаться: WhatsApp из «Сведений о платформе», Telegram и Instagram — адреса Tish по умолчанию
  const contact = screen.getByRole('region', { name: 'Связаться с нами' })
  await waitFor(() => expect(within(contact).getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', expect.stringMatching(/^https:\/\/wa\.me\/996700000999\?text=/)))
  expect(within(contact).getByRole('link', { name: 'Telegram' })).toHaveAttribute('href', 'https://t.me/veratti_16')
  expect(within(contact).getByRole('link', { name: 'Instagram' })).toHaveAttribute('href', 'https://www.instagram.com/tish.app.kg/')
  for (const a of within(contact).getAllByRole('link')) expect(a).toHaveAttribute('rel', 'noopener noreferrer')
  // Вход для клиник на главной не показываем
  expect(screen.queryByRole('heading', { name: 'Вход для клиники' })).not.toBeInTheDocument()
  // По-кыргызски — тексты и заголовок вкладки
  await user.click(screen.getByRole('button', { name: 'Кыргызча' }))
  expect(screen.getByRole('heading', { level: 1, name: 'Тиш дарыгерине чалбай эле жазылыңыз' })).toBeInTheDocument()
  expect(document.title).toBe('Tish — Бишкекте тиш дарыгерине онлайн жазылуу')
})

test('«Вход для клиник» (/login) — страница входа сотрудников, не главная', async () => {
  server.use(unauthorized(), http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot', passwordLogin: true })))
  window.history.replaceState(null, '', '/login')
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Вход для клиники' })).toBeInTheDocument()
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
})

test('сотрудник с входом на «/» — сразу CRM, без главной для пациентов', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)), http.get('*/api/appointments', () => HttpResponse.json([])))
  renderApp()
  expect(await screen.findByRole('navigation', { name: 'Разделы' })).toBeInTheDocument()
  expect(document.title).toBe('Tish CRM')
  expect(screen.queryByRole('heading', { name: 'Запишитесь к стоматологу без звонков' })).not.toBeInTheDocument()
})

test('Telegram Mini App с устаревшей подписью — как раньше, «откройте из бота», а не главная', async () => {
  window.Telegram = { WebApp: { initData: 'query_id=1&hash=abc' } } as unknown as typeof window.Telegram
  server.use(unauthorized())
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Tish CRM' })).toBeInTheDocument()
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
})
