import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { slotInstant, todayIn, addDays } from '../lib/time'
import { renderApp } from '../test/fixtures'
import { pickSlot, stepText } from '../test/wizard'
import { server } from '../test/server'
import { bookingDays, breakNote, dayLong, priceText, whenAt } from './i18n'
import { waitForSlow } from '../test/wait'

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
  expect(priceText('ky', 1500)).toMatch(/^1\s500 сомдон баштап$/)
  expect(breakNote('ru', { start: slotInstant('2026-11-06', 780), end: slotInstant('2026-11-06', 900), title: 'Джума-намаз', emoji: '🕌' }))
    .toBe('🕌 С 13:00 до 15:00 — джума-намаз, врач не принимает')
})

test('запись: врач → дата (свободные дни) → время → согласие → «Ваша запись»', async () => {
  fakeTelegram()
  const today = todayIn()
  const tomorrow = addDays(today, 1)
  let me = patient()
  let booked: Schemas['PatientBookingControllerBook'] | null = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patient/free-days', () => HttpResponse.json([tomorrow])),
    http.get('*/api/patient/slots', ({ request }) => {
      const date = new URL(request.url).searchParams.get('date')
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
  // Услуга одна — шага услуги нет: сначала врач
  expect(await screen.findByRole('heading', { name: 'Выберите врача' })).toBeInTheDocument()
  expect(stepText()).toBe('Шаг 1 из 4')
  await user.click(screen.getByRole('button', { name: /Айгерим Садыкова/ }))
  // Сегодня свободного нет — день приглушён и не нажимается
  expect(await screen.findByRole('button', { name: `${dayLong('ru', today)} — нет свободного времени` })).toBeDisabled()
  const summary = screen.getByRole('region', { name: 'Ваша запись' })
  expect(within(summary).getByText('Лечение кариеса')).toBeInTheDocument()
  expect(within(summary).getByText('Айгерим Садыкова')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: dayLong('ru', tomorrow) }))
  const grid = await screen.findByRole('group', { name: 'Свободное время' })
  expect(within(grid).getByRole('button', { name: '10:30 — занято' })).toBeDisabled()
  expect(within(grid).getByRole('heading', { name: 'Утро' })).toBeInTheDocument()
  await user.click(within(grid).getByRole('button', { name: '11:00' }))

  expect(await screen.findByRole('heading', { name: 'Проверьте и подтвердите' })).toBeInTheDocument()
  // Имя из Telegram известно — строкой, а не полем
  expect(screen.queryByRole('textbox', { name: 'Имя пациента' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Записаться' }))
  expect(await screen.findByText('Нужно согласие на обработку данных')).toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: /ИП Тест обрабатывает мои данные/ }))
  await user.click(screen.getByRole('button', { name: 'Записаться' }))

  expect(await screen.findByRole('heading', { name: 'Ваша запись' })).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Вы записаны')
  expect(screen.getByText(/Завтра, в 11:00/)).toBeInTheDocument()
  expect(screen.getByText(/Ждёт подтверждения врача/)).toBeInTheDocument()
  expect(booked).toEqual({ doctorId: 1, serviceTypeId: 5, startAt: slotInstant(tomorrow, 660), fullName: 'Айгуль', consent: true, comment: '' })
  // Постоянного пациента (сервер не прислал вариантов) «откуда узнали» не спрашиваем
  expect(screen.queryByText('Откуда вы о нас узнали?')).toBeNull()
})

/** В Telegram его MainButton не везде виден — кнопка внизу всегда своя, а MainButton Telegram спрятан. */
test('в Telegram — своя кнопка «Записаться» внизу, MainButton Telegram спрятан', async () => {
  const native = { setText: vi.fn(), show: vi.fn(), hide: vi.fn(), enable: vi.fn(), disable: vi.fn(), showProgress: vi.fn(), hideProgress: vi.fn(), onClick: vi.fn(), offClick: vi.fn() }
  fakeTelegram({ MainButton: native })
  const tomorrow = addDays(todayIn(), 1)
  let booked: unknown = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(patient({ doctors: [{ id: 1, fullName: 'Айгерим Садыкова' }] }))),
    http.get('*/api/patient/free-days', () => HttpResponse.json([tomorrow])),
    http.get('*/api/patient/slots', () => HttpResponse.json({ workingDay: true, starts: [slotInstant(tomorrow, 600)], taken: [], breaks: [] })),
    http.post('*/api/patient/booking', async ({ request }) => {
      booked = await request.json()
      return HttpResponse.json({ id: 9, startAt: slotInstant(tomorrow, 600), status: 'REQUESTED', doctorId: 1 } satisfies Schemas['BookingViewsBooking'])
    }),
  )
  const user = userEvent.setup()
  renderApp()
  // Врач один, услуга одна — сразу дата
  expect(await screen.findByRole('heading', { name: 'Выберите дату' })).toBeInTheDocument()
  expect(stepText()).toBe('Шаг 1 из 3')
  expect(screen.queryByRole('button', { name: 'Записаться' })).toBeNull()
  await pickSlot(user, tomorrow, '10:00')
  await user.click(screen.getByRole('checkbox', { name: /ИП Тест обрабатывает мои данные/ }))
  expect(native.hide).toHaveBeenCalled()
  expect(native.show).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Записаться' }))
  await waitForSlow(() => expect(booked).not.toBeNull())
})

/** Новый пациент: «Откуда вы о нас узнали?» — чипсы с эмодзи на его языке; без ответа запись тоже идёт. */
async function bookAsNewPatient(lang: 'ru' | 'ky', pick: (user: ReturnType<typeof userEvent.setup>) => Promise<void>) {
  fakeTelegram()
  const tomorrow = addDays(todayIn(), 1)
  const sourceChoices: Schemas['PatientSourcesChoice'][] = [
    { id: 11, emoji: '📱', title: 'Instagram', titleKy: 'Instagram' },
    { id: 16, emoji: '🤝', title: 'Посоветовали знакомые', titleKy: 'Тааныштар сунушташты' },
    { id: 30, emoji: '🎬', title: 'YouTube' },
  ]
  let booked: Schemas['PatientBookingControllerBook'] | null = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(patient({ lang, sourceChoices, doctors: [{ id: 1, fullName: 'Айгерим Садыкова' }] }))),
    http.get('*/api/patient/free-days', () => HttpResponse.json([tomorrow])),
    http.get('*/api/patient/slots', () => HttpResponse.json({ workingDay: true, starts: [slotInstant(tomorrow, 600)], taken: [], breaks: [] })),
    http.post('*/api/patient/booking', async ({ request }) => {
      booked = await request.json() as Schemas['PatientBookingControllerBook']
      return HttpResponse.json({ id: 9, startAt: booked.startAt, status: 'REQUESTED', doctorId: 1 } satisfies Schemas['BookingViewsBooking'])
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await pickSlot(user, tomorrow, '10:00', lang)
  await pick(user)
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: lang === 'ky' ? 'Жазылуу' : 'Записаться' }))
  await waitForSlow(() => expect(booked).not.toBeNull())
  return booked!
}

test('новый пациент: «Откуда вы о нас узнали?» по-кыргызски — выбрать, передумать, выбрать другое', async () => {
  const booked = await bookAsNewPatient('ky', async (user) => {
    // Свёрнуто — запись короче; раскрыть ссылкой
    await user.click(screen.getByRole('button', { name: '＋ Биз жөнүндө кайдан билдиңиз?' }))
    const chips = screen.getByRole('group', { name: 'Биз жөнүндө кайдан билдиңиз?' })
    expect(screen.getByText('Милдеттүү эмес — өткөрүп жиберсеңиз болот')).toBeInTheDocument()
    // Нет перевода — название как есть
    expect(within(chips).getByRole('button', { name: /YouTube/ })).toBeInTheDocument()
    const friends = within(chips).getByRole('button', { name: /Тааныштар сунушташты/ })
    await user.click(friends)
    expect(friends).toHaveAttribute('aria-pressed', 'true')
    await user.click(friends) // ещё раз — выбор снят
    expect(friends).toHaveAttribute('aria-pressed', 'false')
    await user.click(within(chips).getByRole('button', { name: /Instagram/ }))
  })
  expect(booked.sourceId).toBe(11)
})

test('новый пациент: вопрос необязательный — без ответа запись уходит без sourceId', async () => {
  const booked = await bookAsNewPatient('ru', async () => {
    // Вопрос свёрнут ссылкой — не мешает записаться
    expect(screen.getByRole('button', { name: '＋ Откуда вы о нас узнали?' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Откуда вы о нас узнали?' })).not.toBeInTheDocument()
  })
  expect(booked).not.toHaveProperty('sourceId')
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
  // Записи нет — снова выбор врача, и видно, что отмена прошла
  expect(await screen.findByRole('heading', { name: 'Тиш дарыгерине жазылуу' })).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Жазылуу жокко чыгарылды')
  expect(calls).toEqual(['waitlist', 'cancel'])

  await user.click(screen.getByRole('button', { name: 'Русский' }))
  expect(screen.getByRole('heading', { name: 'Запись к стоматологу' })).toBeInTheDocument()
})

test('своя запись: «Позвонить» на каждый номер клиники и WhatsApp своим номером; без WhatsApp — без кнопки', async () => {
  const openLink = vi.fn()
  fakeTelegram({ openLink })
  const booking = { id: 9, startAt: slotInstant(addDays(todayIn(), 2), 600), status: 'SCHEDULED' as const, doctorId: 1 }
  let whatsappPhone: string | undefined = '996700999888'
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(patient({
    booking, clinicContact: '+996 555 000 111, +7 701 234 56 78',
    clinic: { brandName: 'Стоматология «Тест»', phones: ['996555000111', '77012345678'], whatsappPhone },
  }))))
  const user = userEvent.setup()
  const first = renderApp()
  const calls = await screen.findAllByRole('link', { name: /Позвонить/ })
  expect(calls.map((a) => a.getAttribute('href'))).toEqual(['tel:+996555000111', 'tel:+77012345678'])
  // В Telegram tel: не работает — звонок через свою страницу call.html в браузере
  await user.click(calls[1]!)
  expect(openLink).toHaveBeenCalledWith(`${window.location.origin}/call.html#77012345678`)
  expect(screen.getByRole('link', { name: /Написать в WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/996700999888')
  first.unmount()

  whatsappPhone = undefined
  renderApp()
  expect(await screen.findAllByRole('link', { name: /Позвонить/ })).toHaveLength(2)
  expect(screen.queryByRole('link', { name: /WhatsApp/ })).not.toBeInTheDocument()
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

test('перенос удался — «Ваша запись» с подтверждением; в отпуск врача — «выберите другой день»', async () => {
  fakeTelegram()
  const day = addDays(todayIn(), 2)
  let me = patient({ booking: { id: 9, startAt: slotInstant(day, 600), status: 'SCHEDULED', doctorId: 1 } })
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patient/booking/slots', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('date') === day
      ? { workingDay: true, starts: [slotInstant(day, 720)], taken: [], breaks: [] }
      : { workingDay: false, starts: [], taken: [], breaks: [], dayOff: { title: 'Отпуск', emoji: '🏖' } })),
    http.post('*/api/patient/booking/reschedule', () => {
      const booking = { id: 9, startAt: slotInstant(day, 720), status: 'REQUESTED', doctorId: 1 } satisfies Schemas['BookingViewsBooking']
      me = { ...me, booking }
      return HttpResponse.json(booking)
    }),
  )
  window.history.replaceState(null, '', '/?screen=reschedule')
  const user = userEvent.setup()
  renderApp()
  await screen.findByRole('button', { name: '12:00' })
  await user.click(within(screen.getByRole('group', { name: 'День' })).getAllByRole('button')[0]!)
  expect(await screen.findByText('Выберите другой день')).toBeInTheDocument()
  await user.click(within(screen.getByRole('group', { name: 'День' })).getAllByRole('button')[2]!)
  await user.click(await screen.findByRole('button', { name: '12:00' }))
  await user.click(screen.getByRole('button', { name: 'Перенести' }))
  expect(await screen.findByRole('heading', { name: 'Ваша запись' })).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Запись перенесена')
  window.history.replaceState(null, '', '/')
})

test('в сетке дня свободного не осталось — одной кнопкой к ближайшему свободному дню', async () => {
  fakeTelegram()
  const today = todayIn()
  const soon = addDays(today, 1)
  const later = addDays(today, 3)
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(patient({ doctors: [{ id: 1, fullName: 'Айгерим Садыкова' }] }))),
    // Календарь думал, что завтра свободно, но пока выбирали — заняли
    http.get('*/api/patient/free-days', () => HttpResponse.json([soon, later])),
    http.get('*/api/patient/slots', ({ request }) => {
      const date = new URL(request.url).searchParams.get('date')
      return HttpResponse.json(date === later
        ? { workingDay: true, starts: [slotInstant(later, 600)], taken: [], breaks: [] }
        : { workingDay: true, starts: [], taken: [], breaks: [] })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: dayLong('ru', soon) }))
  expect(await screen.findByText('На этот день свободного времени нет')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Показать ближайшее свободное время' }))
  expect(await screen.findByRole('button', { name: '10:00' })).toBeInTheDocument()
  expect(screen.getByText(dayLong('ru', later), { selector: '.day-nav-title' })).toBeInTheDocument()
  // Стрелка назад — к прошлому свободному дню
  await user.click(screen.getByRole('button', { name: 'Предыдущий день' }))
  expect(await screen.findByText(dayLong('ru', soon), { selector: '.day-nav-title' })).toBeInTheDocument()
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
  await waitForSlow(() => expect(chosen).toEqual({ clinicId: 3 }))
})

test('выбор клиники: по городу и поиск по названию — по-кыргызски', async () => {
  fakeTelegram()
  localStorage.clear()
  const choices = [
    { id: 3, name: 'Улыбка', address: 'ул. Ленина 1', city: 'Ош' }, { id: 4, name: 'Ак-Тиш', address: 'Манаса 2', city: 'Бишкек' },
    { id: 5, name: 'Дент', city: 'Бишкек' }, { id: 6, name: 'Нур', city: 'Джалал-Абад' }, { id: 7, name: 'Береке', city: 'Бишкек' },
    { id: 8, name: 'Эне', address: 'Бишкек, Токтогула 9' },
  ] satisfies Schemas['ClinicLinksChoice'][]
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(patient({ lang: 'ky', clinicChoices: choices }))))
  const user = userEvent.setup()
  renderApp()
  const cities = await screen.findByRole('group', { name: 'Шаар' })
  await user.click(within(cities).getByRole('button', { name: /Жалал-Абад/ }))
  expect(screen.getByRole('button', { name: /Нур/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Улыбка/ })).not.toBeInTheDocument()
  await user.click(within(cities).getByRole('button', { name: 'Бардык шаарлар' }))
  await user.type(screen.getByRole('searchbox', { name: 'Клиниканын аталышы же дареги' }), 'ленина')
  expect(screen.getByRole('button', { name: /Улыбка.*Ош, ул\. Ленина 1/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Нур/ })).not.toBeInTheDocument()
  await user.type(screen.getByRole('searchbox'), ' жок')
  expect(screen.getByText(/Эч нерсе табылган жок/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Бардык клиникаларды көрсөтүү' }))
  expect(screen.getByRole('button', { name: /Эне/ })).toBeInTheDocument()
})

test('новая клиника ещё настраивается: «запись скоро» и телефон, без экранов записи', async () => {
  fakeTelegram()
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(patient({
    clinicContact: '+996 555 000 111', clinic: { brandName: 'Новая', settingUp: true },
  }))))
  renderApp()
  expect(await screen.findByRole('status')).toHaveTextContent('Клиника ещё настраивается — запись скоро')
  expect(screen.getByText('Позвоните в клинику: +996 555 000 111')).toBeInTheDocument()
  expect(screen.queryByText('Айгерим Садыкова')).not.toBeInTheDocument()
})

test('вне Telegram пациенту — подсказка про бота, без экранов записи', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(patient())))
  renderApp()
  expect(await screen.findByText(/Пациенты записываются через бота в Telegram/)).toBeInTheDocument()
})

test('календарь — столько дней, на сколько можно записаться; свободные дни — одним запросом, «Ближайшее свободное»', async () => {
  fakeTelegram()
  const today = todayIn()
  const free = [addDays(today, 3), addDays(today, 5)]
  const asked: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(patient({ daysAhead: 30, doctors: [{ id: 1, fullName: 'Айгерим Садыкова' }] }))),
    http.get('*/api/patient/free-days', ({ request }) => {
      asked.push(new URL(request.url).search)
      return HttpResponse.json(free)
    }),
    http.get('*/api/patient/slots', ({ request }) => {
      const date = new URL(request.url).searchParams.get('date')!
      return HttpResponse.json({ workingDay: true, starts: [slotInstant(date, 600)], taken: [], breaks: [] })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  const nearest = await screen.findByRole('button', { name: `Ближайшее свободное: ${dayLong('ru', free[0]!).toLowerCase()}` })
  // 31 день (30 вперёд и сегодня), открыты только свободные
  const days = document.querySelectorAll('.cal-day')
  expect(days).toHaveLength(31)
  expect([...days].filter((d) => !(d as HTMLButtonElement).disabled)).toHaveLength(2)
  expect(asked).toEqual(['?serviceTypeId=5&doctorId=1'])
  await user.click(nearest)
  expect(await screen.findByRole('button', { name: '10:00' })).toBeInTheDocument()
})

test('ошибка записи по коду — текст на языке пациента; номера клиники нет — без «Позвоните в клинику: »', async () => {
  fakeTelegram()
  const tomorrow = addDays(todayIn(), 1)
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(patient({ lang: 'ky', doctors: [{ id: 1, fullName: 'Айгерим Садыкова' }] }))),
    http.get('*/api/patient/free-days', () => HttpResponse.json([tomorrow])),
    http.get('*/api/patient/slots', () => HttpResponse.json({ workingDay: true, starts: [slotInstant(tomorrow, 600)], taken: [], breaks: [] })),
    http.post('*/api/patient/booking', () => HttpResponse.json({ status: 409, code: 'subscription-paused', detail: 'Оплата клиники закончилась — новые записи на паузе.' }, { status: 409 })),
  )
  const user = userEvent.setup()
  renderApp()
  await pickSlot(user, tomorrow, '10:00', 'ky')
  await user.click(screen.getByRole('checkbox', { name: /атымды жана телефонумду/ }))
  await user.click(screen.getByRole('button', { name: 'Жазылуу' }))
  const alert = await screen.findByText(/Клиника азыр бот аркылуу жаңы жазылууларды кабыл албай жатат/)
  expect(alert).toHaveTextContent('Клиника менен байланышыңыз.')
  expect(alert).not.toHaveTextContent(/Оплата|чалыңыз:/)
})

test('старый Telegram без requestContact 6.9 — подсказка обновить или отправить контакт боту', async () => {
  const requestContact = vi.fn()
  fakeTelegram({ requestContact, isVersionAtLeast: (v: string) => v <= '6.0' })
  const tomorrow = addDays(todayIn(), 1)
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(patient({ phone: undefined, doctors: [{ id: 1, fullName: 'Айгерим Садыкова' }] }))),
    http.get('*/api/patient/free-days', () => HttpResponse.json([tomorrow])),
    http.get('*/api/patient/slots', () => HttpResponse.json({ workingDay: true, starts: [slotInstant(tomorrow, 600)], taken: [], breaks: [] })),
  )
  const user = userEvent.setup()
  renderApp()
  await pickSlot(user, tomorrow, '10:00')
  await user.click(await screen.findByRole('button', { name: 'Поделиться номером' }))
  expect(screen.getByText(/Обновите Telegram или отправьте номер боту в чат/)).toBeInTheDocument()
  expect(requestContact).not.toHaveBeenCalled()
})

test('перенос: запись дальше ленты — выбран первый день, а не несуществующий', async () => {
  fakeTelegram()
  const far = addDays(todayIn(), 40)
  const asked: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(patient({ booking: { id: 9, startAt: slotInstant(far, 600), status: 'SCHEDULED', doctorId: 1 } }))),
    http.get('*/api/patient/booking/slots', ({ request }) => {
      asked.push(new URL(request.url).searchParams.get('date')!)
      return HttpResponse.json({ workingDay: true, starts: [], taken: [], breaks: [] })
    }),
  )
  window.history.replaceState(null, '', '/?screen=reschedule')
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Перенести запись' })).toBeInTheDocument()
  expect(screen.getByRole('group', { name: 'День' }).querySelector('[aria-pressed=true]')).toHaveTextContent('Сегодня')
  await waitForSlow(() => expect(asked).toEqual([todayIn()]))
  window.history.replaceState(null, '', '/')
})

test('запись в другой клинике — карточка и «Открыть эту клинику»', async () => {
  fakeTelegram()
  let chosen: unknown = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(patient({
      elsewhere: { clinicId: 3, clinicName: 'Улыбка', booking: { id: 7, startAt: slotInstant(addDays(todayIn(), 1), 600), status: 'SCHEDULED' } },
    }))),
    http.put('*/api/patient/clinic', async ({ request }) => {
      chosen = await request.json()
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  expect(await screen.findByText('📅 У вас запись в «Улыбка»: Завтра, в 10:00')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Открыть эту клинику' }))
  await waitForSlow(() => expect(chosen).toEqual({ clinicId: 3 }))
})

test('клиника на паузе (clinic-paused) и гонка (stale) — свои тексты; номер клиники — если известен', async () => {
  fakeTelegram()
  const tomorrow = addDays(todayIn(), 1)
  let code = 'clinic-paused'
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(patient({ clinicContact: '+996 555 000 111', doctors: [{ id: 1, fullName: 'Айгерим Садыкова' }] }))),
    http.get('*/api/patient/free-days', () => HttpResponse.json([tomorrow])),
    http.get('*/api/patient/slots', () => HttpResponse.json({ workingDay: true, starts: [slotInstant(tomorrow, 600)], taken: [], breaks: [] })),
    http.post('*/api/patient/booking', () => HttpResponse.json({ status: 409, code, detail: 'серверный текст' }, { status: 409 })),
  )
  const user = userEvent.setup()
  renderApp()
  await pickSlot(user, tomorrow, '10:00', 'ru')
  await user.click(screen.getByRole('checkbox', { name: /ИП Тест обрабатывает/ }))
  await user.click(screen.getByRole('button', { name: 'Записаться' }))
  expect(await screen.findByText('Запись онлайн временно недоступна. Позвоните в клинику: +996 555 000 111')).toBeInTheDocument()
  code = 'stale'
  await user.click(screen.getByRole('button', { name: 'Записаться' }))
  expect(await screen.findByText(/Данные только что изменились/)).toBeInTheDocument()
})

test('у врача выбраны услуги: услуга, которую делает один врач, — шаг врача пропущен; «Изменить» услугу — снова выбор врача', async () => {
  fakeTelegram()
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(patient({
      services: [
        { id: 5, name: 'Лечение кариеса', durationMinutes: 60, category: 'Терапия' },
        { id: 6, name: 'Удаление зуба', durationMinutes: 45, category: 'Хирургия' },
      ],
      doctorServices: [{ doctorId: 2, serviceTypeIds: [6] }],
    }))),
    http.get('*/api/patient/free-days', () => HttpResponse.json([])),
    http.get('*/api/patient/slots', () => HttpResponse.json({ workingDay: true, starts: [], taken: [], breaks: [] } satisfies Schemas['BookingViewsSlots'])),
  )
  const user = userEvent.setup()
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Выберите услугу' })).toBeInTheDocument()
  expect(stepText()).toBe('Шаг 1 из 5')
  await user.click(screen.getByRole('button', { name: /Лечение кариеса/ }))
  // Кариес лечит только Айгерим — сразу дата, врач в итоге без «Изменить»
  expect(await screen.findByRole('heading', { name: 'Выберите дату' })).toBeInTheDocument()
  expect(stepText()).toBe('Шаг 2 из 4')
  const summary = screen.getByRole('region', { name: 'Ваша запись' })
  expect(within(summary).getByText('Айгерим Садыкова')).toBeInTheDocument()
  expect(within(summary).queryByRole('button', { name: 'Изменить: врач' })).toBeNull()
  expect(await screen.findByText(/В ближайшие дни свободного времени нет/)).toBeInTheDocument()

  await user.click(within(summary).getByRole('button', { name: 'Изменить: услуга' }))
  await user.click(await screen.findByRole('button', { name: /Удаление зуба/ }))
  expect(await screen.findByRole('heading', { name: 'Выберите врача' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Дастан Т\./ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Айгерим Садыкова/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Любой свободный врач/ })).toBeInTheDocument()
})

test('«Другая клиника» — вверху экрана записи, над заголовком, и открывает выбор клиники', async () => {
  fakeTelegram()
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(patient({ canChangeClinic: true }))),
    http.get('*/api/patient/clinics', () => HttpResponse.json([])),
  )
  renderApp()
  const sw = await screen.findByRole('button', { name: /Стоматология «Тест».*другая клиника/ })
  const title = screen.getByRole('heading', { level: 1 })
  expect(sw.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  await userEvent.click(sw)
  expect(await screen.findByRole('heading', { level: 1 })).not.toBe(title)
})
