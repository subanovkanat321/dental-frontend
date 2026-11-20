import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, todayIn } from '../lib/time'
import { appointment, me, statusMenu } from '../test/fixtures'
import { server } from '../test/server'
import { AppointmentPanel } from './AppointmentPanel'

/**
 * UX-аудит 2026-11-20, раздел 1: «одна кнопка» (главное действие каждого состояния внизу на телефоне и одна залитая
 * на экране), «по моменту» (ответ пациента — до прихода, «О записи» — после визита, без «Ещё» у пришедшего, без
 * «Материалов» у регистратуры, долг — регистратуре) и пациент над статусом. Пациенты вымышленные.
 */
type Appointment = Schemas['AppointmentView']
type Me = Schemas['BookingViewsMe']

const reception: Me = { ...me, admin: false, doctor: true, reception: true, doctorId: undefined }
const now = () => new Date().toISOString()
const base = appointment(30, 1, '00:05', 'Бакыт Тестов', { version: 1, serviceName: 'Лечение кариеса' })
// Запись на завтра, то же время
const tomorrow = (): Appointment => {
  const start = new Date(Date.now() + 26 * 3_600_000)
  return { ...base, startAt: start.toISOString(), endAt: new Date(start.getTime() + 30 * 60_000).toISOString() }
}

function phoneScreen(on: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true, writable: true,
    value: on ? (q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) : undefined,
  })
}

function backend(debts: Schemas['PaymentQueryDebt'][] = []) {
  const asked: string[] = []
  server.use(
    http.get('*/api/appointments/:id/note', () => HttpResponse.json({ editable: true, sectionsOn: false } satisfies Schemas['ChartControllerNoteView'])),
    http.get('*/api/appointments/debts', ({ request }) => {
      asked.push(new URL(request.url).search)
      return HttpResponse.json(debts)
    }),
  )
  return asked
}

function renderPanel(a: Appointment, who: Me = me, onBook = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><AppointmentPanel appointment={a} me={who} onClose={() => {}} onBook={onBook} /></QueryClientProvider>)
  return { panel: screen.getByRole('complementary', { name: 'Карточка приёма' }), onBook }
}

const bar = (panel: HTMLElement) => within(panel).getByRole('toolbar', { name: 'Действия с приёмом' })
const main = (panel: HTMLElement) => bar(panel).querySelector('.appt-bar-main')?.textContent ?? null
/** a раньше b в карточке */
const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

afterEach(() => phoneScreen(false))

describe('телефон: внизу — главное действие каждого состояния', () => {
  beforeEach(() => phoneScreen(true))

  test('запись на завтра, не напоминали — «Напомнить в WhatsApp» (без бота); с ботом — в Telegram', () => {
    backend()
    expect(main(renderPanel(tomorrow(), reception).panel)).toBe('Напомнить в WhatsApp')
    cleanup()
    const bot = tomorrow()
    expect(main(renderPanel({ ...bot, patient: { ...bot.patient, telegram: true } }, reception).panel)).toBe('Напомнить в Telegram')
  })

  test('напомнили, ответа нет — «Подтвердил»; подтвердил — главной нет, только «⋯»', () => {
    backend()
    expect(main(renderPanel({ ...tomorrow(), reminderOpenedAt: now() }, reception).panel)).toBe('Подтвердил')
    cleanup()
    const { panel } = renderPanel({ ...tomorrow(), reminderOpenedAt: now(), reply: 'CONFIRMED' }, reception)
    expect(main(panel)).toBeNull()
    expect(within(bar(panel)).getByRole('button', { name: 'Ещё действия' })).toBeInTheDocument()
  })

  test('оплачен — «Записать на следующий визит» внизу, в ленте её нет; открывает запись через неделю', async () => {
    backend()
    const { panel, onBook } = renderPanel({ ...base, status: 'DONE', paidSom: 6000, chargeSom: 6000, paymentMethod: 'CASH' }, reception)
    expect(main(panel)).toBe('Записать на следующий визит')
    expect(within(panel).getAllByRole('button', { name: 'Записать на следующий визит' })).toHaveLength(1)
    await userEvent.click(within(bar(panel)).getByRole('button', { name: 'Записать на следующий визит' }))
    expect(onBook).toHaveBeenCalledWith(expect.objectContaining({ date: addDays(todayIn(), 7) }), base.patient)
  })

  test('долг — «Принять доплату» внизу (открывает форму), «Записать на следующий визит» — обычной кнопкой; залитая одна', async () => {
    backend()
    const { panel } = renderPanel({ ...base, status: 'DONE', paidSom: 2000, chargeSom: 6000, debtSom: 4000, paymentMethod: 'CASH' }, reception)
    expect(main(panel)).toBe('Принять доплату')
    expect(within(panel).getAllByRole('button', { name: 'Принять доплату' })).toHaveLength(1)
    const next = within(panel).getByRole('button', { name: 'Записать на следующий визит' })
    expect(next).not.toHaveClass('primary')
    expect(panel.querySelectorAll('.btn.primary')).toHaveLength(1)
    Element.prototype.scrollIntoView = vi.fn()
    await userEvent.click(within(bar(panel)).getByRole('button', { name: 'Принять доплату' }))
    expect(await within(panel).findByRole('button', { name: 'Сохранить доплату' })).toBeInTheDocument()
  })

  test('неявка — «Записать снова»; отмена (перенёс) — тоже, причина одной строкой без «Отменён»', async () => {
    backend()
    expect(main(renderPanel({ ...base, status: 'NO_SHOW', cancelReason: 'ILL' }, reception).panel)).toBe('Записать снова')
    cleanup()
    const { panel, onBook } = renderPanel({ ...base, status: 'CANCELLED', cancelReason: 'OTHER_TIME', cancelledBy: 'пациент в боте' }, reception)
    expect(main(panel)).toBe('Записать снова')
    expect(within(panel).getByText('Перенёс на другое время · отменил(а) пациент в боте')).toBeInTheDocument()
    await userEvent.click(within(bar(panel)).getByRole('button', { name: 'Записать снова' }))
    expect(onBook).toHaveBeenCalled()
  })

  test('в кресле: регистратуре главной нет (ждёт врача), «Перенести» в «⋯» нет; врачу — «Приём состоялся»', async () => {
    backend()
    const seated = { ...base, arrivedAt: now(), inChairAt: now(), startAt: new Date(Date.now() - 5 * 60_000).toISOString(), endAt: new Date(Date.now() + 25 * 60_000).toISOString() }
    const { panel } = renderPanel(seated, reception)
    expect(main(panel)).toBeNull()
    await userEvent.click(within(bar(panel)).getByRole('button', { name: 'Ещё действия' }))
    expect(screen.queryByRole('menuitem', { name: /Перенести/ })).not.toBeInTheDocument()
    cleanup()
    expect(main(renderPanel(seated).panel)).toBe('Приём состоялся')
  })
})

describe('компьютер', () => {
  test('«Записать снова» и «Напомнить» — рядом с пилюлей статуса, одна залитая кнопка', () => {
    backend()
    const { panel } = renderPanel({ ...base, status: 'NO_SHOW' }, reception)
    const row = panel.querySelector<HTMLElement>('.appt-status-row')!
    expect(within(row).getByRole('button', { name: 'Записать снова' })).toHaveClass('primary')
    expect(panel.querySelectorAll('.btn.primary')).toHaveLength(1)
    cleanup()
    const next = renderPanel(tomorrow(), reception).panel
    expect(within(next.querySelector<HTMLElement>('.appt-status-row')!).getByRole('button', { name: 'Напомнить в WhatsApp' })).toBeInTheDocument()
  })

  test('оплачен — «Записать на следующий визит» залитой в ленте, у пилюли пусто', () => {
    backend()
    const { panel } = renderPanel({ ...base, status: 'DONE', paidSom: 6000, chargeSom: 6000, paymentMethod: 'CASH' }, reception)
    const next = within(panel).getByRole('button', { name: 'Записать на следующий визит' })
    expect(next).toHaveClass('primary')
    expect(panel.querySelector('.appt-status-row')).not.toContainElement(next)
    expect(panel.querySelectorAll('.btn.primary')).toHaveLength(1)
  })

  test('пациент — над статусом: имя, номер, история; пилюля статуса ниже', () => {
    backend()
    const { panel } = renderPanel(base, reception)
    const patient = within(panel).getByRole('region', { name: 'Пациент' })
    expect(before(patient, within(panel).getByRole('button', { name: /^Статус/ }))).toBe(true)
    expect(within(patient).getByText('Бакыт Тестов')).toBeInTheDocument()
  })
})

describe('по моменту', () => {
  test('регистратура видит долг пациента в карточке записи (запрос по пациенту) и подсказку у оплаты', async () => {
    const asked = backend([{ appointmentId: 7, patientId: 30, doctorId: 1, chargeSom: 6000, paidSom: 2000, debtSom: 4000 }])
    const { panel } = renderPanel(base, reception)
    expect(await within(panel).findByText('Долг 4 000 сом')).toBeInTheDocument()
    expect(asked).toContain('?patientId=30')
    cleanup()
    const done = renderPanel({ ...base, status: 'DONE' }, reception).panel
    expect(await within(done).findByText(/У пациента долг 4 000 сом за прошлые визиты/)).toBeInTheDocument()
  })

  test('ответ пациента — в списке статуса (отдельного ряда «Подтвердил / Перенос / Нет ответа» нет), до прихода; пришёл — нет, и «＋ Предоплата» нет', async () => {
    backend()
    const { panel } = renderPanel(tomorrow(), reception)
    expect(within(panel).queryByRole('group', { name: 'Ответ пациента' })).not.toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: '＋ Предоплата' })).toBeInTheDocument()
    await userEvent.click(statusMenu(panel)!)
    const items = screen.getAllByRole('menuitemradio').map((i) => i.querySelector('.menu-text')?.firstChild?.textContent)
    expect(items).toEqual(['Записан', 'Подтвердил (придёт)', 'Просит перенести', 'Нет ответа', 'Приём состоялся', 'Неявка', 'Отменён'])
    cleanup()
    const arrived = renderPanel({ ...base, arrivedAt: now() }, reception).panel
    expect(within(arrived).queryByRole('button', { name: '＋ Предоплата' })).not.toBeInTheDocument()
    await userEvent.click(statusMenu(arrived)!)
    expect(screen.queryByRole('menuitemradio', { name: /^Просит перенести/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitemradio', { name: /^Нет ответа/ })).not.toBeInTheDocument()
  })

  test('после визита промокод и «откуда узнал» — в свёрнутом «О записи»; до визита — строками', async () => {
    backend()
    const { panel } = renderPanel({ ...base, status: 'DONE', paidSom: 6000, chargeSom: 6000 }, reception)
    const about = within(panel).getByRole('region', { name: 'О записи' })
    expect(within(panel).getByText('Лечение кариеса')).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: '＋ Промокод' })).not.toBeInTheDocument()
    await userEvent.click(within(about).getByRole('button', { name: /О записи/ }))
    expect(within(about).getByRole('button', { name: '＋ Промокод' })).toBeInTheDocument()
    cleanup()
    const ahead = renderPanel(tomorrow(), reception).panel
    expect(within(ahead).queryByRole('region', { name: 'О записи' })).not.toBeInTheDocument()
    expect(within(ahead).getByRole('button', { name: '＋ Промокод' })).toBeInTheDocument()
  })

  test('«Материалы» и «＋ В лабораторию» регистратуре не показываем; врачу — есть', () => {
    backend()
    const { panel } = renderPanel({ ...base, status: 'DONE', paidSom: 6000, chargeSom: 6000 }, reception)
    expect(within(panel).queryByRole('region', { name: 'Материалы на приёме' })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: '＋ В лабораторию' })).not.toBeInTheDocument()
    cleanup()
    const doctor = renderPanel({ ...base, status: 'DONE', paidSom: 6000, chargeSom: 6000 }).panel
    expect(within(doctor).getByRole('region', { name: 'Материалы на приёме' })).toBeInTheDocument()
  })

  test('шапка коротко: «пт, 20 нояб · врач Айгерим С.» — врач приёма с подписью, без фамилии целиком', () => {
    backend()
    const { panel } = renderPanel(base, reception)
    const day = panel.querySelector('.appt-day')!
    expect(day.textContent).toMatch(/^[а-я]{2}, \d{1,2} [а-я]+ · врач Айгерим С\.$/)
  })
})
