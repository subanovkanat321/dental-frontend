import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, slotInstant, todayIn } from '../lib/time'
import { renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { pickSlot, stepText } from '../test/wizard'
import { dayLong } from './i18n'

/**
 * Пошаговая запись в Telegram: шаги и «Назад», «Любой свободный врач», «Изменить» в итоге,
 * «время заняли» (409), поиск услуг. Клиника, врачи и пациенты — вымышленные.
 */
type Me = Schemas['BookingViewsMe']
type Book = Schemas['PatientBookingControllerBook']

function fakeTelegram(extra: Record<string, unknown> = {}) {
  window.Telegram = { WebApp: { initData: 'query_id=1&user=%7B%22id%22%3A222%7D&hash=abc', ready() {}, expand() {}, ...extra } }
}

afterEach(() => {
  delete window.Telegram
})

const tomorrow = addDays(todayIn(), 1)
const later = addDays(todayIn(), 4)

const me = (extra: Partial<Me> = {}): Me => ({
  doctor: false, platform: false, bookingEnabled: true, lang: 'ru', daysAhead: 14, fullName: 'Айгуль', phone: '996700111222',
  doctors: [
    { id: 1, fullName: 'Айгерим Садыкова', about: 'Терапевт\nЛечит без боли, 8 лет практики', photoUrl: '/doctors/1/photo?v=1' },
    { id: 2, fullName: 'Дастан Т.', about: 'Хирург' },
  ],
  services: [
    { id: 5, name: 'Лечение кариеса', durationMinutes: 60, priceSom: 2500, group: 'THERAPY' },
    { id: 6, name: 'Удаление зуба', durationMinutes: 45, priceSom: 1500, group: 'SURGERY' },
  ],
  clinic: { brandName: 'Стоматология «Тест»', legalName: 'ИП Тест' },
  ...extra,
})

/** Свободно завтра и через 4 дня: утро, день, вечер; запоминает запросы сетки и запись. */
function backend(patient: Me, book: (body: Book) => Response) {
  const asked: { free: string[]; slots: string[] } = { free: [], slots: [] }
  let current = patient
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(current)),
    http.get('*/api/patient/free-days', ({ request }) => {
      asked.free.push(new URL(request.url).search)
      return HttpResponse.json([tomorrow, later])
    }),
    http.get('*/api/patient/slots', ({ request }) => {
      const url = new URL(request.url)
      asked.slots.push(url.search)
      const date = url.searchParams.get('date')!
      return HttpResponse.json({ workingDay: true, starts: [slotInstant(date, 600), slotInstant(date, 780), slotInstant(date, 1080)], taken: [], breaks: [] } satisfies Schemas['BookingViewsSlots'])
    }),
    http.post('*/api/patient/booking', async ({ request }) => {
      const response = book(await request.json() as Book)
      if (response.status === 201) {
        const booking = await response.clone().json() as Schemas['BookingViewsBooking']
        current = { ...current, booking, bookings: [booking] }
      }
      return response
    }),
  )
  return asked
}

test('шаги и «Назад»: услуга → врач → дата → время → контакты; «Назад» Telegram — на шаг назад', async () => {
  const back = { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() }
  fakeTelegram({ BackButton: back })
  backend(me(), () => HttpResponse.json({}))
  const user = userEvent.setup()
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Выберите услугу' })).toBeInTheDocument()
  expect(stepText()).toBe('Шаг 1 из 5')
  // По разделам, цена «от» и длительность
  const therapy = screen.getByRole('group', { name: 'Терапия' })
  expect(within(therapy).getByRole('button', { name: /Лечение кариеса.*60 мин.*от 2\s500 сом/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '‹ Назад' })).toBeNull()

  await user.click(within(therapy).getByRole('button', { name: /Лечение кариеса/ }))
  expect(await screen.findByRole('heading', { name: 'Выберите врача' })).toBeInTheDocument()
  expect(stepText()).toBe('Шаг 2 из 5')
  // Карточка врача: фото, специальность (первая строка «о себе») и подробнее
  const aigerim = screen.getByRole('button', { name: /Айгерим Садыкова/ })
  expect(within(aigerim).getByText('Терапевт')).toHaveClass('wiz-specialty')
  expect(within(aigerim).getByText(/8 лет практики/)).toBeInTheDocument()
  expect(aigerim.querySelector('img')).toHaveAttribute('src', '/doctors/1/photo?v=1')
  expect(back.show).toHaveBeenCalled()

  await user.click(aigerim)
  expect(await screen.findByRole('heading', { name: 'Выберите дату' })).toBeInTheDocument()
  // «Назад» Telegram — снова врач, услуга сохранилась
  const handler = back.onClick.mock.calls.at(-1)![0] as () => void
  handler()
  expect(await screen.findByRole('heading', { name: 'Выберите врача' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Айгерим Садыкова/ })).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByRole('button', { name: '‹ Назад' }))
  expect(await screen.findByRole('heading', { name: 'Выберите услугу' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Лечение кариеса/ })).toHaveAttribute('aria-pressed', 'true')
})

test('один врач — шага врача нет; время — «Утро / День / Вечер»', async () => {
  fakeTelegram()
  backend(me({ doctors: [{ id: 1, fullName: 'Айгерим Садыкова' }] }), () => HttpResponse.json({}))
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: /Удаление зуба/ }))
  expect(await screen.findByRole('heading', { name: 'Выберите дату' })).toBeInTheDocument()
  expect(stepText()).toBe('Шаг 2 из 4')
  expect(screen.queryByRole('button', { name: /Любой свободный врач/ })).toBeNull()
  await user.click(screen.getByRole('button', { name: dayLong('ru', tomorrow) }))
  const grid = await screen.findByRole('group', { name: 'Свободное время' })
  expect(within(grid).getAllByRole('heading').map((h) => h.textContent)).toEqual(['Утро', 'День', 'Вечер'])
  expect(within(grid).getByRole('button', { name: '18:00' })).toBeInTheDocument()
})

test('«Любой свободный врач»: сетка и запись без врача, врача назначает сервер', async () => {
  fakeTelegram()
  let booked: Book | null = null
  const asked = backend(me(), (body) => {
    booked = body
    return HttpResponse.json({ id: 9, startAt: body.startAt, status: 'REQUESTED', doctorId: 2, doctorName: 'Дастан Т.', serviceName: 'Удаление зуба' } satisfies Schemas['BookingViewsBooking'], { status: 201 })
  })
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: /Удаление зуба/ }))
  await user.click(await screen.findByRole('button', { name: /Любой свободный врач/ }))
  await pickSlot(user, tomorrow, '13:00')
  expect(asked.free).toEqual(['?serviceTypeId=6'])
  expect(asked.slots.every((q) => !q.includes('doctorId'))).toBe(true)
  expect(screen.getByRole('region', { name: 'Ваша запись' })).toHaveTextContent('Любой свободный')
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: 'Записаться' }))

  expect(await screen.findByRole('heading', { name: 'Ваша запись' })).toBeInTheDocument()
  expect(booked).not.toHaveProperty('doctorId')
  expect(booked).toMatchObject({ serviceTypeId: 6, startAt: slotInstant(tomorrow, 780) })
  // На экране записи — врач, которого назначил сервер
  expect(screen.getByText('Дастан Т.')).toBeInTheDocument()
})

test('«Изменить» в итоге: другая дата — остальное сохраняется, время выбирается заново; другой врач — сбрасывает только время', async () => {
  fakeTelegram()
  let booked: Book | null = null
  backend(me(), (body) => {
    booked = body
    return HttpResponse.json({ id: 9, startAt: body.startAt, status: 'REQUESTED', doctorId: body.doctorId ?? 0 } satisfies Schemas['BookingViewsBooking'], { status: 201 })
  })
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: /Лечение кариеса/ }))
  await user.click(await screen.findByRole('button', { name: /Айгерим Садыкова/ }))
  await pickSlot(user, tomorrow, '10:00')
  const summary = () => screen.getByRole('region', { name: 'Ваша запись' })
  expect(summary()).toHaveTextContent('10:00')

  await user.click(within(summary()).getByRole('button', { name: 'Изменить: дата' }))
  expect(await screen.findByRole('heading', { name: 'Выберите дату' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: dayLong('ru', tomorrow) })).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByRole('button', { name: dayLong('ru', later) }))
  // Дата другая — к шагу «Время»; услуга и врач на месте, прежнего времени нет
  expect(await screen.findByRole('heading', { name: 'Выберите время' })).toBeInTheDocument()
  expect(summary()).toHaveTextContent('Лечение кариеса')
  expect(summary()).toHaveTextContent('Айгерим Садыкова')
  expect(within(summary()).queryByText('10:00')).toBeNull()
  await user.click(await screen.findByRole('button', { name: '18:00' }))

  await user.click(within(summary()).getByRole('button', { name: 'Изменить: врач' }))
  await user.click(await screen.findByRole('button', { name: /Дастан Т\./ }))
  // Врач другой — дата осталась, время заново
  expect(await screen.findByRole('heading', { name: 'Выберите время' })).toBeInTheDocument()
  expect(summary()).toHaveTextContent(dayLong('ru', later))
  await user.click(await screen.findByRole('button', { name: '13:00' }))
  // Тот же выбор — сразу к контактам
  await user.click(within(summary()).getByRole('button', { name: 'Изменить: услуга' }))
  await user.click(await screen.findByRole('button', { name: /Лечение кариеса/ }))
  expect(await screen.findByRole('heading', { name: 'Проверьте и подтвердите' })).toBeInTheDocument()
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: 'Записаться' }))
  await vi.waitFor(() => expect(booked).toMatchObject({ doctorId: 2, serviceTypeId: 5, startAt: slotInstant(later, 780) }))
})

test('время заняли (409) — понятное сообщение, шаг «Время» и свежая сетка; согласие не теряется', async () => {
  fakeTelegram()
  const tries: Book[] = []
  const asked = backend(me({ doctors: [{ id: 1, fullName: 'Айгерим Садыкова' }], services: [{ id: 5, name: 'Лечение кариеса', durationMinutes: 60 }] }), (body) => {
    tries.push(body)
    return tries.length === 1
      ? HttpResponse.json({ status: 409, code: 'time-taken', detail: 'Время занято' }, { status: 409 })
      : HttpResponse.json({ id: 9, startAt: body.startAt, status: 'REQUESTED', doctorId: 1 } satisfies Schemas['BookingViewsBooking'], { status: 201 })
  })
  const user = userEvent.setup()
  renderApp()
  await pickSlot(user, tomorrow, '10:00')
  await user.click(screen.getByRole('checkbox'))
  const before = asked.slots.length
  await user.click(screen.getByRole('button', { name: 'Записаться' }))

  expect(await screen.findByRole('heading', { name: 'Выберите время' })).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Это время уже заняли — выберите другое')
  await vi.waitFor(() => expect(asked.slots.length).toBeGreaterThan(before))
  expect(await screen.findByRole('button', { name: '10:00' })).toHaveAttribute('aria-pressed', 'false')
  await user.click(screen.getByRole('button', { name: '13:00' }))
  expect(screen.getByRole('checkbox')).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'Записаться' }))
  await vi.waitFor(() => expect(tries).toHaveLength(2))
  expect(tries[1]!.startAt).toBe(slotInstant(tomorrow, 780))
})

test('услуг много — поиск; по-кыргызски', async () => {
  fakeTelegram()
  const names = ['Осмотр', 'Чистка зубов', 'Лечение кариеса', 'Пломба', 'Удаление зуба', 'Коронка', 'Брекеты', 'Отбеливание']
  backend(me({ lang: 'ky', services: names.map((name, i) => ({ id: 10 + i, name, durationMinutes: 30 })) }), () => HttpResponse.json({}))
  const user = userEvent.setup()
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Кызматты тандаңыз' })).toBeInTheDocument()
  expect(stepText()).toBe('5 кадамдын 1-кадамы')
  await user.type(screen.getByRole('searchbox', { name: 'Кызматты издөө' }), 'зуб')
  expect(screen.getAllByRole('button', { pressed: false }).filter((b) => b.classList.contains('wiz-card')).map((b) => b.textContent))
    .toEqual([expect.stringContaining('Чистка зубов'), expect.stringContaining('Удаление зуба')])
  await user.type(screen.getByRole('searchbox'), 'жок')
  await user.click(screen.getByRole('button', { name: 'Бардык кызматтарды көрсөтүү' }))
  expect(screen.getByRole('button', { name: /Отбеливание/ })).toBeInTheDocument()
})
