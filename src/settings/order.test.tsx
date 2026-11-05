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

test('порядок: клиника → пациентам → аккаунт клиники → мои настройки → помощь; похожие пункты объединены', async () => {
  expect(await groups(me)).toEqual([
    ['Клиника', ['О клинике', 'Персонал', 'Услуги и цены', 'Рабочее время']],
    ['Пациентам', ['Текст напоминания', 'Анкета пациента', 'Памятки после процедур', 'Показать пациенту', 'Новости для пациентов', 'Откуда приходят пациенты']],
    ['Аккаунт клиники', ['Тариф и оплата', 'Договор', 'Данные', 'ИИ-помощник']],
    ['Мои настройки', ['Мой профиль', 'Календарь в телефоне']],
    ['Помощь', ['Руководство', 'Помощь и техподдержка', 'Отзыв о Tish', 'Новости стоматологии', 'Конфиденциальность', 'Tish в Instagram']],
  ])
})

test('роли: каждый видит те же пункты, что и раньше (с учётом объединённых)', async () => {
  const flat = async (who: Me) => (await groups(who)).flatMap(([, items]) => items)
  // Врач без прав админа: без текста напоминания, новостей, тарифа, договора, данных и ИИ
  expect(await flat(doctor)).toEqual(['О клинике', 'Персонал', 'Услуги и цены', 'Рабочее время',
    'Анкета пациента', 'Памятки после процедур', 'Показать пациенту', 'Откуда приходят пациенты',
    'Мой профиль', 'Календарь в телефоне',
    'Руководство', 'Помощь и техподдержка', 'Отзыв о Tish', 'Новости стоматологии', 'Конфиденциальность', 'Tish в Instagram'])
})

test('роли: ассистенту — без цен услуг и анкеты; регистратуре — услуги без анкеты и без своего профиля', async () => {
  const flat = async (who: Me) => (await groups(who)).flatMap(([, items]) => items)
  const help = ['Руководство', 'Помощь и техподдержка', 'Отзыв о Tish', 'Новости стоматологии', 'Конфиденциальность', 'Tish в Instagram']
  expect(await flat(assistant)).toEqual(['О клинике', 'Персонал', 'Рабочее время',
    'Памятки после процедур', 'Показать пациенту', 'Откуда приходят пациенты', ...help])
  document.body.innerHTML = ''
  expect(await flat(reception)).toEqual(['О клинике', 'Персонал', 'Услуги и цены', 'Рабочее время',
    'Памятки после процедур', 'Показать пациенту', 'Откуда приходят пациенты', ...help])
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
  expect(await screen.findByRole('complementary', { name: 'Помощь' })).toBeInTheDocument()
})
