import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { SUB_HINT_KEY } from './section'

/**
 * Телефон: подразделы — панелью вкладок вверху (как папки Telegram): все подразделы видны во всех
 * разделах, нажатие переключает, числа — бейджами, «⌄» — лист со всеми, первый раз — подсказка.
 * Данные вымышленные.
 */

function phone() {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 760px'), addEventListener() {}, removeEventListener() {} }))
}

/**
 * В jsdom нет раскладки: размеры панели задаём сами. `fits` — вкладки влезают в строку (390px); иначе
 * каждая вкладка шириной 100px, видно 300px строки — справа скрыты все с 4-й.
 */
function layout(fits: boolean) {
  const tabIndex = (el: HTMLElement) => [...(el.parentElement?.children ?? [])].indexOf(el)
  const props: Record<string, (el: HTMLElement) => number> = {
    offsetWidth: (el) => (el.classList.contains('sub-tabs-list') ? (fits ? 300 : 900) : el.classList.contains('sub-tab') ? 100 : 0),
    offsetLeft: (el) => (el.classList.contains('sub-tab') ? tabIndex(el) * 100 : 0),
    clientWidth: (el) => (el.classList.contains('sub-tabs') ? 390 : el.classList.contains('sub-tabs-scroll') ? (fits ? 390 : 300) : 0),
    scrollWidth: (el) => (el.classList.contains('sub-tabs-scroll') ? (fits ? 390 : 900) : 0),
  }
  for (const [name, get] of Object.entries(props)) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get(this: HTMLElement) { return get(this) } })
  }
}

/** Свои свойства HTMLElement.prototype до подмены (clientWidth и scrollWidth — у Element, их просто убираем) */
const own = Object.fromEntries(['offsetWidth', 'offsetLeft', 'clientWidth', 'scrollWidth']
  .map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]))

beforeEach(() => {
  phone()
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)))
  // Подсказку уже видели — кроме тестов про неё
  localStorage.setItem(SUB_HINT_KEY, 'seen')
})

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
  for (const [name, d] of Object.entries(own)) {
    if (d) Object.defineProperty(HTMLElement.prototype, name, d)
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
  }
})

const tabs = (title: string) => screen.findByRole('navigation', { name: `Подразделы: ${title}` })
const names = (row: HTMLElement) => within(row).getAllByRole('link').map((a) => a.firstChild?.textContent)

test('Пациенты: все подразделы вкладками, открытый отмечен, числа — бейджами; нажатие переключает без листа', async () => {
  server.use(
    http.get('*/api/patient-questions/new-count', () => HttpResponse.json({ count: 2 } satisfies Schemas['QuestionControllerNewCount'])),
    http.get('*/api/waitlist', () => HttpResponse.json([{ id: 1 }, { id: 2 }, { id: 3 }] satisfies Schemas['WaitlistView'][])),
  )
  window.location.hash = '/patients/booked'
  renderApp()
  const row = await tabs('Пациенты')
  expect(names(row)).toEqual(['Все', 'Записаны', 'Лист ожидания', 'Позвать снова', 'Вопросы'])
  expect(within(row).getByRole('link', { name: 'Записаны' })).toHaveAttribute('aria-current', 'page')
  // Заголовок страницы — подраздел (для читалок экрана; на экране его показывает вкладка)
  expect(screen.getByRole('heading', { name: 'Записаны' })).toHaveClass('sr-only')
  expect(await within(row).findByRole('link', { name: 'Вопросы · 2' })).toBeInTheDocument()
  expect(await within(row).findByRole('link', { name: 'Лист ожидания · 3' })).toBeInTheDocument()

  await userEvent.click(within(row).getByRole('link', { name: 'Лист ожидания · 3' }))
  expect(window.location.hash).toBe('#/patients/waitlist')
  expect(await screen.findByRole('heading', { name: 'Лист ожидания' })).toBeInTheDocument()
  expect(within(await tabs('Пациенты')).getByRole('link', { name: 'Лист ожидания · 3' })).toHaveAttribute('aria-current', 'page')
  expect(screen.queryByRole('dialog', { name: /Подразделы/ })).not.toBeInTheDocument()
})

test('Касса: видны все 8 подразделов (раньше — только кнопка «Разделы · 8»); «⌄» открывает лист со всеми', async () => {
  layout(false)
  window.location.hash = '/cash'
  renderApp()
  const row = await tabs('Касса')
  expect(names(row)).toEqual(['Деньги', 'Мой заработок', 'Аналитика', 'Расходы', 'Должники', 'Зарплата', 'Статистика', 'Отчёт'])
  expect(within(row).getByRole('link', { name: 'Деньги' })).toHaveAttribute('aria-current', 'page')
  // «?» раздела — в конце строки вкладок
  expect(within(row).getByRole('button', { name: /^Подсказка:/ })).toBeInTheDocument()
  await userEvent.click(within(row).getByRole('button', { name: 'Все подразделы: Касса' }))
  const sheet = screen.getByRole('dialog', { name: 'Подразделы: Касса' })
  expect(within(sheet).getByText(/долгим нажатием на «Касса»/)).toBeInTheDocument()
  await userEvent.click(within(sheet).getByRole('link', { name: 'Должники' }))
  expect(window.location.hash).toBe('#/cash/debtors')
  expect(screen.queryByRole('dialog', { name: 'Подразделы: Касса' })).not.toBeInTheDocument()
  expect(within(await tabs('Касса')).getByRole('link', { name: 'Должники' })).toHaveAttribute('aria-current', 'page')
})

test('Клиника (нет в нижнем меню): «⌄» — лист без подсказки про долгое нажатие', async () => {
  layout(false)
  window.location.hash = '/clinic'
  renderApp()
  await userEvent.click(within(await tabs('Клиника')).getByRole('button', { name: 'Все подразделы: Клиника' }))
  const sheet = screen.getByRole('dialog', { name: 'Подразделы: Клиника' })
  expect(within(sheet).queryByText(/долгим нажатием/)).not.toBeInTheDocument()
  await userEvent.click(within(sheet).getByRole('link', { name: 'Рабочее время' }))
  expect(window.location.hash).toBe('#/clinic/hours')
})

test('Платформа: все 14 подразделов владельца вкладками', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, doctor: false, admin: false, platform: true, owner: true })))
  window.location.hash = '/platform/content'
  renderApp()
  const row = await tabs('Платформа')
  expect(within(row).getAllByRole('link')).toHaveLength(14)
  expect(within(row).getByRole('link', { name: 'Контент' })).toHaveAttribute('aria-current', 'page')
})

test('«⌄» — только когда вкладки не влезают; новое в скрытых справа — точкой на ней', async () => {
  server.use(http.get('*/api/patient-questions/new-count', () => HttpResponse.json({ count: 2 } satisfies Schemas['QuestionControllerNewCount'])))
  layout(true)
  window.location.hash = '/patients'
  const first = renderApp()
  const row = await tabs('Пациенты')
  await within(row).findByRole('link', { name: 'Вопросы · 2' })
  expect(within(row).queryByRole('button', { name: /Все подразделы/ })).not.toBeInTheDocument()
  first.unmount()

  // Не влезли: «Вопросы» (5-я вкладка) — за правым краем, её число не видно — точка на «⌄»
  layout(false)
  renderApp()
  const narrow = await tabs('Пациенты')
  await within(narrow).findByRole('link', { name: 'Вопросы · 2' })
  fireEvent.scroll(narrow.querySelector('.sub-tabs-scroll')!)
  const more = await within(narrow).findByRole('button', { name: 'Все подразделы: Пациенты (есть новое)' })
  expect(more.querySelector('.sub-tabs-dot')).not.toHaveClass('quiet')
})

test('подсказка «здесь переключаются разделы» — один раз: закрыли крестиком — больше нет', async () => {
  localStorage.removeItem(SUB_HINT_KEY)
  window.location.hash = '/patients/all'
  const first = renderApp()
  const tip = await screen.findByRole('note')
  expect(tip).toHaveTextContent('Здесь переключаются разделы: Лист ожидания, Вопросы…')
  await userEvent.click(within(tip).getByRole('button', { name: 'Закрыть подсказку' }))
  expect(screen.queryByText(/Здесь переключаются разделы/)).not.toBeInTheDocument()
  expect(localStorage.getItem(SUB_HINT_KEY)).toBe('seen')
  first.unmount()

  // Другой раздел, новый запуск — подсказки нет
  window.location.hash = '/cash'
  renderApp()
  await tabs('Касса')
  expect(screen.queryByText(/Здесь переключаются разделы/)).not.toBeInTheDocument()
})

test('подсказка закрывается тапом по ней, нажатием на вкладку и когда открыли лист', async () => {
  localStorage.removeItem(SUB_HINT_KEY)
  window.location.hash = '/cash'
  const first = renderApp()
  await userEvent.click(await screen.findByText(/Здесь переключаются разделы/))
  expect(screen.queryByText(/Здесь переключаются разделы/)).not.toBeInTheDocument()
  first.unmount()

  localStorage.removeItem(SUB_HINT_KEY)
  await act(async () => { window.location.hash = '/stock' })
  const second = renderApp()
  await screen.findByText(/Здесь переключаются разделы: Расходы на склад/)
  await userEvent.click(within(await tabs('Склад')).getByRole('link', { name: 'Расходы на склад' }))
  expect(screen.queryByText(/Здесь переключаются разделы/)).not.toBeInTheDocument()
  expect(localStorage.getItem(SUB_HINT_KEY)).toBe('seen')
  second.unmount()

  localStorage.removeItem(SUB_HINT_KEY)
  layout(false)
  await act(async () => { window.location.hash = '/cash' })
  renderApp()
  expect(await screen.findByText(/Листайте вбок или нажмите ⌄/)).toBeInTheDocument()
  await userEvent.click(within(await tabs('Касса')).getByRole('button', { name: 'Все подразделы: Касса' }))
  expect(screen.queryByText(/Здесь переключаются разделы/)).not.toBeInTheDocument()
  expect(localStorage.getItem(SUB_HINT_KEY)).toBe('seen')
})

test('компьютер: те же вкладки над страницей; «⌄» — список под кнопкой (Esc закрывает), подсказки нет', async () => {
  vi.unstubAllGlobals()
  localStorage.removeItem(SUB_HINT_KEY)
  layout(false)
  window.location.hash = '/cash'
  renderApp()
  const row = await tabs('Касса')
  expect(names(row)).toHaveLength(8)
  // На компьютере вкладки и так на виду — пузыря «здесь переключаются разделы» нет
  expect(screen.queryByText(/Здесь переключаются разделы/)).not.toBeInTheDocument()
  const more = within(row).getByRole('button', { name: 'Все подразделы: Касса' })
  await userEvent.click(more)
  expect(more).toHaveAttribute('aria-expanded', 'true')
  expect(screen.queryByRole('dialog', { name: /Подразделы/ })).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('group', { name: 'Все подразделы: Касса' })).not.toBeInTheDocument()
  await userEvent.click(more)
  await userEvent.click(within(screen.getByRole('group', { name: 'Все подразделы: Касса' })).getByRole('link', { name: 'Отчёт' }))
  expect(window.location.hash).toBe('#/cash/report')
  expect(screen.queryByRole('group', { name: 'Все подразделы: Касса' })).not.toBeInTheDocument()
  expect(within(await tabs('Касса')).getByRole('link', { name: 'Отчёт' })).toHaveAttribute('aria-current', 'page')
})
