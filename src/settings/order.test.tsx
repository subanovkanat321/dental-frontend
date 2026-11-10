import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, openItem, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Me = Schemas['BookingViewsMe']

/** Вымышленные сотрудники разных ролей. */
const doctor: Me = { ...me, admin: false }
const assistant: Me = { ...me, admin: false, doctorId: undefined, fullName: 'Асель', assistantOf: [2] }
const reception: Me = { ...me, admin: false, reception: true, doctorId: undefined, fullName: 'Жанара' }

afterEach(() => {
  window.location.hash = ''
})

/** Группы «Настроек» и пункты в них — как видит пользователь, по порядку. */
async function groups(who: Me): Promise<[string, string[]][]> {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(who)))
  window.location.hash = '/settings'
  renderApp()
  await screen.findByRole('heading', { name: 'Настройки' })
  const sections = [...document.querySelectorAll<HTMLElement>('.settings-groups > .settings-group')]
  return sections.map((s) => [
    within(s).getByRole('heading', { level: 2 }).textContent ?? '',
    [...s.querySelectorAll('.settings-text strong')].map((x) => x.textContent ?? ''),
  ])
}

test('порядок: в «Настройках» две группы — пациентам и аккаунт клиники; «Для пациента» — только раздел меню, без дубля', async () => {
  expect(await groups(me)).toEqual([
    ['Пациентам', ['Текст напоминания', 'Анкета пациента', 'Договор с пациентом', 'Памятки после процедур', 'Новости для пациентов', 'Откуда приходят пациенты']],
    ['Аккаунт клиники', ['Тариф и оплата', 'Договор', 'Данные', 'ИИ-помощник']],
  ])
  // Профиль, установка, уведомления и выход — в блоке «Я» внизу меню, не на главной «Настроек»
  expect(screen.queryByRole('button', { name: 'Изменить профиль' })).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Установить приложение' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Выйти на всех устройствах' })).not.toBeInTheDocument()
})

/** Пункты раздела «Клиника» в меню слева — как видит пользователь. */
async function clinicItems(who: Me): Promise<string[]> {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(who)))
  window.location.hash = '/clinic'
  renderApp()
  const group = await within(await screen.findByRole('navigation', { name: 'Разделы' })).findByRole('group', { name: 'Клиника' })
  return within(group).getAllByRole('link').map((a) => a.textContent ?? '')
}

test('роли: каждый видит те же пункты, что и раньше (с учётом переезда в «Клинику»)', async () => {
  const flat = async (who: Me) => (await groups(who)).flatMap(([, items]) => items)
  // Врач без прав админа: без текста напоминания, договора, новостей, тарифа, договора с Tish, данных и ИИ
  expect(await flat(doctor)).toEqual(['Анкета пациента', 'Памятки после процедур', 'Откуда приходят пациенты'])
  document.body.innerHTML = ''
  expect(await clinicItems(doctor)).toEqual(['О клинике', 'Персонал', 'Услуги и цены', 'Рабочее время'])
  document.body.innerHTML = ''
  expect(await clinicItems(me)).toEqual(['О клинике', 'Персонал', 'Услуги и цены', 'Рабочее время', 'Кресла'])
})

test('роли: ассистенту — без цен услуг и анкеты; регистратуре — услуги без анкеты', async () => {
  const flat = async (who: Me) => (await groups(who)).flatMap(([, items]) => items)
  expect(await flat(assistant)).toEqual(['Памятки после процедур', 'Откуда приходят пациенты'])
  document.body.innerHTML = ''
  expect(await clinicItems(assistant)).toEqual(['О клинике', 'Персонал', 'Рабочее время'])
  document.body.innerHTML = ''
  expect(await flat(reception)).toEqual(['Памятки после процедур', 'Откуда приходят пациенты'])
  document.body.innerHTML = ''
  expect(await clinicItems(reception)).toEqual(['О клинике', 'Персонал', 'Услуги и цены', 'Рабочее время'])
})

test('«Откуда приходят пациенты»: вкладки «Откуда узнают» и «Промокоды»; старый адрес промокодов открывает их вкладку; ассистенту — без промокодов', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)))
  openItem('promo')
  const { unmount } = renderApp()
  expect(await screen.findByRole('heading', { name: 'Откуда приходят пациенты' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Промокоды' })).toHaveAttribute('aria-selected', 'true')
  await userEvent.click(screen.getByRole('tab', { name: 'Откуда узнают' }))
  expect(await screen.findByRole('table', { name: 'Откуда узнают о клинике' })).toBeInTheDocument()
  unmount()

  server.use(http.get('*/api/patient/me', () => HttpResponse.json(assistant)))
  openItem('sources')
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Откуда приходят пациенты' })).toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: 'Промокоды' })).not.toBeInTheDocument()
})

test('«Помощь и техподдержка» — одна страница; старый адрес «Помощь» сразу открывает чат с помощником', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)))
  openItem('help')
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Помощь и техподдержка' })).toBeInTheDocument()
  expect(window.location.hash).toBe('#/help/chat')
  expect(await screen.findByRole('complementary', { name: 'Помощь' })).toBeInTheDocument()
})
