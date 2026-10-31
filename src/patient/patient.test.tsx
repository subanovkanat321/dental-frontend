import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { slotInstant, todayIn, addDays } from '../lib/time'
import { renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { bookingDays, breakNote, priceText, whenAt } from './i18n'

type Me = Schemas['BookingViewsMe']

/** Пациент в Telegram: подпись запуска, без MainButton — тогда своя кнопка внизу экрана. */
function fakeTelegram(extra: Record<string, unknown> = {}) {
  window.Telegram = { WebApp: { initData: 'query_id=1&user=%7B%22id%22%3A222%7D&hash=abc', ready() {}, expand() {}, ...extra } }
}

afterEach(() => {
  delete window.Telegram
})

const patient = (extra: Partial<Me> = {}): Me => ({
  doctor: false, platform: false, bookingEnabled: true, lang: 'ru', daysAhead: 14, fullName: 'Айгуль', phone: '996700111222',
  doctors: [{ id: 1, fullName: 'Айгерим Садыкова', about: 'терапевт' }, { id: 2, fullName: 'Дастан Т.' }],
  services: [{ id: 5, name: 'Лечение кариеса', durationMinutes: 60, priceSom: 2500, category: 'Терапия' }],
  clinic: { brandName: 'Стоматология «Тест»', legalName: 'ИП Тест', address: 'Бишкек, Шевченко 6' },
  ...extra,
})

test('даты и тексты на русском и кыргызском', () => {
  const tomorrow10 = slotInstant(addDays(todayIn(), 1), 600)
  expect(whenAt('ru', tomorrow10)).toBe('Завтра, в 10:00')
  expect(whenAt('ky', tomorrow10)).toBe('Эртең, саат 10:00')
  expect(bookingDays('ky', '2026-11-04', 3).map((d) => d.label)).toEqual(['Бүгүн', 'Эртең', 'Жм 6'])
  expect(priceText('ky', 1500)).toMatch(/^1\s500 сомдон$/)
  expect(breakNote('ru', { start: slotInstant('2026-11-06', 780), end: slotInstant('2026-11-06', 900), title: 'Джума-намаз', emoji: '🕌' }))
    .toBe('🕌 С 13:00 до 15:00 — джума-намаз, врач не принимает')
})

test('запись: врач → услуга → первый день со свободным временем → время → согласие → «Ваша запись»', async () => {
  fakeTelegram()
  const today = todayIn()
  const tomorrow = addDays(today, 1)
  let me = patient()
  let booked: Schemas['PatientBookingControllerBook'] | null = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patient/slots', ({ request }) => {
      const date = new URL(request.url).searchParams.get('date')
      // Сегодня мест нет — лента сама встанет на завтра
      return HttpResponse.json(date === tomorrow
        ? { workingDay: true, starts: [slotInstant(tomorrow, 600), slotInstant(tomorrow, 660)], taken: [slotInstant(tomorrow, 630)], breaks: [] }
        : { workingDay: true, starts: [], taken: [], breaks: [] })
    }),
    http.post('*/api/patient/booking', async ({ request }) => {
      booked = await request.json() as Schemas['PatientBookingControllerBook']
      const booking = { id: 9, startAt: booked.startAt, status: 'REQUESTED', doctorId: 1, serviceName: 'Лечение кариеса' } satisfies Schemas['BookingViewsBooking']
      me = { ...me, booking }
      return HttpResponse.json(booking)
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: /Айгерим Садыкова/ }))
  expect(screen.getByText('Айгерим Садыкова', { selector: '.hero-doctor' })).toBeInTheDocument()
  // Услуга одна — уже выбрана; время — завтра
  const grid = await screen.findByRole('group', { name: 'Свободное время' })
  expect(within(grid).getByRole('button', { name: '10:30 — занято' })).toBeDisabled()
  expect(screen.getByRole('group', { name: 'День' }).querySelector('[aria-pressed=true]')).toHaveTextContent('Завтра')

  expect(screen.getByRole('button', { name: 'Далее: выбрать время ↓' })).toBeInTheDocument()
  await user.click(within(grid).getByRole('button', { name: '11:00' }))
  await user.click(screen.getByRole('button', { name: 'Далее: ваши данные ↓' }))
  expect(await screen.findByText('Нужно согласие на обработку данных')).toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: /ИП Тест обрабатывает мои данные/ }))
  await user.click(screen.getByRole('button', { name: 'Записаться' }))

  expect(await screen.findByRole('heading', { name: 'Ваша запись' })).toBeInTheDocument()
  expect(screen.getByText(/Завтра, в 11:00/)).toBeInTheDocument()
  expect(screen.getByText(/Ждёт подтверждения врача/)).toBeInTheDocument()
  expect(booked).toEqual({ doctorId: 1, serviceTypeId: 5, startAt: slotInstant(tomorrow, 660), fullName: 'Айгуль', consent: true, comment: '' })
})

test('«Ваша запись» по-кыргызски: хочу раньше и отмена вторым нажатием', async () => {
  fakeTelegram()
  let me = patient({ lang: 'ky', booking: { id: 9, startAt: slotInstant(addDays(todayIn(), 1), 600), status: 'SCHEDULED', doctorId: 1, serviceName: 'Лечение кариеса' } })
  const calls: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.post('*/api/patient/waitlist', () => { calls.push('waitlist'); return new HttpResponse(null, { status: 204 }) }),
    http.post('*/api/patient/booking/cancel', () => {
      calls.push('cancel')
      me = { ...me, booking: undefined }
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Сиздин жазылууңуз' })).toBeInTheDocument()
  expect(screen.getByText('✅ Ырасталды')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /Эртерээк келгим келет/ }))
  expect(await screen.findByText(/Сиз күтүү тизмесиндесиз/)).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Жазылууну жокко чыгаруу' }))
  expect(calls).toEqual(['waitlist'])
  await user.click(screen.getByRole('button', { name: /Чын эле жокко чыгарасызбы/ }))
  // Записи нет — снова выбор врача
  expect(await screen.findByRole('heading', { name: 'Тиш дарыгерине жазылуу' })).toBeInTheDocument()
  expect(calls).toEqual(['waitlist', 'cancel'])

  await user.click(screen.getByRole('button', { name: 'Русский' }))
  expect(screen.getByRole('heading', { name: 'Запись к стоматологу' })).toBeInTheDocument()
})

test('перенос: занятое время — заново выбрать', async () => {
  fakeTelegram()
  const day = addDays(todayIn(), 2)
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(patient({ booking: { id: 9, startAt: slotInstant(day, 600), status: 'SCHEDULED', doctorId: 1 } }))),
    http.get('*/api/patient/booking/slots', () => HttpResponse.json({ workingDay: true, starts: [slotInstant(day, 720)], taken: [], breaks: [] })),
    http.post('*/api/patient/booking/reschedule', () => HttpResponse.json({ status: 409, code: 'time-taken', detail: 'Время занято' }, { status: 409 })),
  )
  window.history.replaceState(null, '', '/?screen=reschedule')
  const user = userEvent.setup()
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Перенести запись' })).toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: '12:00' }))
  await user.click(screen.getByRole('button', { name: 'Перенести' }))
  expect(await screen.findByText('Это время уже заняли — выберите другое')).toBeInTheDocument()
  window.history.replaceState(null, '', '/')
})

test('клиник несколько — сначала выбрать клинику', async () => {
  fakeTelegram()
  let chosen: unknown = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(patient({ clinicChoices: [{ id: 3, name: 'Улыбка', address: 'Ош' }] }))),
    http.put('*/api/patient/clinic', async ({ request }) => {
      chosen = await request.json()
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: /Улыбка/ }))
  await vi.waitFor(() => expect(chosen).toEqual({ clinicId: 3 }))
})

test('вне Telegram пациенту — подсказка про бота, без экранов записи', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(patient())))
  renderApp()
  expect(await screen.findByText(/Пациенты записываются через бота в Telegram/)).toBeInTheDocument()
})
