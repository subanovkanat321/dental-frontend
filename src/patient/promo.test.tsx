import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, slotInstant, todayIn } from '../lib/time'
import { renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { pickSlot } from '../test/wizard'

type Me = Schemas['BookingViewsMe']
type Book = Schemas['PatientBookingControllerBook']

function fakeTelegram() {
  window.Telegram = { WebApp: { initData: 'query_id=1&user=%7B%22id%22%3A222%7D&hash=abc', ready() {}, expand() {} } }
}

afterEach(() => {
  delete window.Telegram
})

/** Вымышленный пациент: один врач, одна услуга, завтра в 10:00 свободно. */
function backend(extra: Partial<Me>, onBook: (body: Book) => Response) {
  const tomorrow = addDays(todayIn(), 1)
  let me: Me = {
    doctor: false, platform: false, bookingEnabled: true, lang: 'ru', daysAhead: 14, fullName: 'Айгуль', phone: '996700111222',
    doctors: [{ id: 1, fullName: 'Айгерим Садыкова' }],
    services: [{ id: 5, name: 'Лечение кариеса', durationMinutes: 60 }],
    clinic: { brandName: 'Стоматология «Тест»', legalName: 'ИП Тест' },
    ...extra,
  }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patient/free-days', () => HttpResponse.json([tomorrow])),
    http.get('*/api/patient/slots', () => HttpResponse.json({ workingDay: true, starts: [slotInstant(tomorrow, 600)], taken: [], breaks: [] })),
    http.get('*/api/patient/promo-code', ({ request }) => {
      const code = new URL(request.url).searchParams.get('code')?.toUpperCase()
      return code === 'ZUBY10'
        ? HttpResponse.json({ code: 'ZUBY10', discountPercent: 10 } satisfies Schemas['BookingViewsPromo'])
        : HttpResponse.json({ title: 'Ошибка', errors: [{ field: 'promoCode', message: 'Такого промокода нет — проверьте написание' }] }, { status: 422 })
    }),
    http.post('*/api/patient/booking', async ({ request }) => {
      const body = await request.json() as Book
      const response = onBook(body)
      if (response.status === 201) me = { ...me, booking: await response.clone().json() as Schemas['BookingViewsBooking'] }
      return response
    }),
  )
}

async function pickTimeAndConsent(user: ReturnType<typeof userEvent.setup>, lang: 'ru' | 'ky' = 'ru') {
  await pickSlot(user, addDays(todayIn(), 1), '10:00', lang)
  await user.click(screen.getByRole('checkbox'))
}

test('промокод при записи: «Проверить» показывает скидку-подсказку, код уходит с записью и виден в «Ваша запись»', async () => {
  fakeTelegram()
  let booked: Book | null = null
  backend({}, (body) => {
    booked = body
    return HttpResponse.json({ id: 9, startAt: body.startAt, status: 'REQUESTED', doctorId: 1, promoCode: 'ZUBY10' } satisfies Schemas['BookingViewsBooking'], { status: 201 })
  })
  const user = userEvent.setup()
  renderApp()
  await pickTimeAndConsent(user)
  // Поле свёрнуто: у большинства пациентов кода нет
  await user.click(screen.getByRole('button', { name: '🎟 У меня есть промокод' }))
  const input = screen.getByRole('textbox', { name: 'Промокод (если есть)' })
  await user.type(input, 'nope')
  await user.click(screen.getByRole('button', { name: 'Проверить' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Такого промокода нет — проверьте написание')
  await user.clear(input)
  await user.type(input, 'zuby10')
  await user.click(screen.getByRole('button', { name: 'Проверить' }))
  expect(await screen.findByRole('status')).toHaveTextContent('✓ Промокод принят: −10%. Скидку применяет клиника на приёме.')

  await user.click(screen.getByRole('button', { name: 'Записаться' }))
  expect(await screen.findByRole('heading', { name: 'Ваша запись' })).toBeInTheDocument()
  expect(booked).toMatchObject({ promoCode: 'ZUBY10' })
  expect(screen.getByText(/Промокод ZUBY10 — скидку применяет клиника на приёме/)).toBeInTheDocument()
})

test('промокод из ссылки клиники подставлен; неподходящий — ошибка по-кыргызски, без кода запись идёт', async () => {
  fakeTelegram()
  const sent: Book[] = []
  backend({ lang: 'ky', promoCode: 'OLD2025' }, (body) => {
    sent.push(body)
    return body.promoCode
      ? HttpResponse.json({ title: 'Ошибка', errors: [{ field: 'promoCode', message: 'Срок промокода закончился' }] }, { status: 422 })
      : HttpResponse.json({ id: 9, startAt: body.startAt, status: 'REQUESTED', doctorId: 1 } satisfies Schemas['BookingViewsBooking'], { status: 201 })
  })
  const user = userEvent.setup()
  renderApp()
  await pickTimeAndConsent(user, 'ky')
  // Пришёл по ссылке с кодом — поле уже открыто и заполнено
  expect(screen.getByRole('textbox', { name: 'Промокод (болсо)' })).toHaveValue('OLD2025')
  await user.click(screen.getByRole('button', { name: 'Жазылуу' }))
  expect(await screen.findByText(/Мындай промокод жок же мөөнөтү бүттү/)).toBeInTheDocument()
  expect(sent[0]).toMatchObject({ promoCode: 'OLD2025' })

  await user.click(screen.getByRole('button', { name: 'Алып салуу' }))
  await user.click(screen.getByRole('button', { name: 'Жазылуу' }))
  await vi.waitFor(() => expect(sent).toHaveLength(2))
  expect(sent[1]!.promoCode).toBeUndefined()
})
