import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

/** Меню деревом (2026-11-10): подразделы — в меню слева, а не вкладками сверху. Данные вымышленные. */

const nav = () => screen.getByRole('navigation', { name: 'Разделы' })
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

test('дерево: раскрыт открытый раздел, подразделы — ссылками; вкладок сверху нет; заголовок — «Касса» мелко, подраздел крупно', async () => {
  window.location.hash = '/cash'
  renderApp()
  const cash = await within(await screen.findByRole('navigation', { name: 'Разделы' })).findByRole('group', { name: 'Касса' })
  // По умолчанию — первый подраздел, «Деньги»
  expect(within(cash).getByRole('link', { name: 'Деньги' })).toHaveAttribute('aria-current', 'page')
  expect(within(cash).getByRole('link', { name: 'Зарплата' })).toHaveAttribute('href', '#/cash/salary')
  expect(within(nav()).queryByRole('group', { name: 'Пациенты' })).not.toBeInTheDocument()
  expect(screen.queryByRole('tablist', { name: 'Разделы кассы' })).not.toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: 'Деньги' })).toBeInTheDocument()

  await userEvent.click(within(cash).getByRole('link', { name: 'Зарплата' }))
  expect(window.location.hash).toBe('#/cash/salary')
  expect(await screen.findByRole('heading', { name: 'Зарплата' })).toBeInTheDocument()
  expect(screen.getByText('Касса', { selector: '.sect-crumb' })).toBeInTheDocument()

  // Ушли в «Расписание» и вернулись в «Кассу» — снова «Зарплата», как было со вкладками
  await userEvent.click(within(nav()).getByRole('button', { name: /^Расписание/ }))
  expect(within(nav()).queryByRole('group', { name: 'Касса' })).not.toBeInTheDocument()
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
  expect(within(nav()).getByRole('group', { name: 'Касса' })).toBeInTheDocument()
  // Подраздел соседнего раздела не подсвечен: мы всё ещё в «Кассе»
  expect(within(patients).getByRole('link', { name: 'Все' })).not.toHaveAttribute('aria-current')
  expect(within(nav()).getByRole('button', { name: 'Свернуть подразделы: Пациенты' })).toHaveAttribute('aria-expanded', 'true')

  await userEvent.click(within(patients).getByRole('link', { name: 'Лист ожидания' }))
  expect(window.location.hash).toBe('#/patients/waitlist')
  // Перешли — раскрыт только новый раздел
  await waitFor(() => expect(within(nav()).queryByRole('group', { name: 'Касса' })).not.toBeInTheDocument())
  expect(within(nav()).getByRole('link', { name: 'Лист ожидания' })).toHaveAttribute('aria-current', 'page')
})

test('числа: у подразделов «Вопросы» и «Лист ожидания», у свёрнутого раздела — сумма', async () => {
  const waiting: Schemas['WaitlistView'][] = [1, 2].map((id) => ({ id, doctorId: 1, patient: { id, fullName: `Ожидает ${id}` } }))
  server.use(
    http.get('*/api/patient-questions/new-count', () => HttpResponse.json({ count: 3 })),
    http.get('*/api/waitlist', () => HttpResponse.json(waiting)),
  )
  window.location.hash = '/schedule'
  renderApp()
  expect(await screen.findByLabelText('Пациенты: новое — 5')).toHaveTextContent('5')
  go('/patients')
  expect(await within(nav()).findByRole('link', { name: 'Вопросы · 3' })).toBeInTheDocument()
  expect(within(nav()).getByRole('link', { name: 'Лист ожидания · 2' })).toBeInTheDocument()
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

test('телефон: подразделы — вкладками вверху (меню слева нет); нажатие — новый адрес и заголовок', async () => {
  phone()
  window.location.hash = '/patients/waitlist'
  renderApp()
  const tabs = await screen.findByRole('navigation', { name: 'Подразделы: Пациенты' })
  // Подраздел — заголовком страницы, как на компьютере (на телефоне виден вкладкой, заголовок — для читалок)
  expect(screen.getByRole('heading', { name: 'Лист ожидания' })).toBeInTheDocument()
  expect(screen.queryByRole('tablist', { name: 'Списки пациентов' })).not.toBeInTheDocument()
  expect(within(tabs).getByRole('link', { name: 'Лист ожидания' })).toHaveAttribute('aria-current', 'page')
  await userEvent.click(within(tabs).getByRole('link', { name: 'Вопросы' }))
  expect(window.location.hash).toBe('#/patients/questions')
  expect(await screen.findByRole('heading', { name: 'Вопросы' })).toBeInTheDocument()
  expect(within(screen.getByRole('navigation', { name: 'Подразделы: Пациенты' })).getByRole('link', { name: 'Вопросы' })).toHaveAttribute('aria-current', 'page')
})

test('телефон: долгое нажатие на раздел внизу — тот же лист; короткое — просто переход', async () => {
  phone()
  window.location.hash = '/schedule'
  renderApp()
  const cash = await within(await screen.findByRole('navigation', { name: 'Разделы' })).findByRole('button', { name: /^Касса/ })
  fireEvent.pointerDown(cash, { pointerType: 'touch' })
  await act(() => new Promise((r) => setTimeout(r, 600)))
  fireEvent.pointerUp(cash)
  fireEvent.click(cash)
  const sheet = screen.getByRole('dialog', { name: 'Подразделы: Касса' })
  // Лист открыт, раздел не сменился
  expect(window.location.hash).toBe('#/schedule')
  await userEvent.click(within(sheet).getByRole('link', { name: 'Должники' }))
  expect(window.location.hash).toBe('#/cash/debtors')

  const patients = within(nav()).getByRole('button', { name: /^Пациенты/ })
  fireEvent.pointerDown(patients, { pointerType: 'touch' })
  fireEvent.pointerUp(patients)
  fireEvent.click(patients)
  expect(window.location.hash).toBe('#/patients')
  expect(screen.queryByRole('dialog', { name: /Подразделы/ })).not.toBeInTheDocument()
})

test('права в дереве: ассистент — без «Кассы» и цен, «Профосмотр»; менеджер платформы — только «Клиники» и «Опросы»', async () => {
  const assistant = { ...me, admin: false, doctorId: undefined, fullName: 'Асель', assistantOf: [2] }
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(assistant)))
  window.location.hash = '/patients'
  const first = renderApp()
  const patients = await within(await screen.findByRole('navigation', { name: 'Разделы' })).findByRole('group', { name: 'Пациенты' })
  expect(within(patients).getByRole('link', { name: 'Профосмотр' })).toBeInTheDocument()
  expect(within(patients).queryByRole('link', { name: 'Позвать снова' })).not.toBeInTheDocument()
  expect(within(nav()).queryByRole('button', { name: /^Касса/ })).not.toBeInTheDocument()
  await userEvent.click(within(nav()).getByRole('button', { name: 'Раскрыть подразделы: Настройки' }))
  const settings = within(nav()).getByRole('group', { name: 'Настройки' })
  expect(within(settings).getByRole('link', { name: /Памятки после процедур/ })).toBeInTheDocument()
  expect(within(settings).queryByRole('link', { name: /Тариф и оплата/ })).not.toBeInTheDocument()
  // Группы — подписями внутри раздела; «Аккаунт клиники» у ассистента пуст — подписи нет
  expect(within(settings).getByText('Пациентам')).toBeInTheDocument()
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
  const platform = await within(await screen.findByRole('navigation', { name: 'Разделы' })).findByRole('group', { name: 'Платформа' })
  expect(within(platform).getAllByRole('link').map((a) => a.textContent)).toEqual(['Клиники', 'Опросы'])
})

test('старые адреса и кнопки бота открывают нужный подраздел', async () => {
  // «Кто на смене» из бота — #/settings/shifts: «Клиника → Рабочее время», вкладка «Смены персонала»
  window.location.hash = '/settings/shifts'
  const first = renderApp()
  const clinic = await within(await screen.findByRole('navigation', { name: 'Разделы' })).findByRole('group', { name: 'Клиника' })
  expect(within(clinic).getByRole('link', { name: /Рабочее время/ })).toHaveAttribute('aria-current', 'page')
  expect(window.location.hash).toBe('#/clinic/shifts')
  expect(await screen.findByRole('tab', { name: 'Смены персонала' })).toHaveAttribute('aria-selected', 'true')
  first.unmount()

  // ?screen=earnings — «Касса → Мой заработок», адрес с подразделом (обновили — там же)
  window.history.replaceState(null, '', '/?screen=earnings')
  renderApp()
  await waitFor(() => expect(window.location.hash).toBe('#/cash/earnings'))
  expect(await within(await screen.findByRole('navigation', { name: 'Разделы' })).findByRole('link', { name: 'Мой заработок' })).toHaveAttribute('aria-current', 'page')
  expect(window.location.search).toBe('')
})

test('«Клиника» — раздел меню: подразделы о клинике, персонал, услуги, рабочее время, кресла; заголовок «Клиника» мелко', async () => {
  server.use(http.get('*/api/clinic', () => HttpResponse.json({ brandName: 'Стоматология «Тест»', workDays: [] })))
  window.location.hash = '/schedule'
  renderApp()
  // Раздел — между «Складом» и «Настройками»
  const buttons = within(await screen.findByRole('navigation', { name: 'Разделы' })).getAllByRole('button', { name: /^(Склад|Клиника|Настройки)$/ })
  expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Склад', 'Клиника', 'Настройки'])
  await userEvent.click(within(nav()).getByRole('button', { name: 'Клиника' }))
  expect(window.location.hash).toBe('#/clinic')
  const clinic = within(nav()).getByRole('group', { name: 'Клиника' })
  expect(within(clinic).getAllByRole('link').map((a) => a.textContent)).toEqual(['О клинике', 'Персонал', 'Услуги и цены', 'Рабочее время', 'Кресла'])
  // Без пункта в адресе — первый, «О клинике»
  expect(within(clinic).getByRole('link', { name: 'О клинике' })).toHaveAttribute('aria-current', 'page')
  expect(await screen.findByRole('form', { name: 'О клинике' })).toBeInTheDocument()
  expect(screen.getByText('Клиника', { selector: '.sect-crumb' })).toBeInTheDocument()
  await userEvent.click(within(clinic).getByRole('link', { name: 'Персонал' }))
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
    const clinic = await within(await screen.findByRole('navigation', { name: 'Разделы' })).findByRole('group', { name: 'Клиника' })
    expect(window.location.hash).toBe('#/clinic/staff')
    expect(within(clinic).getByRole('link', { name: 'Персонал' })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('heading', { name: 'Персонал' })).toBeInTheDocument()
    view.unmount()
  }
})

test('телефон: внизу четыре раздела и «Ещё»; в «Ещё» — свой аватар, «Клиника», «Для пациента», «Настройки», «Помощь»; у «Клиники» — вкладки подразделов', async () => {
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
  await userEvent.click(within(more).getByRole('button', { name: 'Клиника' }))
  expect(window.location.hash).toBe('#/clinic')
  const tabs = await screen.findByRole('navigation', { name: 'Подразделы: Клиника' })
  expect(within(tabs).getByRole('link', { name: 'О клинике' })).toHaveAttribute('aria-current', 'page')
  await userEvent.click(within(tabs).getByRole('link', { name: 'Рабочее время' }))
  expect(window.location.hash).toBe('#/clinic/hours')
  expect(within(await screen.findByRole('navigation', { name: 'Подразделы: Клиника' })).getByRole('link', { name: 'Рабочее время' }))
    .toHaveAttribute('aria-current', 'page')
})
