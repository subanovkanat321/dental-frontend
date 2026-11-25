import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { findSubs, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

/**
 * Меню деревом (2026-11-10) и вкладки подразделов над страницей (2026-11-11): у открытого раздела
 * подразделы — вкладками, в меню он свёрнут; стрелка › раскрывает любой раздел. Данные вымышленные.
 */

const nav = () => screen.getByRole('navigation', { name: 'Разделы' })
const tabs = (title: string) => screen.findByRole('navigation', { name: `Подразделы: ${title}` })
const go = (hash: string) => act(() => {
  window.location.hash = hash
  window.dispatchEvent(new HashChangeEvent('hashchange'))
})

beforeEach(() => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)))
})

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

test('компьютер: подразделы — вкладками над страницей, в меню открытый раздел свёрнут; память подраздела', async () => {
  window.location.hash = '/cash'
  renderApp()
  const row = await tabs('Касса')
  // По умолчанию — первый подраздел, «Деньги»
  expect(within(row).getByRole('link', { name: 'Деньги' })).toHaveAttribute('aria-current', 'page')
  expect(within(row).getByRole('link', { name: 'Зарплата' })).toHaveAttribute('href', '#/cash/salary')
  // Меню не дублирует вкладки: «Касса» выделена, но свёрнута — раскрыть можно стрелкой
  expect(within(nav()).queryByRole('group')).not.toBeInTheDocument()
  expect(within(nav()).getByRole('button', { name: /^Касса/ })).toHaveAttribute('aria-current', 'page')
  expect(within(nav()).getByRole('button', { name: 'Раскрыть подразделы: Касса' })).toHaveAttribute('aria-expanded', 'false')
  expect(await screen.findByRole('heading', { name: 'Деньги' })).toBeInTheDocument()

  await userEvent.click(within(row).getByRole('link', { name: 'Зарплата' }))
  expect(window.location.hash).toBe('#/cash/salary')
  expect(await screen.findByRole('heading', { name: 'Зарплата' })).toBeInTheDocument()
  expect(within(await tabs('Касса')).getByRole('link', { name: 'Зарплата' })).toHaveAttribute('aria-current', 'page')

  // Ушли в «Расписание» и вернулись в «Кассу» — снова «Зарплата»
  await userEvent.click(within(nav()).getByRole('button', { name: /^Расписание/ }))
  expect(screen.queryByRole('navigation', { name: 'Подразделы: Касса' })).not.toBeInTheDocument()
  await userEvent.click(within(nav()).getByRole('button', { name: /^Касса/ }))
  expect(await screen.findByRole('heading', { name: 'Зарплата' })).toBeInTheDocument()
})

test('стрелка › раскрывает подразделы соседнего раздела, не уводя с экрана; переход — по подразделу', async () => {
  window.location.hash = '/cash'
  renderApp()
  const chev = await within(await screen.findByRole('navigation', { name: 'Разделы' })).findByRole('button', { name: 'Раскрыть подразделы: Пациенты' })
  await userEvent.click(chev)
  const patients = within(nav()).getByRole('group', { name: 'Пациенты' })
  expect(window.location.hash).toBe('#/cash')
  // Подраздел соседнего раздела не подсвечен: мы всё ещё в «Кассе»
  expect(within(patients).getByRole('link', { name: 'Все' })).not.toHaveAttribute('aria-current')
  expect(within(nav()).getByRole('button', { name: 'Свернуть подразделы: Пациенты' })).toHaveAttribute('aria-expanded', 'true')

  await userEvent.click(within(patients).getByRole('link', { name: 'Лист ожидания' }))
  expect(window.location.hash).toBe('#/patients/waitlist')
  // Перешли — дерево снова свёрнуто, подраздел отмечен во вкладках
  await waitFor(() => expect(within(nav()).queryByRole('group')).not.toBeInTheDocument())
  expect(within(await tabs('Пациенты')).getByRole('link', { name: 'Лист ожидания' })).toHaveAttribute('aria-current', 'page')
})

test('числа: у вкладок «Вопросы» и «Лист ожидания», у свёрнутого раздела в меню — сумма', async () => {
  const waiting: Schemas['WaitlistView'][] = [1, 2].map((id) => ({ id, doctorId: 1, patient: { id, fullName: `Ожидает ${id}`, telegram: false }, durationMinutes: 30 }))
  server.use(
    http.get('*/api/patient-questions/new-count', () => HttpResponse.json({ count: 3 })),
    http.get('*/api/waitlist', () => HttpResponse.json(waiting)),
  )
  window.location.hash = '/schedule'
  renderApp()
  expect(await screen.findByLabelText('Пациенты: новое — 5')).toHaveTextContent('5')
  go('/patients')
  const row = await tabs('Пациенты')
  expect(await within(row).findByRole('link', { name: 'Вопросы · 3' })).toBeInTheDocument()
  expect(within(row).getByRole('link', { name: 'Лист ожидания · 2' })).toBeInTheDocument()
  // Раскрыли «Пациентов» в меню — числа у подразделов там, у самого раздела суммы нет (не повторяем)
  await userEvent.click(within(nav()).getByRole('button', { name: 'Раскрыть подразделы: Пациенты' }))
  expect(within(within(nav()).getByRole('group', { name: 'Пациенты' })).getByRole('link', { name: 'Вопросы · 3' })).toBeInTheDocument()
})

test('свёрнутое меню: подразделы всплывают панелью при наведении; на сенсорном экране — по нажатию', async () => {
  localStorage.setItem('tish.full.sidebar-narrow', '1')
  window.location.hash = '/schedule'
  const { container } = renderApp()
  await screen.findByRole('navigation', { name: 'Разделы' })
  expect(container.querySelector('.shell')).toHaveClass('narrow')
  // Свёрнуто — дерева нет, только иконки
  expect(within(nav()).queryByRole('group')).not.toBeInTheDocument()
  const cash = within(nav()).getByRole('button', { name: /^Касса/ })
  await userEvent.hover(cash)
  const fly = await screen.findByRole('group', { name: 'Касса' })
  await userEvent.click(within(fly).getByRole('link', { name: 'Зарплата' }))
  expect(window.location.hash).toBe('#/cash/salary')
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Касса' })).not.toBeInTheDocument())
  await userEvent.unhover(cash)

  // Палец: нажатие не уводит, а показывает подразделы; заголовок панели — переход в раздел
  const patients = within(nav()).getByRole('button', { name: /^Пациенты/ })
  fireEvent.pointerDown(patients, { pointerType: 'touch' })
  fireEvent.click(patients)
  const group = screen.getByRole('group', { name: 'Пациенты' })
  expect(window.location.hash).toBe('#/cash/salary')
  await userEvent.click(within(group).getByRole('button', { name: 'Пациенты' }))
  expect(window.location.hash).toBe('#/patients')
})

/** Телефон: ширина до 760px. */
function phone() {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 760px'), addEventListener() {}, removeEventListener() {} }))
}

test('телефон: над страницей — «Пациенты · Лист ожидания ▾» (меню слева нет); выбор в листе — новый адрес и заголовок', async () => {
  phone()
  window.location.hash = '/patients/waitlist'
  renderApp()
  const bar = await screen.findByRole('navigation', { name: 'Подразделы: Пациенты' })
  // Подраздел — заголовком страницы, как на компьютере (на телефоне — в строке над страницей, заголовок — для читалок)
  expect(screen.getByRole('heading', { name: 'Лист ожидания' })).toBeInTheDocument()
  expect(screen.queryByRole('tablist', { name: 'Списки пациентов' })).not.toBeInTheDocument()
  await userEvent.click(within(bar).getByRole('button', { name: /^Пациенты · Лист ожидания: выбрать подраздел/ }))
  await userEvent.click(within(screen.getByRole('menu', { name: 'Подразделы: Пациенты' })).getByRole('menuitem', { name: 'Вопросы' }))
  expect(window.location.hash).toBe('#/patients/questions')
  expect(await screen.findByRole('heading', { name: 'Вопросы' })).toBeInTheDocument()
  expect(within(screen.getByRole('navigation', { name: 'Подразделы: Пациенты' })).getByRole('button', { name: /^Пациенты · Вопросы/ })).toBeInTheDocument()
})

test('права в дереве: ассистент — без «Кассы» и цен, «Профосмотр»; менеджер платформы — только «Клиники» и «Опросы»', async () => {
  const assistant = { ...me, admin: false, doctorId: undefined, fullName: 'Асель', assistantOf: [2] }
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(assistant)))
  window.location.hash = '/patients'
  const first = renderApp()
  const patients = await tabs('Пациенты')
  expect(within(patients).getByRole('link', { name: 'Профосмотр' })).toBeInTheDocument()
  expect(within(patients).queryByRole('link', { name: 'Позвать снова' })).not.toBeInTheDocument()
  expect(within(nav()).queryByRole('button', { name: /^Касса/ })).not.toBeInTheDocument()
  await userEvent.click(within(nav()).getByRole('button', { name: 'Раскрыть подразделы: Настройки' }))
  const settings = within(nav()).getByRole('group', { name: 'Настройки' })
  expect(within(settings).getByRole('link', { name: /Памятки после процедур/ })).toBeInTheDocument()
  expect(within(settings).queryByRole('link', { name: /Тариф и оплата/ })).not.toBeInTheDocument()
  // Группы — подписями внутри раздела; «Аккаунт клиники» у ассистента пуст — подписи нет
  expect(within(settings).getByText('Что получают пациенты')).toBeInTheDocument()
  expect(within(settings).queryByText('Аккаунт клиники')).not.toBeInTheDocument()
  expect(within(settings).queryByText('Мои настройки')).not.toBeInTheDocument()
  // «Клиника» — без «Услуг и цен» (цены ассистенту не показываем)
  await userEvent.click(within(nav()).getByRole('button', { name: 'Раскрыть подразделы: Клиника' }))
  const clinic = within(nav()).getByRole('group', { name: 'Клиника' })
  expect(within(clinic).getByRole('link', { name: 'Персонал' })).toHaveAttribute('href', '#/clinic/staff')
  expect(within(clinic).queryByRole('link', { name: /Услуги и цены/ })).not.toBeInTheDocument()
  first.unmount()

  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, doctor: false, admin: false, platform: true, owner: false })))
  window.location.hash = '/platform'
  renderApp()
  const platform = await tabs('Платформа')
  expect(within(platform).getAllByRole('link').map((a) => a.textContent)).toEqual(['Клиники', 'Опросы'])
})

test('старые адреса и кнопки бота открывают нужный подраздел', async () => {
  // «Кто на смене» из бота — #/settings/shifts: «Клиника → Рабочее время → График», неделя по датам
  window.location.hash = '/settings/shifts'
  const first = renderApp()
  const clinic = await findSubs('Клиника')
  expect(clinic.get(/Рабочее время/)).toHaveAttribute('aria-current', 'page')
  expect(window.location.hash).toBe('#/clinic/shifts')
  const nav = await screen.findByRole('group', { name: 'Рабочее время' })
  expect(within(nav).getByRole('button', { name: 'Неделя по датам' })).toHaveAttribute('aria-pressed', 'true')
  first.unmount()

  // ?screen=earnings — «Касса → Мой заработок», адрес с подразделом (обновили — там же)
  window.history.replaceState(null, '', '/?screen=earnings')
  renderApp()
  await waitFor(() => expect(window.location.hash).toBe('#/cash/earnings'))
  expect(within(await tabs('Касса')).getByRole('link', { name: 'Мой заработок' })).toHaveAttribute('aria-current', 'page')
  expect(window.location.search).toBe('')
})

test('«Клиника» — раздел меню: подразделы о клинике, персонал, услуги, рабочее время, кресла — вкладками', async () => {
  server.use(http.get('*/api/clinic', () => HttpResponse.json({ brandName: 'Стоматология «Тест»', workDays: [] })))
  window.location.hash = '/schedule'
  renderApp()
  // Раздел — между «Складом» и «Настройками»
  const buttons = within(await screen.findByRole('navigation', { name: 'Разделы' })).getAllByRole('button', { name: /^(Склад|Клиника|Настройки)$/ })
  expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Склад', 'Клиника', 'Настройки'])
  await userEvent.click(within(nav()).getByRole('button', { name: 'Клиника' }))
  expect(window.location.hash).toBe('#/clinic')
  // Пункты — вкладками (?ui=v1) или листом «‹» экрана «внутрь» (v2, по умолчанию)
  const clinic = await findSubs('Клиника')
  expect(clinic.titles()).toEqual(['О клинике', 'Персонал', 'Услуги и цены', 'Рабочее время', 'Кресла'])
  // Без пункта в адресе — первый, «О клинике»
  expect(clinic.get('О клинике')).toHaveAttribute('aria-current', 'page')
  expect(await screen.findByRole('form', { name: 'О клинике' })).toBeInTheDocument()
  await userEvent.click(clinic.get('Персонал'))
  expect(window.location.hash).toBe('#/clinic/staff')
  expect(await screen.findByRole('heading', { name: 'Персонал' })).toBeInTheDocument()
  // В «Настройках» этих пунктов больше нет
  await userEvent.click(within(nav()).getByRole('button', { name: 'Раскрыть подразделы: Настройки' }))
  expect(within(within(nav()).getByRole('group', { name: 'Настройки' })).queryByRole('link', { name: 'Персонал' })).not.toBeInTheDocument()
})

test('старые адреса пунктов «Клиники»: #/settings/staff, /doctors, #/team → #/clinic/staff', async () => {
  for (const old of ['/settings/staff', '/settings/doctors', '/team']) {
    window.location.hash = old
    const view = renderApp()
    const clinic = await findSubs('Клиника')
    expect(window.location.hash).toBe('#/clinic/staff')
    expect(clinic.get('Персонал')).toHaveAttribute('aria-current', 'page')
    expect((await screen.findAllByRole('heading', { name: 'Персонал' })).length).toBeGreaterThan(0)
    view.unmount()
  }
})

test('телефон: внизу четыре раздела и «Ещё»; в «Ещё» — свой аватар, «Клиника», «Для пациента», «Настройки», «Помощь»; «Клиника» — лист подразделов', async () => {
  phone()
  server.use(http.get('*/api/clinic', () => HttpResponse.json({ brandName: 'Стоматология «Тест»', workDays: [] })))
  window.location.hash = '/schedule'
  renderApp()
  await screen.findByRole('navigation', { name: 'Разделы' })
  // Видимые кнопки внизу (остальные — «extra», скрыты стилем на телефоне)
  const bottom = [...nav().querySelectorAll<HTMLElement>('.nav-item:not(.extra) > .nav-row > .nav, .nav.more')].map((b) => b.textContent?.trim())
  expect(bottom).toEqual(['Расписание', 'Пациенты', 'Касса', 'Склад', 'Ещё'])
  await userEvent.click(within(nav()).getByRole('button', { name: 'Ещё' }))
  const more = screen.getByRole('dialog', { name: 'Ещё разделы' })
  expect(within(more).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual([
    expect.stringContaining('Айгерим Садыкова'), 'Для пациента', 'Клиника', 'Настройки', 'Помощь',
  ])
  // «Клиника» в «Ещё» — сразу лист её подразделов, как у вкладок внизу (2026-11-21), а не переход в первый пункт
  await userEvent.click(within(more).getByRole('button', { name: 'Клиника' }))
  expect(window.location.hash).toBe('#/schedule')
  await userEvent.click(within(await screen.findByRole('menu', { name: 'Подразделы: Клиника' })).getByRole('menuitem', { name: /^Рабочее время/ }))
  await waitFor(() => expect(window.location.hash).toBe('#/clinic/hours'))
  expect(screen.queryByRole('dialog', { name: 'Ещё разделы' })).not.toBeInTheDocument()
  const bar = await screen.findByRole('navigation', { name: 'Подразделы: Клиника' })
  await userEvent.click(within(bar).getByRole('button', { name: /^Клиника · Рабочее время: выбрать подраздел/ }))
  await userEvent.click(within(screen.getByRole('menu', { name: 'Подразделы: Клиника' })).getByRole('menuitem', { name: /^О клинике/ }))
  await waitFor(() => expect(window.location.hash).toBe('#/clinic/about'))
  go('/clinic/hours')
  expect(within(await screen.findByRole('navigation', { name: 'Подразделы: Клиника' })).getByRole('button', { name: /^Клиника · Рабочее время/ })).toBeInTheDocument()
})

test('«Настройки» — пунктами над страницей (вкладки, в v2 — лист «‹»): #/settings — первый пункт роли, старый адрес пункта — его пункт, «‹ Настройки» нет', async () => {
  window.location.hash = '/settings'
  renderApp()
  const bar = await findSubs('Настройки')
  expect(bar.get('Напоминание о приёме')).toHaveAttribute('aria-current', 'page')
  expect(bar.titles()).toHaveLength(20) // + «Приведи друга» (V260), «WhatsApp» (V256), «Дни рождения» (шаг 6Б), «Правка приёмов» (шаг 5А); «Отметки приёма» убраны 2026-11-21
  expect(within(nav()).queryByRole('group', { name: 'Настройки' })).not.toBeInTheDocument()
  expect(within(nav()).getByRole('button', { name: 'Раскрыть подразделы: Настройки' })).toHaveAttribute('aria-expanded', 'false')
  await userEvent.click(bar.get('Памятки после процедур'))
  expect(window.location.hash).toBe('#/settings/memos')
  expect(await screen.findByRole('heading', { name: 'Памятки после процедур' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '‹ Настройки' })).not.toBeInTheDocument()
  // Старые ссылки (бот, подсказки): #/settings/promo — вкладка «Откуда приходят пациенты»
  go('/settings/promo')
  await waitFor(async () => expect((await findSubs('Настройки')).get('Откуда приходят пациенты')).toHaveAttribute('aria-current', 'page'))
})

test('«Настройки» у ассистента: только его пункты; пункт не для его роли — первый его пункт', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, doctorId: undefined, assistantOf: [2] })))
  window.location.hash = '/settings/plan'
  renderApp()
  const bar = await findSubs('Настройки')
  // Тарифа ассистенту нет — открыт первый его пункт
  expect(bar.titles()).toEqual(['Памятки после процедур', 'Откуда приходят пациенты'])
  expect(bar.get('Памятки после процедур')).toHaveAttribute('aria-current', 'page')
})

test('старый вид (?ui=v1): у «Настроек» и «Клиники» — вкладки-ссылки; v2: круглая «‹» с тем же именем открывает лист пунктов', async () => {
  document.documentElement.classList.remove('ui-v2')
  window.location.hash = '/clinic/staff'
  const view = renderApp()
  const clinic = await tabs('Клиника')
  expect(clinic).not.toHaveClass('v2-drill')
  expect(within(clinic).getAllByRole('link').map((a) => a.textContent)).toEqual(['О клинике', 'Персонал', 'Услуги и цены', 'Рабочее время', 'Кресла'])
  expect(within(clinic).getByRole('link', { name: 'Персонал' })).toHaveAttribute('aria-current', 'page')
  view.unmount()

  document.documentElement.classList.add('ui-v2')
  renderApp()
  const drill = await tabs('Клиника')
  expect(drill).toHaveClass('v2-drill')
  expect(within(drill).queryAllByRole('link')).toHaveLength(0)
  await userEvent.click(within(drill).getByRole('button', { name: 'Клиника · Персонал: выбрать подраздел' }))
  const sheet = screen.getByRole('menu', { name: 'Подразделы: Клиника' })
  expect(within(sheet).getByRole('menuitem', { name: 'Персонал · открыт сейчас' })).toHaveAttribute('aria-current', 'page')
  await userEvent.click(within(sheet).getByRole('menuitem', { name: 'Кресла' }))
  await waitFor(() => expect(window.location.hash).toBe('#/clinic/chairs'))
})
