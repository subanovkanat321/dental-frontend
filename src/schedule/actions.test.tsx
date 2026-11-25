import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { todayIn } from '../lib/time'
import { appointment, me, renderApp, expand, openPay, pickStatus, statusMenu, chosenDoctor, pickDoctorChip, openBooked, openNewMore, serviceField, servicesChosen, pickService, serviceOptionsShown } from '../test/fixtures'
import { server } from '../test/server'

// Сетка «Все врачи» на компьютере: с 2026-11-25 по умолчанию открывается свой врач — выбор «Все врачи» запомнен
beforeEach(() => { localStorage.setItem('crm.schedule.view.v2', 'all') })

type Appointment = Schemas['AppointmentView']

/** Фальшивый бэкенд с одним днём: список приёмов меняется, как на сервере. */
function backend(list: Appointment[], who: Schemas['BookingViewsMe'] = me) {
  const day = [...list]
  const replace = (a: Appointment) => {
    day.splice(day.findIndex((x) => x.id === a.id), 1, a)
    return HttpResponse.json(a)
  }
  const sent: { path: string; body: unknown }[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/appointments', ({ request }) => {
      const doctorId = Number(new URL(request.url).searchParams.get('doctorId'))
      return HttpResponse.json(day.filter((a) => a.doctorId === doctorId))
    }),
    http.post('*/api/appointments/:id/:action', async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>
      sent.push({ path: String(params.action), body })
      const a = day.find((x) => x.id === Number(params.id))!
      if (params.action === 'status') return replace({ ...a, status: body.status as Appointment['status'], version: a.version + 1 })
      return replace({ ...a, paidSom: body.amountSom as number, paymentMethod: body.method as Appointment['paymentMethod'], version: a.version + 1 })
    }),
    http.post('*/api/appointments/:id/payment/bill', async ({ request, params }) => {
      const body = (await request.json()) as { chargeSom: number }
      sent.push({ path: 'bill', body })
      const a = day.find((x) => x.id === Number(params.id))!
      return replace({ ...a, chargeSom: body.chargeSom, version: a.version + 1 })
    }),
  )
  return sent
}

async function open(name: RegExp) {
  await userEvent.click(await screen.findByRole('button', { name }))
  return screen.getByRole('complementary', { name: 'Карточка приёма' })
}

test('заявку подтверждают из карточки: уходит статус с версией, карточка и колонка обновляются', async () => {
  const sent = backend([appointment(10, 1, '10:00', 'Бакыт М.', { status: 'REQUESTED', version: 3 })])
  renderApp()
  const panel = await open(/Бакыт М\./)
  expect(statusMenu(panel)).toHaveAccessibleName('Статус: Заявка')

  await userEvent.click(within(panel).getByRole('button', { name: 'Подтвердить' }))
  // Следующий шаг: до конца приёма — «Пришёл», после — сразу «Приём состоялся» (зависит от часов)
  expect(await within(panel).findByRole('button', { name: /^(Пришёл|Приём состоялся)$/ })).toBeInTheDocument()
  expect(sent).toEqual([{ path: 'status', body: { version: 3, status: 'SCHEDULED' } }])
  expect(statusMenu(panel)).toHaveAccessibleName('Статус: Записан')
})

test('приём состоялся — оплата: сумма из цены услуги, способ «Карта»', async () => {
  const sent = backend([appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', servicePriceSom: 2500, version: 1 })])
  renderApp()
  const panel = await open(/Бакыт М\./)
  const form = await openPay(panel)
  expect(within(form).getByLabelText('Сумма, сом')).toHaveValue(2500)

  await userEvent.click(within(form).getByRole('button', { name: 'Карта' }))
  await userEvent.click(within(form).getByRole('button', { name: /^Сохранить оплату/ }))
  expect(await within(panel).findByText(/^2\s500 сом/)).toHaveTextContent('карта')
  expect(sent).toEqual([{ path: 'payment', body: { amountSom: 2500, method: 'CARD' } }])
})

test('в клинике есть регистратура — врач отправляет «На кассу», карточка ждёт оплаты', async () => {
  const sent = backend([appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', version: 1 })], { ...me, admin: false, hasReception: true })
  renderApp()
  const panel = await open(/Бакыт М\./)
  await openPay(panel)
  await userEvent.type(within(panel).getByLabelText('Сумма, сом'), '4000')
  await userEvent.click(within(panel).getByRole('button', { name: /На кассу/ }))

  expect(await within(panel).findByText(/К оплате на кассе: 4\s000 сом/)).toBeInTheDocument()
  expect(within(panel).getByRole('button', { name: /^Принять оплату/ })).toBeInTheDocument()
  expect(sent).toEqual([{ path: 'bill', body: { chargeSom: 4000 } }])
})

test('отменить запись — только после подтверждения в окне причины', async () => {
  const sent = backend([appointment(10, 1, '10:00', 'Бакыт М.')])
  renderApp()
  const panel = await open(/Бакыт М\./)

  await pickStatus(panel, 'Отменён')
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: 'Причина отмены' })).toBeNull()
  expect(sent).toEqual([])
  await pickStatus(panel, 'Отменён')
  const sheet = screen.getByRole('dialog', { name: 'Причина отмены' })
  await userEvent.click(within(sheet).getByRole('radio', { name: 'Передумал' }))
  await userEvent.click(within(sheet).getByRole('button', { name: 'Отменить запись' }))
  expect(await within(panel).findByText('Запись отменена')).toBeInTheDocument()
  expect(sent).toEqual([{ path: 'status', body: { version: 0, status: 'CANCELLED', reason: 'CHANGED_MIND' } }])
})

test('нажать на пустое место у врача — «Новая запись»: найти пациента, записать на это время', async () => {
  backend([])
  let created: unknown
  let waiting: unknown
  server.use(
    http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, starts: ['09:00', '10:00'].map((t) => new Date(`${todayIn()}T${t}:00+06:00`).toISOString()) })),
    http.post('*/api/waitlist', async ({ request }) => {
      waiting = await request.json()
      return HttpResponse.json({ id: 1 }, { status: 201 })
    }),
    http.get('*/api/service-types', () => HttpResponse.json([{ id: 5, name: 'Чистка', durationMinutes: 60, active: true, priceSom: 3000 }])),
    http.post('*/api/patients/search', () => HttpResponse.json([{ id: 7, fullName: 'Нурлан К.', phone: '996700111222' }])),
    http.post('*/api/appointments', async ({ request }) => {
      created = await request.json()
      return HttpResponse.json(appointment(99, 2, '09:00', 'Нурлан К.', { serviceName: 'Чистка' }), { status: 201 })
    }),
  )
  renderApp()
  // В jsdom у колонки нет размеров: нажатие приходится на верх — начало дня клиники, 09:00
  await userEvent.click(await screen.findByRole('group', { name: 'Дастан Т.' }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  const grid = await within(panel).findByRole('group', { name: 'Свободное время' })
  expect(within(grid).getByRole('button', { name: '09:00' })).toHaveAttribute('aria-pressed', 'true')
  expect(chosenDoctor(panel)).toBe('Дастан Т.')

  await userEvent.type(within(panel).getByLabelText('Найти пациента'), 'Нур')
  await userEvent.click(await within(panel).findByRole('button', { name: /Нурлан К\./ }))
  await pickService(panel, 'Чистка')
  expect(within(panel).getByLabelText('Длительность')).toHaveAttribute('data-value', '60')
  await openNewMore(panel)
  await userEvent.click(within(panel).getByLabelText(/Хочет раньше/))
  await userEvent.click(within(panel).getByRole('button', { name: /^Записать( ·|$)/ }))

  // После записи справа — карточка нового приёма
  expect(await openBooked()).toHaveTextContent('Нурлан К.')
  expect(created).toEqual({
    doctorId: 2, patientId: 7, startAt: new Date(`${todayIn()}T09:00:00+06:00`).toISOString(), durationMinutes: 60, serviceTypeId: 5,
  })
  expect(waiting).toEqual({ patientId: 7, doctorId: 2, durationMinutes: 60 })
})

test('новый пациент с номером, который уже есть, — «Выбрать его», затем запись', async () => {
  backend([])
  let created: { patientId?: number } = {}
  let phone: unknown
  server.use(
    http.get('*/api/service-types', () => HttpResponse.json([])),
    http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, starts: [new Date(`${todayIn()}T23:00:00+06:00`).toISOString()] })),
    http.post('*/api/patients', async ({ request }) => {
      phone = ((await request.json()) as { phone: string }).phone
      return HttpResponse.json({
        title: 'Conflict', status: 409, detail: 'Пациент с этим номером уже есть', code: 'duplicate-patient',
        patient: { id: 8, fullName: 'Айжан Б.', phone: '996555000111' },
      }, { status: 409 })
    }),
    http.post('*/api/appointments', async ({ request }) => {
      created = (await request.json()) as { patientId: number }
      return HttpResponse.json(appointment(98, 1, '09:00', 'Айжан Б.'), { status: 201 })
    }),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: '＋ Новая запись' }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  // Поле поиска было в фокусе — после «＋ Новый пациент» курсор сразу в имени (на телефоне — клавиатура)
  expect(within(panel).getByRole('searchbox', { name: 'Найти пациента' })).toHaveFocus()
  await userEvent.click(within(panel).getByRole('button', { name: '＋ Новый пациент' }))
  expect(within(panel).getByLabelText('Имя и фамилия')).toHaveFocus()
  await userEvent.type(within(panel).getByLabelText('Имя и фамилия'), 'Айжан')
  await userEvent.type(within(panel).getByLabelText('Телефон'), '555 000 111')
  // Время не подставлено — выбрать в сетке свободного
  await userEvent.click(await within(panel).findByRole('button', { name: '23:00' }))
  // Выбрали время — фокус на «Записать» (с телефона дальше сам прокрутит к ней)
  expect(within(panel).getByRole('button', { name: /^Записать( ·|$)/ })).toHaveFocus()
  // Услуга — до времени: от неё длительность, а от длительности — свободное время
  const service = within(panel).queryByRole('combobox', { name: 'Услуга' })
  if (service) expect(service.compareDocumentPosition(within(panel).getByRole('button', { name: '23:00' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  await userEvent.click(within(panel).getByRole('button', { name: /^Записать( ·|$)/ }))

  expect(await within(panel).findByText(/Пациент с этим номером уже есть: Айжан Б\./)).toBeInTheDocument()
  expect(phone).toBe('+996555000111')
  await userEvent.click(within(panel).getByRole('button', { name: 'Выбрать его' }))
  await userEvent.click(within(panel).getByRole('button', { name: /^Записать( ·|$)/ }))
  expect(await openBooked()).toHaveTextContent('Айжан Б.')
  expect(created.patientId).toBe(8)
})

test('открыли «Перенести» у одного приёма и нажали другой — карточка другого, без формы и данных прежнего', async () => {
  backend([appointment(10, 1, '10:00', 'Бакыт М.'), appointment(11, 1, '14:00', 'Нурлан К.')])
  renderApp()
  const first = await open(/Бакыт М\./)
  await userEvent.click(within(first).getByRole('button', { name: 'Перенести или передать врачу' }))
  expect(within(first).getByRole('form', { name: 'Перенос записи' })).toBeInTheDocument()

  const second = await open(/Нурлан К\./)
  expect(second).toHaveTextContent('14:00')
  expect(within(second).queryByRole('form', { name: 'Перенос записи' })).not.toBeInTheDocument()
})

test('из карточки приёма — «Зубы» → «Карта зубов и план лечения ›» (одна точка входа) и обратно к этому приёму', async () => {
  backend([appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', version: 1 })])
  server.use(
    http.get('*/api/patients/:id/teeth', () => HttpResponse.json([])),
    http.get('*/api/patients/:id/plan', () => HttpResponse.json([])),
    http.get('*/api/patients/:id/files', () => HttpResponse.json([])),
  )
  renderApp()
  const panel = await open(/Бакыт М\./)
  // Отдельной большой кнопки «Карта зубов» больше нет: вход — из строки «Зубы»
  const teeth = await within(panel).findByRole('region', { name: 'Зубы этого приёма' })
  expect(within(panel).queryByRole('button', { name: /Карта зубов и план лечения/ })).not.toBeInTheDocument()
  await expand(teeth)
  expect(within(panel).getAllByRole('button', { name: /Карта зубов и план лечения/ })).toHaveLength(1)
  await userEvent.click(within(teeth).getByRole('button', { name: 'Карта зубов и план лечения ›' }))
  expect(await screen.findByRole('heading', { name: /Медкарта · Бакыт М\./ })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '← К приёму' }))
  expect(await screen.findByRole('complementary', { name: 'Карточка приёма' })).toHaveTextContent('Бакыт М.')
})

test('время успели занять (409 time-taken) — «Время занято» под временем, один раз, и сетка свободного перечитывается', async () => {
  backend([])
  let slotCalls = 0
  server.use(
    http.get('*/api/slots', () => {
      slotCalls++
      return HttpResponse.json({ workingDay: true, starts: [new Date(`${todayIn()}T09:00:00+06:00`).toISOString()] })
    }),
    http.get('*/api/service-types', () => HttpResponse.json([])),
    http.post('*/api/patients/search', () => HttpResponse.json([{ id: 7, fullName: 'Нурлан К.', phone: '996700111222' }])),
    http.post('*/api/appointments', () =>
      HttpResponse.json({ title: 'Conflict', status: 409, detail: 'Время занято', code: 'time-taken' }, { status: 409 })),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('group', { name: 'Дастан Т.' }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  await within(panel).findByRole('group', { name: 'Свободное время' })
  await userEvent.type(within(panel).getByLabelText('Найти пациента'), 'Нур')
  await userEvent.click(await within(panel).findByRole('button', { name: /Нурлан К\./ }))
  const before = slotCalls
  await userEvent.click(within(panel).getByRole('button', { name: /^Записать( ·|$)/ }))

  await waitFor(() => expect(within(panel).getAllByRole('alert')).toHaveLength(1))
  expect(within(panel).getByRole('alert')).toHaveTextContent('Время занято')
  await waitFor(() => expect(slotCalls).toBeGreaterThan(before))
  // Панель осталась открытой — можно выбрать другое время
  expect(screen.queryByRole('complementary', { name: 'Карточка приёма' })).not.toBeInTheDocument()
})

test('приём успели изменить в другом окне (409 stale) — «обновите», день перечитан, повтор уходит с новой версией', async () => {
  let version = 3
  let status: Appointment['status'] = 'REQUESTED'
  let dayCalls = 0
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => {
      dayCalls++
      const doctorId = Number(new URL(request.url).searchParams.get('doctorId'))
      return HttpResponse.json([appointment(10, 1, '10:00', 'Бакыт М.', { status, version })].filter((a) => a.doctorId === doctorId))
    }),
    http.post('*/api/appointments/:id/status', async ({ request }) => {
      const body = (await request.json()) as { version: number; status: string }
      sent.push(body)
      if (body.version !== version) {
        return HttpResponse.json({ title: 'Conflict', status: 409, detail: 'Приём изменён, обновите', code: 'stale' }, { status: 409 })
      }
      version++
      status = 'SCHEDULED'
      return HttpResponse.json(appointment(10, 1, '10:00', 'Бакыт М.', { status, version }))
    }),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  // Пока карточка открыта, ассистент в другом окне ответил за пациента — версия на сервере 4
  version = 4
  const before = dayCalls

  await userEvent.click(within(panel).getByRole('button', { name: 'Подтвердить' }))
  await waitFor(() => expect(within(panel).getByRole('alert')).toHaveTextContent('Приём изменён, обновите'))
  await waitFor(() => expect(dayCalls).toBeGreaterThan(before))

  await userEvent.click(within(panel).getByRole('button', { name: 'Подтвердить' }))
  expect(await within(panel).findByRole('button', { name: /^(Пришёл|Приём состоялся)$/ })).toBeInTheDocument()
  expect(sent).toEqual([{ version: 3, status: 'SCHEDULED' }, { version: 4, status: 'SCHEDULED' }])
})

test('новая запись: у врача выбраны услуги — только они; сменили врача — чужая услуга снимается', async () => {
  backend([], { ...me, doctorServices: [{ doctorId: 2, serviceTypeIds: [6] }] })
  server.use(
    http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, starts: [new Date(`${todayIn()}T09:00:00+06:00`).toISOString()] })),
    http.get('*/api/service-types', () => HttpResponse.json([
      { id: 5, name: 'Чистка', durationMinutes: 60, active: true },
      { id: 6, name: 'Удаление зуба', durationMinutes: 45, active: true },
    ] satisfies Schemas['ServiceTypeView'][])),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('group', { name: 'Дастан Т.' }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  await within(panel).findByRole('combobox', { name: 'Услуга' })
  expect(await serviceOptionsShown(panel)).toEqual([expect.stringContaining('Удаление зуба')])

  // У врача 1 услуги не выбраны — все услуги клиники
  await pickDoctorChip(panel, 'Айгерим С.')
  await pickService(panel, 'Чистка')
  expect(servicesChosen(panel)).toHaveTextContent('Чистка · 60 мин')

  // Обратно к врачу 2: «Чистку» он не оказывает — её нет, выбор снят
  await pickDoctorChip(panel, 'Дастан Т.')
  expect(servicesChosen(panel)).toHaveTextContent('Выберите услугу…')
  expect((await serviceOptionsShown(panel)).join('|')).not.toContain('Чистка')
})

test('новая запись: услуги не из прайса (скрытые) не предлагаются — ни в «Частых», ни в разделах', async () => {
  backend([], me)
  const names = ['Консультация', 'Снимок зуба', 'Лечение кариеса', 'Лечение каналов', 'Удаление зуба', 'Профчистка', 'Отбеливание',
    'Коронка', 'Имплант']
  server.use(
    http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, starts: [new Date(`${todayIn()}T09:00:00+06:00`).toISOString()] })),
    http.get('*/api/service-types', () => HttpResponse.json([
      ...names.map((name, i) => ({ id: i + 1, name, durationMinutes: 30, active: true })),
      { id: 20, name: 'Синус-лифтинг', durationMinutes: 120, active: false },
      { id: 21, name: 'Повторная консультация', durationMinutes: 20, active: false },
    ] satisfies Schemas['ServiceTypeView'][])),
    http.get('*/api/service-types/popular', () => HttpResponse.json({ ids: [20, 1] } satisfies Schemas['ServiceTypeControllerPopular'])),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('group', { name: 'Дастан Т.' }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  await within(panel).findByRole('combobox', { name: 'Услуга' })
  // Частая, но скрытая — не в «Частых»
  await userEvent.click(serviceField(panel))
  const frequent = within(screen.getByRole('listbox')).getByRole('group', { name: 'Частые' })
  expect(within(frequent).getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringContaining('Консультация')])
  await userEvent.type(within(document.body).getByRole('searchbox', { name: 'Поиск в списке' }), 'консультац')
  const options = within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)
  // «Частые» и раздел — та же «Консультация»; «Повторной» (скрыта) нет
  expect(options.length).toBeGreaterThan(0)
  expect(options.every((o) => o?.includes('Консультация ·'))).toBe(true)
})

test('новая запись: услуга одним полем — поиск сверху, «Частые», потом разделы прайса; выбрали — длительность подставилась', async () => {
  backend([], me)
  const names: [string, Schemas['ServiceTypeView']['group']][] = [
    ['Первичная консультация', 'EXAM'], ['Профессиональная чистка', 'HYGIENE'], ['Лечение кариеса', 'THERAPY'],
    ['Пломба', 'THERAPY'], ['Лечение пульпита', 'THERAPY'], ['Удаление зуба', 'SURGERY'], ['Удаление зуба мудрости', 'SURGERY'],
    ['Металлокерамическая коронка', 'PROSTHETICS'], ['Брекеты', 'ORTHODONTICS'], ['Отбеливание', 'AESTHETICS'],
    ['Осмотр ребёнка', 'KIDS'], ['Прицельный снимок', 'XRAY'],
  ]
  server.use(
    http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, starts: [new Date(`${todayIn()}T09:00:00+06:00`).toISOString()] })),
    http.get('*/api/service-types', () => HttpResponse.json(names.map(([name, group], i) => ({
      id: i + 1, name, group, durationMinutes: 30 + i * 5, active: true,
    })) satisfies Schemas['ServiceTypeView'][])),
    http.get('*/api/service-types/popular', () => HttpResponse.json({ ids: [3, 2] } satisfies Schemas['ServiceTypeControllerPopular'])),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('group', { name: 'Дастан Т.' }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  await userEvent.click(await within(panel).findByRole('combobox', { name: 'Услуга' }))
  const list = screen.getByRole('listbox')
  // Поиск — сверху; «Частые» — первыми (топ клиники), дальше все услуги по разделам прайса
  expect(within(document.body).getByRole('searchbox', { name: 'Поиск в списке' })).toBeInTheDocument()
  expect(within(list).getAllByRole('group').map((g) => g.getAttribute('aria-label') ?? within(g).getAllByRole('presentation')[0]?.textContent)).toEqual([
    'Частые', 'Осмотр и консультация', 'Профилактика и гигиена', 'Терапия', 'Хирургия', 'Ортопедия', 'Ортодонтия', 'Эстетика',
    'Детская стоматология', 'Рентген и диагностика'])
  const frequent = within(list).getAllByRole('group')[0]!
  expect(within(frequent).getAllByRole('option').map((o) => o.textContent)).toEqual([
    expect.stringContaining('Лечение кариеса'), expect.stringContaining('Профессиональная чистка'),
  ])
  // Поиск — по всем разделам сразу
  await userEvent.type(within(document.body).getByRole('searchbox', { name: 'Поиск в списке' }), 'ребенк')
  await userEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Осмотр ребёнка/ }))
  // Выбрали — в поле услуга и длительность (без цены), длительность записи подставилась
  expect(servicesChosen(panel)).toHaveTextContent('Осмотр ребёнка · 80 мин')
  expect(within(panel).getByRole('spinbutton', { name: 'Длительность, мин' })).toHaveValue(80)
})
