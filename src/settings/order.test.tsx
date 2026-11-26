import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { findSubs, me, openItem, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Me = Schemas['BookingViewsMe']

/** Вымышленные сотрудники разных ролей. */
const doctor: Me = { ...me, admin: false }
const assistant: Me = { ...me, admin: false, doctorId: undefined, fullName: 'Асель', assistantOf: [2] }
const reception: Me = { ...me, admin: false, reception: true, doctorId: undefined, fullName: 'Жанара' }

afterEach(() => {
  window.location.hash = ''
})

/** Группы «Настроек» и пункты в них — как в меню слева (стрелка › у «Настроек»), по порядку. С 2026-11-13 пункты — вкладками. */
async function groups(who: Me): Promise<[string, string[]][]> {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(who)))
  window.location.hash = '/settings'
  renderApp()
  const nav = await screen.findByRole('navigation', { name: 'Разделы' })
  await userEvent.click(within(nav).getByRole('button', { name: 'Раскрыть подразделы: Настройки' }))
  const result: [string, string[]][] = []
  for (const el of within(nav).getByRole('group', { name: 'Настройки' }).children) {
    if (el.classList.contains('nav-group')) result.push([el.textContent ?? '', []])
    else result.at(-1)![1].push(el.querySelector('.nav-sub-title')?.textContent ?? '')
  }
  return result
}

test('порядок: в «Настройках» 6 пунктов с вкладками (2026-11-26, было 20) — пациентам, работа клиники, аккаунт; «Для пациента» — только раздел меню, без дубля', async () => {
  expect(await groups(me)).toEqual([
    ['Пациентам', ['Сообщения пациентам', 'Привлечение пациентов', 'Документы для пациента']],
    ['Работа клиники', ['Приём', 'Пациенты и скидки']],
    ['Аккаунт', ['Клиника в Tish']],
  ])
  // Профиль, установка, уведомления и выход — в блоке «Я» внизу меню, не на главной «Настроек»
  expect(screen.queryByRole('button', { name: 'Изменить профиль' })).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Установить приложение' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Выйти на всех устройствах' })).not.toBeInTheDocument()
})

/** Пункты раздела «Клиника», как видит пользователь: лист «‹» (v2; первым — открытый «О клинике») или вкладки (?ui=v1). */
async function clinicItems(who: Me): Promise<string[]> {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(who)))
  window.location.hash = '/clinic'
  renderApp()
  return (await findSubs('Клиника')).titles()
}

test('роли: каждый видит те же пункты, что и раньше (с учётом переезда в «Клинику»)', async () => {
  const flat = async (who: Me) => (await groups(who)).flatMap(([, items]) => items)
  // Врач без прав админа: без сообщений пациентам, меток и скидок, «Клиники в Tish»; внутри пунктов — только его вкладки
  expect(await flat(doctor)).toEqual(['Привлечение пациентов', 'Документы для пациента', 'Приём'])
  document.body.innerHTML = ''
  expect(await clinicItems(doctor)).toEqual(['О клинике', 'Персонал', 'Услуги и цены', 'Рабочее время'])
  document.body.innerHTML = ''
  expect(await clinicItems(me)).toEqual(['О клинике', 'Персонал', 'Услуги и цены', 'Рабочее время', 'Кресла'])
})

test('роли: ассистенту — без цен услуг и анкеты; регистратуре — услуги без анкеты', async () => {
  const flat = async (who: Me) => (await groups(who)).flatMap(([, items]) => items)
  expect(await flat(assistant)).toEqual(['Привлечение пациентов', 'Документы для пациента'])
  document.body.innerHTML = ''
  expect(await clinicItems(assistant)).toEqual(['О клинике', 'Персонал', 'Рабочее время'])
  document.body.innerHTML = ''
  expect(await flat(reception)).toEqual(['Привлечение пациентов', 'Документы для пациента'])
  document.body.innerHTML = ''
  expect(await clinicItems(reception)).toEqual(['О клинике', 'Персонал', 'Услуги и цены', 'Рабочее время'])
})

test('«Привлечение пациентов»: вкладки «Откуда узнают» и «Промокоды»; старый адрес промокодов открывает их вкладку; ассистенту — без промокодов', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)))
  openItem('promo')
  const { unmount } = renderApp()
  expect(await screen.findByRole('heading', { name: 'Привлечение пациентов' })).toBeInTheDocument()
  expect(await screen.findByRole('tab', { name: 'Промокоды' })).toHaveAttribute('aria-selected', 'true')
  await userEvent.click(screen.getByRole('tab', { name: 'Откуда узнают' }))
  expect(await screen.findByRole('table', { name: 'Откуда узнают о клинике' })).toBeInTheDocument()
  unmount()

  server.use(http.get('*/api/patient/me', () => HttpResponse.json(assistant)))
  openItem('sources')
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Привлечение пациентов' })).toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: 'Промокоды' })).not.toBeInTheDocument()
})

test('«Написать в Tish» — одна страница; старый адрес «Помощь» сразу открывает чат с помощником', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)))
  openItem('help')
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Написать в Tish' })).toBeInTheDocument()
  expect(window.location.hash).toBe('#/help/chat')
  expect(await screen.findByRole('complementary', { name: 'Помощь' })).toBeInTheDocument()
})
