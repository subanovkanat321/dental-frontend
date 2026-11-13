import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { initials } from './me'

/** Блок «Я» внизу меню (2026-11-10): аватар, имя, роль; по нажатию — свои настройки и выход. Данные вымышленные. */

beforeEach(() => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
  )
})

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

test('инициалы: два слова — две буквы, одно — одна, пусто — «?»', () => {
  expect(initials('Айгерим Садыкова')).toBe('АС')
  expect(initials('асель')).toBe('А')
  expect(initials('  ')).toBe('?')
  expect(initials(undefined)).toBe('?')
})

test('компьютер: блок «Я» — инициалы, имя и роль; меню — профиль, оформление, уведомления, календарь, установка, «Выйти»; пункт открывает свой экран', async () => {
  window.location.hash = '/schedule'
  renderApp()
  const block = await screen.findByRole('button', { name: /^Айгерим Садыкова, руководитель/ })
  expect(block.closest('aside')).toHaveClass('sidebar')
  expect(block).toHaveTextContent('АС')
  expect(block).toHaveTextContent('Айгерим Садыкова')
  expect(block).toHaveAttribute('aria-expanded', 'false')
  await userEvent.click(block)
  const menu = screen.getByRole('dialog', { name: 'Я: мои настройки' })
  expect(block).toHaveAttribute('aria-expanded', 'true')
  expect(within(menu).getAllByRole('button').map((b) => b.textContent)).toEqual([
    'Мой профиль', 'Оформление', 'Уведомления', 'Календарь в телефоне', 'Установить приложение', 'Выйти',
  ])
  await userEvent.click(within(menu).getByRole('button', { name: 'Оформление' }))
  expect(window.location.hash).toBe('#/me/appearance')
  expect(screen.queryByRole('dialog', { name: 'Я: мои настройки' })).not.toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: 'Оформление' })).toBeInTheDocument()
  expect(screen.getByText('Мои настройки', { selector: '.sect-crumb' })).toBeInTheDocument()
  expect(block).toHaveClass('active')
  // Ни один раздел дерева не подсвечен: «Я» — не раздел
  expect(within(screen.getByRole('navigation', { name: 'Разделы' })).queryByRole('button', { current: 'page' })).not.toBeInTheDocument()

  await userEvent.click(block)
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Я: мои настройки' })).getByRole('button', { name: 'Установить приложение' }))
  expect(window.location.hash).toBe('#/me/install')
  expect(await screen.findByRole('heading', { name: 'Установить приложение' })).toBeInTheDocument()

  // Нажатие мимо закрывает меню
  await userEvent.click(block)
  expect(screen.getByRole('dialog', { name: 'Я: мои настройки' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('heading', { name: 'Установить приложение' }))
  expect(screen.queryByRole('dialog', { name: 'Я: мои настройки' })).not.toBeInTheDocument()
})

test('без своего кресла (регистратура) — без «Календаря в телефоне»; старые адреса «Настроек» ведут в «Я»', async () => {
  const reception: Schemas['BookingViewsMe'] = { ...me, admin: false, reception: true, doctorId: undefined, fullName: 'Жанара Т.' }
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(reception)))
  window.location.hash = '/settings/notifications'
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Уведомления' })).toBeInTheDocument()
  expect(window.location.hash).toBe('#/me/notifications')
  await userEvent.click(screen.getByRole('button', { name: /^Жанара Т\., регистратура/ }))
  const menu = screen.getByRole('dialog', { name: 'Я: мои настройки' })
  expect(within(menu).queryByRole('button', { name: 'Календарь в телефоне' })).not.toBeInTheDocument()
  expect(within(menu).getByRole('button', { name: 'Мой профиль' })).toBeInTheDocument()
})

test('свёрнутое меню: от блока «Я» остаётся аватар; меню открывается так же', async () => {
  localStorage.setItem('tish.full.sidebar-narrow', '1')
  window.location.hash = '/schedule'
  renderApp()
  const block = await screen.findByRole('button', { name: /^Айгерим Садыкова, руководитель/ })
  // Подписи спрятаны — имя и роль подсказкой при наведении
  await userEvent.hover(block)
  expect(screen.getByRole('tooltip')).toHaveTextContent('Айгерим Садыкова · руководитель')
  await userEvent.click(block)
  expect(screen.getByRole('dialog', { name: 'Я: мои настройки' })).toBeInTheDocument()
})

/** Телефон: ширина до 760px. */
function phone() {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 760px'), addEventListener() {}, removeEventListener() {} }))
}

test('телефон: «Ещё» → свой аватар → лист «Я» с теми же пунктами; «Мой профиль» — экран с «‹ Назад»', async () => {
  phone()
  server.use(
    http.get('*/api/me/password', () => HttpResponse.json({ phoneLogin: false, passwordSet: true, temporary: false, sms: false, telegram: true })),
    http.get('*/api/doctors/admin', () => HttpResponse.json([{ id: 1, fullName: 'Айгерим Садыкова', active: true }])),
  )
  window.location.hash = '/schedule'
  renderApp()
  // Блока «Я» в нижнем меню нет — он в «Ещё»
  await screen.findByRole('navigation', { name: 'Разделы' })
  expect(document.querySelector('.me-block')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Ещё' }))
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Ещё разделы' })).getByRole('button', { name: /^Айгерим Садыкова, руководитель/ }))
  expect(screen.queryByRole('dialog', { name: 'Ещё разделы' })).not.toBeInTheDocument()
  const sheet = screen.getByRole('dialog', { name: 'Я: мои настройки' })
  expect(sheet).toHaveClass('menu-sheet')
  expect(within(sheet).getByText('Айгерим Садыкова')).toBeInTheDocument()
  expect(within(sheet).getByRole('button', { name: 'Выйти' })).toBeInTheDocument()
  await userEvent.click(within(sheet).getByRole('button', { name: 'Мой профиль' }))
  expect(window.location.hash).toBe('#/me/profile')
  expect(await screen.findByRole('heading', { name: 'Мой профиль' })).toBeInTheDocument()
  // «Ещё» внизу подсвечен: открыт пункт из него
  expect(screen.getByRole('button', { name: 'Ещё' })).toHaveClass('active')
  await userEvent.click(screen.getByRole('button', { name: '‹ Назад' }))
  expect(window.location.hash).toBe('#/schedule')
})
