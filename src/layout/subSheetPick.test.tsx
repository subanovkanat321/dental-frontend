import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { enableBackHistory } from '../lib/back'
import { resetSubs } from '../lib/sub'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'
import { SUB_HINT_KEY } from './section'

/**
 * Телефон, лист подразделов «⌄» с историей браузера (как в Safari/PWA, не Telegram). Баг 2026-11-13: в «Настройках»
 * выбрали пункт в листе — лист закрылся, а экран остался прежним. Переход заменой адреса ложился на запись листа;
 * Safari при замене хэша оставляет у записи state листа (`tishBack`), лист при закрытии делал history.back() — назад
 * на прежний адрес, а «Настройки» (свой слушатель адреса, не lib/sub) показывали первый пункт. Теперь лист сначала
 * снимает свою запись, потом переход; «Настройки» берут пункт из lib/sub, как вкладки. Данные вымышленные.
 */

const own = Object.fromEntries(['offsetWidth', 'offsetLeft', 'clientWidth', 'scrollWidth']
  .map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]))

/** Размеры полосы вкладок (компьютер; на телефоне их нет — не мешают). */
function narrowTabs() {
  const tabIndex = (el: HTMLElement) => [...(el.parentElement?.children ?? [])].indexOf(el)
  const props: Record<string, (el: HTMLElement) => number> = {
    offsetWidth: (el) => (el.classList.contains('sub-tabs-list') ? 900 : el.classList.contains('sub-tab') ? 100 : 0),
    offsetLeft: (el) => (el.classList.contains('sub-tab') ? tabIndex(el) * 100 : 0),
    clientWidth: (el) => (el.classList.contains('sub-tabs') ? 390 : el.classList.contains('sub-tabs-scroll') ? 300 : 0),
    scrollWidth: (el) => (el.classList.contains('sub-tabs-scroll') ? 900 : 0),
  }
  for (const [name, get] of Object.entries(props)) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get(this: HTMLElement) { return get(this) } })
  }
}

/** Что происходило с историей: history.back(), popstate и смены адреса — по порядку. */
let events: string[] = []
const onPop = () => events.push('popstate')
const onHash = () => events.push(window.location.hash)

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 760px'), addEventListener() {}, removeEventListener() {} }))
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)))
  localStorage.setItem(SUB_HINT_KEY, 'seen')
  narrowTabs()
  enableBackHistory(true)
  events = []
  const back = window.history.back.bind(window.history)
  vi.spyOn(window.history, 'back').mockImplementation(() => { events.push('back'); back() })
  window.addEventListener('popstate', onPop)
  window.addEventListener('hashchange', onHash)
})

afterEach(async () => {
  window.removeEventListener('popstate', onPop)
  window.removeEventListener('hashchange', onHash)
  enableBackHistory(false)
  // отложенные шаги назад этого теста — до следующего
  await new Promise((r) => setTimeout(r, 30))
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetSubs()
  window.history.replaceState(null, '', '/')
  for (const [name, d] of Object.entries(own)) {
    if (d) Object.defineProperty(HTMLElement.prototype, name, d)
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
  }
})

/** Глубина нашей записи истории (0 — не наша). */
const depth = () => (window.history.state as { tishBack?: number } | null)?.tishBack ?? 0

const tabs = (title: string) => screen.findByRole('navigation', { name: `Подразделы: ${title}` })
/** Открытый подраздел — по имени кнопки над страницей «Раздел · Подраздел: выбрать подраздел» (и «▾», и круглой «‹» v2) */
const current = async (title: string) => within(await tabs(title)).getByRole('button', { name: /выбрать подраздел/ }).getAttribute('aria-label')
  ?.match(new RegExp(`^${title} · (.+?): выбрать подраздел`))?.[1]

/** Строка «Раздел · Подраздел ▾» → лист. Пока грузится кусочек кода пункта, шапка с вкладками — временная (Suspense) и сменяется настоящей:
 *  нажатие по кнопке, которую как раз заменили, теряется — тогда нажимаем снова. */
async function openSheet(title: string) {
  return waitForSlow(async () => {
    const open = screen.queryByRole('menu', { name: `Подразделы: ${title}` })
    if (open) return open
    await userEvent.click(within(await tabs(title)).getByRole('button', { name: /выбрать подраздел/ }))
    return screen.getByRole('menu', { name: `Подразделы: ${title}` })
  })
}

test.each([
  ['settings', 'Настройки', 'Сообщения пациентам', 'Клиника в Tish', '#/settings/account'],
  ['cash', 'Касса', 'Деньги', 'Должники', '#/cash/debtors'],
])('%s: пункт из листа подразделов открывается; сначала лист снимает свою запись истории, потом переход', async (page, title, first, pick, hash) => {
  window.location.hash = `/${page}`
  renderApp()
  expect(await current(title)).toBe(first)
  expect(await screen.findByRole('heading', { name: first })).toBeInTheDocument()
  const length = window.history.length

  const sheet = await openSheet(title)
  await waitForSlow(() => expect(depth()).toBe(1))
  events = []
  await userEvent.click(within(sheet).getByRole('menuitem', { name: pick }))

  await waitForSlow(() => expect(window.location.hash).toBe(hash))
  expect(screen.queryByRole('menu', { name: `Подразделы: ${title}` })).not.toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: pick })).toBeInTheDocument()
  expect(await current(title)).toBe(pick)
  // Порядок: шаг назад листа — до перехода. Переход на записи листа в Safari оставлял её state, и лист возвращал назад
  expect(events.filter((e) => e === 'back' || e.startsWith('#'))).toEqual(['back', hash])
  expect(depth()).toBe(0)
  await new Promise((r) => setTimeout(r, 100))
  expect(window.location.hash).toBe(hash)
  // Переключение подраздела не копит шагов «назад» (lib/sub): запись листа снята, адрес раздела заменён
  expect(window.history.length).toBe(length + 1)
})

test('Настройки: вкладка и экран — из одного источника; закрыли лист без выбора — пункт тот же', async () => {
  window.location.hash = '/settings/plan'
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Клиника в Tish' })).toBeInTheDocument()
  // Телефон — короткое название вкладки
  expect(await screen.findByRole('tab', { name: 'Коллеги' })).toHaveAttribute('aria-selected', 'true')
  // Вернулись на адрес раздела без пункта (назад, ссылка) — и вкладка, и экран: последний открытый пункт
  window.location.hash = '/settings'
  await new Promise((r) => setTimeout(r, 50))
  expect(await current('Настройки')).toBe('Клиника в Tish')
  expect(screen.getByRole('heading', { name: 'Клиника в Tish' })).toBeInTheDocument()

  const sheet = await openSheet('Настройки')
  await userEvent.click(within(sheet).getByRole('button', { name: 'Закрыть' }))
  expect(screen.queryByRole('menu', { name: 'Подразделы: Настройки' })).not.toBeInTheDocument()
  await waitForSlow(() => expect(depth()).toBe(0))
  expect(window.location.hash).toBe('#/settings')
  expect(await current('Настройки')).toBe('Клиника в Tish')
  expect(screen.getByRole('heading', { name: 'Клиника в Tish' })).toBeInTheDocument()
})

test('«назад» (история браузера) закрывает лист из нижнего меню — раздел не меняется', async () => {
  window.location.hash = '/schedule'
  renderApp()
  const nav = await screen.findByRole('navigation', { name: 'Разделы' })
  await userEvent.click(within(nav).getByRole('button', { name: /^Склад/ }))
  expect(screen.getByRole('menu', { name: 'Подразделы: Склад' })).toBeInTheDocument()
  await waitForSlow(() => expect(depth()).toBe(1))
  window.history.back()
  await waitForSlow(() => expect(screen.queryByRole('menu', { name: 'Подразделы: Склад' })).not.toBeInTheDocument())
  expect(window.location.hash).toBe('#/schedule')
})
