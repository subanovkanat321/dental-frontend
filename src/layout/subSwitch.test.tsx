import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { warmSections } from '../test/wait'
import { LAST_SUB_KEY } from '../lib/sub'
import { SUB_HINT_KEY } from './section'

/**
 * Подразделы (с 2026-11-20). Телефон: над страницей — строка «Склад · Материалы ▾», нажатие на неё и на раздел в
 * нижнем меню — лист подразделов (layout/NavSheet.tsx): первым — последний открытый, у строк иконка, подсказка и
 * числа; один подраздел — сразу переход. Компьютер — полоса вкладок над страницей, как была. Данные вымышленные.
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

// Ленивые разделы — заранее, со своим сроком: иначе под нагрузкой первый тест каждого раздела ждёт их сборку в 5 с findBy
beforeAll(warmSections, 60_000)

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
const bottomNav = () => screen.findByRole('navigation', { name: 'Разделы' })
const navButton = async (title: string) => within(await bottomNav()).getByRole('button', { name: new RegExp(`^${title}`) })
const sheetOf = (title: string) => screen.getByRole('menu', { name: `Подразделы: ${title}` })
const noSheet = () => expect(screen.queryByRole('menu', { name: /^Подразделы/ })).not.toBeInTheDocument()
/** Названия строк листа по порядку (без чисел и отметок) */
const rows = (sheet: HTMLElement) => within(sheet).getAllByRole('menuitem').map((a) => a.querySelector('.nav-sheet-title')?.textContent)
/** Строка над страницей «Раздел · Подраздел ▾» */
const bar = async (title: string) => within(await tabs(title)).getByRole('button', { name: new RegExp(`^${title} · .*выбрать подраздел`) })

test('телефон: над страницей — «Пациенты · Записаны ▾» без вкладок; нажатие — лист, первым открытый; выбор — переход', async () => {
  server.use(
    http.get('*/api/patient-questions/new-count', () => HttpResponse.json({ count: 2 } satisfies Schemas['QuestionControllerNewCount'])),
    http.get('*/api/waitlist', () => HttpResponse.json([{ id: 1, durationMinutes: 0 }, { id: 2, durationMinutes: 0 }, { id: 3, durationMinutes: 0 }] satisfies Schemas['WaitlistView'][])),
  )
  window.location.hash = '/patients/booked'
  renderApp()
  const row = await tabs('Пациенты')
  // Вкладок нет — строка целиком: раздел и подраздел; заголовок страницы — для читалок экрана
  expect(within(row).queryAllByRole('link')).toHaveLength(0)
  expect(screen.getByRole('heading', { name: 'Записаны' })).toHaveClass('sr-only')
  // Новое в других подразделах (вопросы, лист ожидания) — суммой у ▾, красным: вопросы ждут ответа
  const button = await within(row).findByRole('button', { name: 'Пациенты · Записаны: выбрать подраздел (новое в других: 5)' })
  expect(button).toHaveAttribute('aria-haspopup', 'menu')
  expect(button.querySelector('.nav-count')).not.toHaveClass('quiet')

  await userEvent.click(button)
  expect(button).toHaveAttribute('aria-expanded', 'true')
  const sheet = sheetOf('Пациенты')
  expect(rows(sheet)).toEqual(['Записаны', 'Все', 'Лист ожидания', 'Обращения', 'Позвать снова', 'Бросили лечение', 'Группы', 'Без бота', 'Вопросы', 'Задачи', 'Оценки'])
  const first = within(sheet).getAllByRole('menuitem')[0]!
  expect(first).toHaveAccessibleName('Записаны · открыт сейчас')
  expect(first).toHaveAttribute('aria-current', 'page')
  expect(first).toHaveClass('first')
  // Фокус — на первой строке: с клавиатуры Enter сразу открывает последний подраздел; ↓ — следующая
  expect(first).toHaveFocus()
  await userEvent.keyboard('{ArrowDown}')
  expect(within(sheet).getByRole('menuitem', { name: 'Все' })).toHaveFocus()
  // Подсказка под названием и числа — как в меню
  expect(within(sheet).getByRole('menuitem', { name: 'Все' })).toHaveTextContent('Вся база и поиск')
  expect(within(sheet).getByRole('menuitem', { name: 'Вопросы · 2' })).toBeInTheDocument()
  await userEvent.click(within(sheet).getByRole('menuitem', { name: 'Лист ожидания · 3' }))
  expect(window.location.hash).toBe('#/patients/waitlist')
  noSheet()
  expect(await screen.findByRole('heading', { name: 'Лист ожидания' })).toBeInTheDocument()
  expect(await bar('Пациенты')).toHaveAccessibleName(/^Пациенты · Лист ожидания: выбрать подраздел/)
})

test('телефон: нажатие на «Касса» внизу — лист подразделов, раздел не меняется до выбора; в следующий раз первым — последний', async () => {
  window.location.hash = '/schedule'
  renderApp()
  // «Расписание» без подразделов — обычная кнопка, без меню
  expect(await navButton('Расписание')).not.toHaveAttribute('aria-haspopup')
  const cash = await navButton('Касса')
  expect(cash).toHaveAttribute('aria-haspopup', 'menu')
  expect(cash).toHaveAttribute('aria-expanded', 'false')
  await userEvent.click(cash)
  expect(cash).toHaveAttribute('aria-expanded', 'true')
  expect(window.location.hash).toBe('#/schedule')
  const sheet = sheetOf('Касса')
  // Ещё не выбирали — первым подраздел по умолчанию, без отметки «в прошлый раз»
  expect(rows(sheet)).toEqual(['Деньги', 'Касса дня', 'Мой заработок', 'Аналитика', 'Расходы', 'Должники', 'Зарплата', 'Статистика', 'Отчёт'])
  expect(within(sheet).getAllByRole('menuitem')[0]).toHaveAccessibleName('Деньги')
  // У каждой строки своя иконка (украшение) и подсказка
  const items = within(sheet).getAllByRole('menuitem')
  for (const a of items) {
    expect(a.querySelector('svg.sub-ico')).toHaveAttribute('aria-hidden', 'true')
    expect(a.querySelector('.nav-sheet-hint')?.textContent).toBeTruthy()
  }
  expect(new Set(items.map((a) => a.querySelector('svg.sub-ico')!.innerHTML)).size).toBe(items.length)
  await userEvent.click(within(sheet).getByRole('menuitem', { name: 'Должники' }))
  expect(window.location.hash).toBe('#/cash/debtors')
  noSheet()
  expect(cash).toHaveAttribute('aria-expanded', 'false')
  // Запомнено и на устройстве — только ключи подразделов
  expect(JSON.parse(localStorage.getItem(LAST_SUB_KEY) ?? '{}')).toMatchObject({ cash: 'debtors' })

  // Ушли в «Расписание» (сразу переход) и снова «Касса» — первым «Должники», «в прошлый раз»
  await userEvent.click(await navButton('Расписание'))
  expect(window.location.hash).toBe('#/schedule')
  noSheet()
  await userEvent.click(await navButton('Касса'))
  const again = sheetOf('Касса')
  expect(rows(again)[0]).toBe('Должники')
  expect(within(again).getAllByRole('menuitem')[0]).toHaveAccessibleName('Должники · в прошлый раз')
  expect(within(again).getAllByRole('menuitem')[0]).not.toHaveAttribute('aria-current')
  await userEvent.click(within(again).getAllByRole('menuitem')[0]!)
  expect(window.location.hash).toBe('#/cash/debtors')
})

test('телефон: лист закрывают тот же раздел ещё раз, Esc, ✕ и нажатие мимо; другой раздел — его подразделы', async () => {
  window.location.hash = '/schedule'
  renderApp()
  const stock = await navButton('Склад')
  await userEvent.click(stock)
  expect(rows(sheetOf('Склад'))).toEqual(['Материалы', 'Расходы на склад', 'Заказ', 'Лаборатория'])
  // Тот же раздел ещё раз — закрыть (меню под листом не закрыто фоном)
  await userEvent.click(stock)
  noSheet()
  expect(window.location.hash).toBe('#/schedule')

  await userEvent.click(stock)
  // Другой раздел — сразу его лист, без закрытия
  await userEvent.click(await navButton('Пациенты'))
  expect(screen.queryByRole('menu', { name: 'Подразделы: Склад' })).not.toBeInTheDocument()
  expect(sheetOf('Пациенты')).toBeInTheDocument()
  expect(stock).toHaveAttribute('aria-expanded', 'false')
  // Esc — закрыть, фокус обратно на кнопку раздела
  await userEvent.keyboard('{Escape}')
  noSheet()
  expect(await navButton('Пациенты')).toHaveFocus()

  await userEvent.click(stock)
  await userEvent.click(within(sheetOf('Склад')).getByRole('button', { name: 'Закрыть' }))
  noSheet()

  await userEvent.click(stock)
  await userEvent.click(sheetOf('Склад').parentElement!)
  noSheet()
  expect(window.location.hash).toBe('#/schedule')
})

test('телефон: «Ещё» и лист подразделов не открыты вместе', async () => {
  window.location.hash = '/schedule'
  renderApp()
  await userEvent.click(await navButton('Касса'))
  await userEvent.click(within(await bottomNav()).getByRole('button', { name: 'Ещё' }))
  noSheet()
  expect(screen.getByRole('dialog', { name: 'Ещё разделы' })).toBeInTheDocument()
  await userEvent.click(await navButton('Склад'))
  expect(screen.queryByRole('dialog', { name: 'Ещё разделы' })).not.toBeInTheDocument()
  expect(sheetOf('Склад')).toBeInTheDocument()
})

test('телефон: у «Кассы» без подразделов (регистратура без денег) — сразу переход, без листа', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, reception: true, doctorId: undefined })))
  window.location.hash = '/schedule'
  renderApp()
  const cash = await navButton('Касса')
  expect(cash).not.toHaveAttribute('aria-haspopup')
  await userEvent.click(cash)
  expect(window.location.hash).toBe('#/cash')
  noSheet()
})

test('телефон: «Настройки» — строка над страницей открывает лист с группами подзаголовками и иконками', async () => {
  window.location.hash = '/settings'
  renderApp()
  await userEvent.click(await bar('Настройки'))
  const sheet = sheetOf('Настройки')
  expect(rows(sheet)[0]).toBe('Напоминание о приёме')
  expect([...sheet.querySelectorAll('.nav-group')].map((p) => p.textContent)).toEqual(['Что получают пациенты', 'Аккаунт клиники', 'Приём', 'Карточка пациента', 'Деньги'])
  for (const a of within(sheet).getAllByRole('menuitem')) expect(a.querySelector('svg.sub-ico')).toHaveAttribute('aria-hidden', 'true')
  // Подсказки — из пунктов «Настроек»
  expect(within(sheet).getByRole('menuitem', { name: 'Тариф и оплата' })).toHaveTextContent('Сколько осталось и как продлить')
  await userEvent.click(within(sheet).getByRole('menuitem', { name: 'Тариф и оплата' }))
  expect(window.location.hash).toBe('#/settings/plan')
})

test('подсказка про подразделы — один раз: закрыли крестиком — больше нет; тап по строке — тоже закрывает', async () => {
  localStorage.removeItem(SUB_HINT_KEY)
  window.location.hash = '/patients/all'
  const first = renderApp()
  const tip = await screen.findByRole('note')
  expect(tip).toHaveTextContent('Здесь — подразделы «Пациенты»: Лист ожидания, Обращения… Нажмите сюда или на «Пациенты» в нижнем меню.')
  await userEvent.click(within(tip).getByRole('button', { name: 'Закрыть подсказку' }))
  expect(screen.queryByRole('note')).not.toBeInTheDocument()
  expect(localStorage.getItem(SUB_HINT_KEY)).toBe('seen')
  first.unmount()

  window.location.hash = '/cash'
  const second = renderApp()
  await tabs('Касса')
  expect(screen.queryByRole('note')).not.toBeInTheDocument()
  second.unmount()

  localStorage.removeItem(SUB_HINT_KEY)
  await act(async () => { window.location.hash = '/stock' })
  renderApp()
  // Подраздел с числом («Заказ») — первым в подсказке
  await screen.findByText(/Здесь — подразделы «Склад»: Заказ, Расходы на склад/)
  await userEvent.click(await bar('Склад'))
  expect(screen.queryByRole('note')).not.toBeInTheDocument()
  expect(sheetOf('Склад')).toBeInTheDocument()
})

test('компьютер: Касса — все 9 вкладок; Платформа — 9 вкладок владельца, старый адрес «Контента» — «Маркетинг»', async () => {
  vi.unstubAllGlobals()
  window.location.hash = '/cash'
  const first = renderApp()
  const row = await tabs('Касса')
  expect(names(row)).toEqual(['Деньги', 'Касса дня', 'Мой заработок', 'Аналитика', 'Расходы', 'Должники', 'Зарплата', 'Статистика', 'Отчёт'])
  expect(within(row).getByRole('link', { name: 'Деньги' })).toHaveAttribute('aria-current', 'page')
  // «?» раздела — в конце строки вкладок; иконок во вкладках нет
  expect(within(row).getByRole('button', { name: /^Подсказка:/ })).toBeInTheDocument()
  expect(row.querySelector('.sub-ico')).toBeNull()
  // Кнопки разделов на компьютере — без меню: подразделы панелью при наведении
  expect(await navButton('Касса')).not.toHaveAttribute('aria-haspopup')
  first.unmount()

  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, doctor: false, admin: false, platform: true, owner: true })))
  window.location.hash = '/platform/content'
  renderApp()
  const platform = await tabs('Платформа')
  expect(within(platform).getAllByRole('link').map((a) => a.textContent)).toEqual(['Клиники', 'Аналитика', 'Финансы', 'Обратная связь',
    'Рассылка клиникам', 'Маркетинг', 'Здоровье', 'Расход ИИ', 'Настройки'])
  expect(within(platform).getByRole('link', { name: 'Маркетинг' })).toHaveAttribute('aria-current', 'page')
  expect(window.location.hash).toBe('#/platform/marketing/content')
})

test('компьютер: «⌄» — только когда вкладки не влезают; новое в скрытых справа — точкой на ней', async () => {
  vi.unstubAllGlobals()
  server.use(http.get('*/api/patient-questions/new-count', () => HttpResponse.json({ count: 2 } satisfies Schemas['QuestionControllerNewCount'])))
  layout(true)
  window.location.hash = '/patients'
  const first = renderApp()
  const row = await tabs('Пациенты')
  await within(row).findByRole('link', { name: 'Вопросы · 2' })
  expect(within(row).queryByRole('button', { name: /Все подразделы/ })).not.toBeInTheDocument()
  first.unmount()

  // Не влезли: «Вопросы» (7-я вкладка) — за правым краем, её число не видно — точка на «⌄»
  layout(false)
  renderApp()
  const narrow = await tabs('Пациенты')
  await within(narrow).findByRole('link', { name: 'Вопросы · 2' })
  fireEvent.scroll(narrow.querySelector('.sub-tabs-scroll')!)
  const more = await within(narrow).findByRole('button', { name: 'Все подразделы: Пациенты (есть новое)' })
  expect(more.querySelector('.sub-tabs-dot')).not.toHaveClass('quiet')
})

test('компьютер: вкладки над страницей; «⌄» — список под кнопкой (Esc закрывает), подсказки нет', async () => {
  vi.unstubAllGlobals()
  localStorage.removeItem(SUB_HINT_KEY)
  layout(false)
  window.location.hash = '/cash'
  renderApp()
  const row = await tabs('Касса')
  expect(names(row)).toHaveLength(9)
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
