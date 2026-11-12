import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { slotInstant, todayIn, addDays } from '../lib/time'
import { renderApp } from '../test/fixtures'
import { pickDate } from '../test/date'
import { server } from '../test/server'
import { pickSlot } from '../test/wizard'
import { waitForSlow } from '../test/wait'

/**
 * Мама записывает детей из своего Telegram: «Кого записываем?», новый ребёнок, «Мои записи» с
 * именами. Люди вымышленные.
 */
type Me = Schemas['BookingViewsMe']
type Booking = Schemas['BookingViewsBooking']
type Book = Schemas['PatientBookingControllerBook']

function fakeTelegram() {
  window.Telegram = { WebApp: { initData: 'query_id=1&user=%7B%22id%22%3A222%7D&hash=abc', ready() {}, expand() {} } }
}

afterEach(() => {
  delete window.Telegram
})

const tomorrow = addDays(todayIn(), 1)

const own: Booking = { id: 9, startAt: slotInstant(tomorrow, 600), status: 'SCHEDULED', doctorId: 1, doctorName: 'Айгерим Садыкова',
  serviceName: 'Лечение кариеса', patientId: 40, patientName: 'Жылдыз Асанова', self: true, waiting: false }

const childBooking: Booking = { id: 12, startAt: slotInstant(addDays(todayIn(), 2), 660), status: 'REQUESTED', doctorId: 1,
  doctorName: 'Айгерим Садыкова', serviceName: 'Осмотр', patientId: 41, patientName: 'Аружан Асанова', self: false, waiting: false }

const mom = (extra: Partial<Me> = {}): Me => ({
  doctor: false, platform: false, bookingEnabled: true, lang: 'ru', daysAhead: 14, fullName: 'Жылдыз Асанова', phone: '996700112233',
  doctors: [{ id: 1, fullName: 'Айгерим Садыкова', active: true, telegramLinked: false }],
  services: [{ id: 5, name: 'Осмотр', durationMinutes: 30, active: true }],
  clinic: { brandName: 'Стоматология «Тест»', legalName: 'ИП Тест', independentDoctors: false, listed: true, separateSupplies: false, settingUp: false, ownHours: false, recallMonths: 6 },
  hasCard: true, maxRelatives: 6, relatives: [{ id: 41, fullName: 'Аружан Асанова', relation: 'CHILD' }],
  admin: false, reception: false, owner: false, canChangeClinic: false, waiting: false, hasReception: false,
  ...extra,
})

/** Сервер записи: свободно 10:00 и 11:00 завтра; запоминает тело записи. */
function bookingServer(me: () => Me, onBook: (body: Book) => Booking) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me())),
    http.get('*/api/patient/free-days', () => HttpResponse.json([tomorrow])),
    http.get('*/api/patient/slots', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('date') === tomorrow
      ? { workingDay: true, starts: [slotInstant(tomorrow, 600), slotInstant(tomorrow, 660)], taken: [], breaks: [] }
      : { workingDay: true, starts: [], taken: [], breaks: [] })),
    http.post('*/api/patient/booking', async ({ request }) => HttpResponse.json(onBook(await request.json() as Book), { status: 201 })),
  )
}

test('у мамы своя запись: «Записать ещё» → «Кого записываем?» → новый ребёнок с датой рождения', async () => {
  fakeTelegram()
  let me = mom({ booking: own, bookings: [own] })
  let booked: Book | null = null
  bookingServer(() => me, (body) => {
    booked = body
    const b: Booking = { ...childBooking, id: 13, startAt: body.startAt, patientId: 42, patientName: 'Бекзат Асанов' }
    me = { ...me, bookings: [own, b] }
    return b
  })
  const user = userEvent.setup()
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Ваша запись' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '＋ Записать ещё — себя или ребёнка' }))

  await pickSlot(user, tomorrow, '11:00')
  const who = screen.getByRole('group', { name: 'Кого записываем?' })
  // У себя запись уже есть — «Себя» не выбрать; по умолчанию — ребёнок из семьи
  expect(within(who).getByRole('button', { name: /Себя.*уже записан/ })).toBeDisabled()
  expect(within(who).getByRole('button', { name: 'Аружан Асанова' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('checkbox', { name: /Я законный представитель: Аружан Асанова/ })).toBeInTheDocument()

  await user.click(within(who).getByRole('button', { name: '＋ Ребёнка или родственника' }))
  // Своя карточка есть — своё имя не спрашиваем, телефон — «Ваш телефон»
  expect(screen.queryByRole('textbox', { name: 'Ваше имя' })).toBeNull()
  expect(screen.getByText('Ваш телефон')).toBeInTheDocument()
  // Без имени ребёнка — подсказка под полем
  await user.click(screen.getByRole('button', { name: 'Записаться' }))
  expect(await screen.findByText('Укажите имя родственника')).toBeInTheDocument()

  await user.type(screen.getByRole('textbox', { name: 'Имя и фамилия' }), 'Бекзат Асанов')
  expect(within(screen.getByRole('group', { name: 'Кем приходится вам' })).getByRole('button', { name: 'Ребёнок' }))
    .toHaveAttribute('aria-pressed', 'true')
  await pickDate(screen.getByLabelText('Дата рождения (необязательно)'), '2020-03-15')
  await user.click(screen.getByRole('checkbox', { name: /Я законный представитель: Бекзат Асанов/ }))
  await user.click(screen.getByRole('button', { name: 'Записаться' }))

  expect(await screen.findByRole('heading', { name: 'Запись: Бекзат Асанов' })).toBeInTheDocument()
  expect(booked).toEqual({ doctorId: 1, serviceTypeId: 5, startAt: slotInstant(tomorrow, 660), fullName: 'Жылдыз Асанова', consent: true,
    comment: '', relative: { fullName: 'Бекзат Асанов', birthDate: '2020-03-15', relation: 'CHILD' } })
  // Назад — ко всем записям: теперь их две
  await user.click(screen.getByRole('button', { name: '‹ Все записи' }))
  expect(await screen.findByRole('heading', { name: 'Мои записи' })).toBeInTheDocument()
})

test('первая запись — сразу ребёнка: спрашиваем и своё имя', async () => {
  fakeTelegram()
  let booked: Book | null = null
  bookingServer(() => mom({ hasCard: false, relatives: [], fullName: 'Жылдыз' }), (body) => {
    booked = body
    return { ...childBooking, startAt: body.startAt }
  })
  const user = userEvent.setup()
  renderApp()
  await pickSlot(user, tomorrow, '10:00')
  const who = screen.getByRole('group', { name: 'Кого записываем?' })
  expect(within(who).getByRole('button', { name: 'Себя' })).toHaveAttribute('aria-pressed', 'true')
  await user.click(within(who).getByRole('button', { name: '＋ Ребёнка или родственника' }))
  // Имя из Telegram известно — строкой; поправить — «Изменить»
  expect(screen.queryByRole('textbox', { name: 'Ваше имя' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Изменить имя' }))
  const ownName = screen.getByRole('textbox', { name: 'Ваше имя' })
  await user.clear(ownName)
  await user.type(ownName, 'Жылдыз Асанова')
  await user.type(screen.getByRole('textbox', { name: 'Имя и фамилия' }), 'Аружан')
  await user.click(within(screen.getByRole('group', { name: 'Кем приходится вам' })).getByRole('button', { name: 'Брат или сестра' }))
  await user.type(screen.getByRole('textbox', { name: /Его телефон/ }), '0700 11 22 33')
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: 'Записаться' }))
  await waitForSlow(() => expect(booked).not.toBeNull())
  expect(booked!.fullName).toBe('Жылдыз Асанова')
  expect(booked!.relative).toEqual({ fullName: 'Аружан', relation: 'SIBLING', phone: '0700 11 22 33' })
})

test('по-кыргызски: «Кимди жаздырабыз?» — бала тизмеден', async () => {
  fakeTelegram()
  let booked: Book | null = null
  bookingServer(() => mom({ lang: 'ky' }), (body) => {
    booked = body
    return { ...childBooking, startAt: body.startAt }
  })
  const user = userEvent.setup()
  renderApp()
  await pickSlot(user, tomorrow, '10:00', 'ky')
  const who = screen.getByRole('group', { name: 'Кимди жаздырабыз?' })
  expect(within(who).getByRole('button', { name: 'Өзүмдү' })).toHaveAttribute('aria-pressed', 'true')
  await user.click(within(who).getByRole('button', { name: 'Аружан Асанова' }))
  // Своё имя для ребёнка из списка не нужно
  expect(screen.queryAllByRole('textbox')).toHaveLength(0) // ни имени, ни комментария (он свёрнут)
  await user.click(screen.getByRole('checkbox', { name: /Мен мыйзамдуу өкүлмүн: Аружан Асанова/ }))
  await user.click(screen.getByRole('button', { name: 'Жазылуу' }))
  await waitForSlow(() => expect(booked).not.toBeNull())
  expect(booked!.patientId).toBe(41)
  expect(booked!).not.toHaveProperty('relative')
})

test('«Мои записи» по-русски и по-кыргызски: чьи записи; отменить запись ребёнка — по её id', async () => {
  fakeTelegram()
  let me = mom({ lang: 'ky', booking: own, bookings: [own, childBooking] })
  const cancelled: (string | null)[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.post('*/api/patient/booking/cancel', ({ request }) => {
      cancelled.push(new URL(request.url).searchParams.get('appointmentId'))
      me = { ...me, bookings: [own] }
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Менин жазылууларым' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Сиз/ })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /Аружан Асанова/ }))
  expect(await screen.findByRole('heading', { name: 'Жазылуу: Аружан Асанова' })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Русский' }))
  expect(screen.getByRole('heading', { name: 'Запись: Аружан Асанова' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Отменить запись' }))
  await user.click(screen.getByRole('button', { name: /Точно отменить/ }))
  expect(await screen.findByRole('heading', { name: 'Ваша запись' })).toBeInTheDocument()
  expect(cancelled).toEqual(['12'])
})
