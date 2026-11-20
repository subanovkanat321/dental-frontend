import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, meArrivals } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'
import { AppointmentPanel } from './AppointmentPanel'

type Appointment = Schemas['AppointmentView']
type Me = Schemas['BookingViewsMe']

// Вымышленный пациент «Бакыт Тестов»; приём сегодня, время уже наступило
const base = appointment(30, 1, '00:05', 'Бакыт Тестов', { version: 1, serviceName: 'Лечение кариеса' })
// До прихода: время приёма идёт сейчас (иначе следующий шаг — сразу «Приём состоялся»)
const currentVisit = () => ({ ...base, startAt: new Date(Date.now() - 5 * 60_000).toISOString(), endAt: new Date(Date.now() + 25 * 60_000).toISOString() })
const reception: Me = { ...me, admin: false, doctor: true, reception: true, doctorId: undefined }
const assistant: Me = { ...me, admin: false, doctor: true, doctorId: undefined, assistantOf: [1] }

function phoneScreen(on: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true, writable: true,
    value: on ? (q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) : undefined,
  })
}

function backend() {
  const sent: unknown[] = []
  server.use(
    http.post('*/api/appointments/:id/status', async ({ request }) => {
      sent.push(await request.json())
      return HttpResponse.json({ ...base, status: 'DONE' })
    }),
    http.get('*/api/appointments/:id/note', () => HttpResponse.json({ editable: true, sectionsOn: false } satisfies Schemas['ChartControllerNoteView'])),
  )
  return sent
}

function renderPanel(a: Appointment, who: Me = me) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><AppointmentPanel appointment={a} me={who} onClose={() => {}} /></QueryClientProvider>)
  return screen.getByRole('complementary', { name: 'Карточка приёма' })
}

afterEach(() => phoneScreen(false))

test('телефон: следующий шаг — внизу закреплённой панелью, в строке статуса не дублируется', async () => {
  phoneScreen(true)
  const sent = backend()
  const panel = renderPanel({ ...base, arrivedAt: new Date().toISOString(), inChairAt: new Date().toISOString() })
  const bar = within(panel).getByRole('toolbar', { name: 'Действия с приёмом' })
  expect(within(panel).getAllByRole('button', { name: 'Приём состоялся' })).toHaveLength(1)
  await userEvent.click(within(bar).getByRole('button', { name: 'Приём состоялся' }))
  await waitForSlow(() => expect(sent).toHaveLength(1))
  expect(sent[0]).toMatchObject({ status: 'DONE' })
})

test('телефон: «⋯» внизу — перенести, задача, лаборатория, показать пациенту; «Перенести» открывает форму', async () => {
  phoneScreen(true)
  backend()
  const panel = renderPanel(currentVisit(), meArrivals)
  const bar = within(panel).getByRole('toolbar', { name: 'Действия с приёмом' })
  expect(within(bar).getByRole('button', { name: 'Пришёл' })).toBeInTheDocument()
  // Кнопки «Перенести» внизу ленты на телефоне нет — она в «⋯»
  expect(within(panel).queryByRole('button', { name: /^Перенести/ })).not.toBeInTheDocument()
  await userEvent.click(within(bar).getByRole('button', { name: 'Ещё действия' }))
  expect(screen.getAllByRole('menuitem').map((i) => i.querySelector('.menu-label')?.textContent)).toEqual(
    expect.arrayContaining(['Перенести или передать врачу', 'Новая задача', 'Заказ в лабораторию', 'Показать пациенту']))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Перенести или передать врачу' }))
  expect(panel.querySelector('.appt-move')).not.toBeNull()
})

test('телефон, приход не отмечают (по умолчанию): внизу «Приём состоялся», рядом ссылка «🚷 Неявка» и «⋯»', async () => {
  phoneScreen(true)
  backend()
  const panel = renderPanel(currentVisit())
  const bar = within(panel).getByRole('toolbar', { name: 'Действия с приёмом' })
  expect(within(bar).getByRole('button', { name: 'Приём состоялся' })).toHaveClass('primary')
  expect(within(bar).getByRole('button', { name: '🚷 Неявка' })).toHaveClass('link')
  expect(within(bar).getByRole('button', { name: 'Ещё действия' })).toBeInTheDocument()
  expect(within(panel).queryByRole('button', { name: 'Пришёл' })).not.toBeInTheDocument()
  expect(panel.querySelectorAll('.btn.primary')).toHaveLength(1)
})

test('телефон: после приёма без оплаты — «Принять оплату» внизу открывает форму оплаты; кнопка на экране одна', async () => {
  phoneScreen(true)
  backend()
  const scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll
  const panel = renderPanel({ ...base, status: 'DONE' })
  const bar = within(panel).getByRole('toolbar', { name: 'Действия с приёмом' })
  // Блок оплаты в ленте — сводка «Оплата не отмечена» без второй кнопки; редкое — ссылками
  expect(within(panel).getAllByRole('button', { name: /^Принять оплату/ })).toHaveLength(1)
  expect(within(panel.querySelector<HTMLElement>('.appt-pay')!).getByRole('button', { name: 'Бесплатно' })).toHaveClass('link')
  await userEvent.click(within(bar).getByRole('button', { name: 'Принять оплату' }))
  await waitForSlow(() => expect(scroll.mock.contexts).toContain(panel.querySelector('.appt-pay')))
  // Открылась форма: действие теперь — её «Сохранить оплату», нижней «Принять оплату» больше нет
  const form = await within(panel).findByRole('form', { name: 'Оплата' })
  expect(within(form).getByRole('button', { name: /^Сохранить оплату/ })).toBeInTheDocument()
  expect(within(panel).queryAllByRole('button', { name: /^Принять оплату/ })).toHaveLength(0)
})

test('компьютер: после приёма без оплаты — одна залитая «Принять оплату» в блоке оплаты, «Бесплатно» и «Оплачено заранее» — ссылками ниже', () => {
  backend()
  const panel = renderPanel({ ...base, status: 'DONE' })
  const pay = within(panel).getAllByRole('button', { name: /^Принять оплату/ })
  expect(pay).toHaveLength(1)
  expect(pay[0]).toHaveClass('primary')
  expect(panel.querySelector('.appt-pay')).toContainElement(pay[0]!)
  expect(before(pay[0]!, within(panel).getByRole('button', { name: 'Оплачено заранее' }))).toBe(true)
  // «Записать на следующий визит» — не главная, пока не оплачено; залитая на экране одна
  expect(panel.querySelectorAll('.btn.primary')).toHaveLength(1)
})

test('компьютер: панели внизу нет, следующий шаг — рядом со статусом, «Перенести» — внизу ленты', () => {
  backend()
  const panel = renderPanel(currentVisit(), meArrivals)
  expect(within(panel).queryByRole('toolbar', { name: 'Действия с приёмом' })).not.toBeInTheDocument()
  expect(within(panel).getByRole('button', { name: 'Пришёл' })).toBeInTheDocument()
  expect(within(panel).getByRole('button', { name: 'Перенести или передать врачу' })).toBeInTheDocument()
})

/** a раньше b в карточке */
const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

test('врач своего приёма в кресле: «Приём» сразу под статусом, запись и связь — ниже в «О записи»', async () => {
  backend()
  const panel = renderPanel({ ...base, arrivedAt: new Date().toISOString(), inChairAt: new Date().toISOString(), comment: 'Боится уколов' })
  const visit = within(panel).getByRole('region', { name: 'Приём' })
  const about = within(panel).getByRole('region', { name: 'О записи' })
  expect(before(visit, about)).toBe(true)
  expect(before(within(panel).getByRole('region', { name: 'Пациент' }), visit)).toBe(true)
  // Комментарий записи — у пациента, на виду; услуга — подписью свёрнутой «О записи», «＋ Задача» — внутри
  expect(within(within(panel).getByRole('region', { name: 'Пациент' })).getByText('Боится уколов')).toBeInTheDocument()
  expect(about).toHaveTextContent('Лечение кариеса')
  await userEvent.click(within(about).getByRole('button', { name: /О записи/ }))
  expect(within(about).queryByText('Боится уколов')).not.toBeInTheDocument()
  expect(within(about).getByRole('button', { name: '＋ Задача' })).toBeInTheDocument()
})

test('ассистент этого врача — тот же порядок; регистратура — как раньше: услуга и связь сверху', () => {
  backend()
  const seated = { ...base, arrivedAt: new Date().toISOString(), inChairAt: new Date().toISOString() }
  renderPanel(seated, assistant)
  let panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  expect(within(panel).getByRole('region', { name: 'О записи' })).toBeInTheDocument()
  panel.parentElement?.remove()
  document.body.innerHTML = ''
  panel = renderPanel(seated, reception)
  expect(within(panel).queryByRole('region', { name: 'О записи' })).not.toBeInTheDocument()
  expect(within(panel).getByText('Лечение кариеса')).toBeInTheDocument()
  expect(within(panel).getByRole('button', { name: '＋ Задача' })).toBeInTheDocument()
})

test('врач — до прихода пациента порядок обычный (утром карточка как у регистратуры)', () => {
  backend()
  const panel = renderPanel(base)
  expect(within(panel).queryByRole('region', { name: 'О записи' })).not.toBeInTheDocument()
})
