import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { server } from '../test/server'
import { ClinicSite } from './ClinicSite'
import { Directory } from './Directory'
import type { ClinicPage, DirectoryClinic, SiteProblem, WebBooked, WebBookingInfo } from './web'

/** Пациенты и клиника — вымышленные. */
const PAGE: ClinicPage = {
  name: 'Улыбка', address: 'Бишкек, Шевченко 6', phones: ['996555000111'], telegramUrl: 'https://t.me/tish_bot?start=c_abc123',
  doctors: [{ fullName: 'Айгерим Садыкова' }, { fullName: 'Бакыт Маматов' }], services: [], bookingUrl: '/c/abc123#book',
}

const INFO: WebBookingInfo = {
  clinicName: 'Улыбка', legalName: 'ИП Садыкова', address: 'Бишкек, Шевченко 6', phones: ['996555000111'], available: true, daysAhead: 30,
  doctors: [{ id: 1, fullName: 'Айгерим Садыкова', about: 'терапевт' }, { id: 2, fullName: 'Бакыт Маматов' }],
  services: [{ id: 5, name: 'Осмотр и консультация', durationMinutes: 30, priceSom: 500 }, { id: 6, name: 'Чистка', durationMinutes: 60 }],
  doctorServices: [{ doctorId: 2, serviceTypeIds: [5] }],
  sources: [{ id: 11, emoji: '📱', title: 'Instagram', titleKy: 'Instagram' }],
  telegramUrl: 'https://t.me/tish_bot?start=c_abc123',
}

/** На любой день: 10:00 свободно, 10:30 занято (Бишкек — UTC+6). */
function slotsOf(url: string): Schemas['BookingViewsSlots'] {
  const date = new URL(url).searchParams.get('date')!
  return { workingDay: true, starts: [`${date}T04:00:00Z`], taken: [`${date}T04:30:00Z`], breaks: [] }
}

function backend(post: (body: Record<string, unknown>, url: string) => Response | Promise<Response>, info: WebBookingInfo = INFO) {
  server.use(
    http.get('*/web/clinic', () => HttpResponse.json(PAGE)),
    http.get('*/web/booking', () => HttpResponse.json(info)),
    http.get('*/web/booking/slots', ({ request }) => HttpResponse.json(slotsOf(request.url))),
    http.post('*/web/booking', async ({ request }) => post(await request.json() as Record<string, unknown>, request.url)),
  )
}

/** Врач → услуга → время → имя, телефон, согласие. */
async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  render(<ClinicSite />)
  await user.click(await screen.findByRole('button', { name: /Записаться на сайте — без Telegram/ }))
  expect(window.location.hash).toBe('#book')
  await user.click(await screen.findByRole('button', { name: /Бакыт Маматов/ }))
  // У врача одна услуга — выбрана сама; первый день со свободным временем — сам
  expect(screen.getByRole('button', { name: /Осмотр и консультация/ })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('button', { name: /Чистка/ })).toBeNull()
  await user.click(await screen.findByRole('button', { name: '10:00' }))
  expect(screen.getByRole('button', { name: /10:30 — занято/ })).toBeDisabled()
  await user.type(screen.getByRole('textbox', { name: 'Имя пациента' }), 'Айгуль Тестова')
  await user.type(screen.getByRole('textbox', { name: 'Телефон' }), '700 112 233')
}

afterEach(() => {
  window.history.replaceState(null, '', '/')
  localStorage.clear()
})

test('запись на сайте: врач, услуга, время, данные — заявка уходит, экран «Заявка отправлена» и подсказка про Telegram', async () => {
  window.history.replaceState(null, '', '/c/abc123')
  let sent: Record<string, unknown> = {}
  let query = ''
  backend((body, url) => {
    sent = body
    query = new URL(url).search
    return HttpResponse.json({
      startAt: body.startAt as string, endAt: body.startAt as string, doctorName: 'Бакыт Маматов', serviceName: 'Осмотр и консультация',
      clinicName: 'Улыбка', address: 'Бишкек, Шевченко 6', phones: ['996555000111'], telegramUrl: 'https://t.me/tish_bot?start=c_abc123',
    } satisfies WebBooked, { status: 201 })
  })
  const user = userEvent.setup()
  await fillForm(user)
  // Необязательное свёрнуто — раскрыть «Откуда вы о нас узнали?»
  await user.click(screen.getByRole('button', { name: '＋ Откуда вы о нас узнали?' }))
  await user.click(screen.getByRole('button', { name: /Instagram/ }))
  // Без согласия — не отправляем
  await user.click(screen.getByRole('button', { name: 'Записаться' }))
  expect(screen.getByText('Нужно согласие на обработку данных')).toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: /ИП Садыкова/ }))
  await user.click(screen.getByRole('button', { name: 'Записаться' }))

  const done = await screen.findByRole('region', { name: 'Заявка отправлена' })
  expect(query).toBe('?code=abc123')
  expect(sent).toMatchObject({ doctorId: 2, serviceTypeId: 5, fullName: 'Айгуль Тестова', phone: '+996 700 112 233', consent: true, sourceId: 11, website: '' })
  expect(String(sent.startAt)).toMatch(/T04:00:00\.000Z$/)
  expect(within(done).getByText(/Клиника позвонит вам/)).toBeInTheDocument()
  expect(within(done).getByText('Бакыт Маматов')).toBeInTheDocument()
  expect(within(done).getByText(/в 10:00/)).toBeInTheDocument()
  expect(within(done).getByRole('link', { name: /Позвонить \+996 555 000 111/ })).toHaveAttribute('href', 'tel:+996555000111')
  expect(within(done).getByRole('link', { name: 'Записаться в Telegram' })).toHaveAttribute('href', 'https://t.me/tish_bot?start=c_abc123')
})

test('ошибки сервера: 422 — под полями, 409 «номер уже записан» — с телефоном клиники, 409 «время заняли» — выбрать заново', async () => {
  window.history.replaceState(null, '', '/c/abc123')
  const answers: [number, SiteProblem][] = [
    [422, { errors: [{ field: 'phone', message: 'Номер в формате 0555 123 456' }, { field: 'consent', message: 'Нужно согласие' }] }],
    [409, { code: 'phone-booked', detail: 'На этот номер уже есть запись' }],
    [409, { code: 'time-taken', detail: 'Время занято' }],
  ]
  backend(() => {
    const [status, problem] = answers.shift()!
    return HttpResponse.json(problem, { status })
  })
  const user = userEvent.setup()
  await fillForm(user)
  await user.click(screen.getByRole('checkbox'))

  await user.click(screen.getByRole('button', { name: 'Записаться' }))
  expect(await screen.findByText('Номер в формате 0555 123 456')).toBeInTheDocument()
  expect(screen.getByText('Нужно согласие')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Записаться' }))
  expect(await screen.findByText(/На этот номер уже есть запись в клинике.*позвоните: \+996555000111/)).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Записаться' }))
  expect(await screen.findByText('Это время уже заняли — выберите другое')).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: '10:00' })).toHaveAttribute('aria-pressed', 'false')
})

test('форма закрывается — снова страница клиники; клиника настраивается — записи нет, только «позвоните»', async () => {
  window.history.replaceState(null, '', '/c/abc123#book')
  backend(() => HttpResponse.json({}), { ...INFO, available: false, unavailable: 'setting-up', doctors: [], services: [] })
  const user = userEvent.setup()
  render(<ClinicSite />)
  expect(await screen.findByText(/Клиника ещё настраивается.*Позвоните в клинику: \+996555000111/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Записаться' })).toBeNull()
  await user.click(screen.getByRole('button', { name: '‹ К странице клиники' }))
  expect(await screen.findByRole('link', { name: /Записаться онлайн в Telegram/ })).toBeInTheDocument()
  expect(window.location.hash).toBe('')
})

test('каталог: рядом с «Записаться в Telegram» — «Без Telegram — записаться на сайте»', async () => {
  server.use(http.get('*/web/clinics', () => HttpResponse.json([
    { name: 'Улыбка', pageUrl: '/c/abc123', telegramUrl: 'https://t.me/tish_bot?start=c_abc123', bookingUrl: '/c/abc123#book', doctors: [] },
    { name: 'Дент', pageUrl: '/c/dent', doctors: [] },
  ] satisfies DirectoryClinic[])))
  render(<Directory />)
  expect(await screen.findByRole('link', { name: /Без Telegram — записаться на сайте/ })).toHaveAttribute('href', '/c/abc123#book')
  expect(screen.getAllByRole('link', { name: /записаться на сайте/ })).toHaveLength(1)
})

test('WhatsApp клиники: в форме «Удобнее в WhatsApp?», после заявки — «Отправить запись в WhatsApp клиники» с готовым текстом без имени и телефона', async () => {
  window.history.replaceState(null, '', '/c/abc123')
  backend((body) => HttpResponse.json({
    startAt: body.startAt as string, endAt: body.startAt as string, doctorName: 'Бакыт Маматов', serviceName: 'Осмотр и консультация',
    clinicName: 'Улыбка', phones: ['996555000111'], whatsapp: '996700000222',
  } satisfies WebBooked, { status: 201 }), { ...INFO, whatsapp: '996700000222' })
  const user = userEvent.setup()
  await fillForm(user)
  expect(screen.getByRole('link', { name: 'Написать клинике' }).getAttribute('href')).toMatch(/^https:\/\/wa\.me\/996700000222\?text=/)
  await user.click(screen.getByRole('checkbox', { name: /ИП Садыкова/ }))
  await user.click(screen.getByRole('button', { name: 'Записаться' }))

  const done = await screen.findByRole('region', { name: 'Заявка отправлена' })
  const wa = within(done).getByRole('link', { name: /Отправить запись в WhatsApp клиники/ })
  const href = wa.getAttribute('href')!
  expect(href).toMatch(/^https:\/\/wa\.me\/996700000222\?text=/)
  const text = decodeURIComponent(href.split('text=')[1]!)
  expect(text).toMatch(/Записался\(-ась\) на сайте: .*в 10:00, врач Бакыт Маматов, Осмотр и консультация/)
  expect(text).not.toMatch(/Айгуль|700/)
})
