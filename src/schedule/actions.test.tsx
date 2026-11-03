import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'

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
      if (params.action === 'status') return replace({ ...a, status: body.status as Appointment['status'], version: a.version! + 1 })
      return replace({ ...a, paidSom: body.amountSom as number, paymentMethod: body.method as Appointment['paymentMethod'], version: a.version! + 1 })
    }),
    http.post('*/api/appointments/:id/payment/bill', async ({ request, params }) => {
      const body = (await request.json()) as { chargeSom: number }
      sent.push({ path: 'bill', body })
      const a = day.find((x) => x.id === Number(params.id))!
      return replace({ ...a, chargeSom: body.chargeSom, version: a.version! + 1 })
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
  expect(panel).toHaveTextContent('Заявка — подтвердите')

  await userEvent.click(within(panel).getByRole('button', { name: 'Подтвердить' }))
  expect(await within(panel).findByRole('button', { name: 'Приём состоялся' })).toBeInTheDocument()
  expect(sent).toEqual([{ path: 'status', body: { version: 3, status: 'SCHEDULED' } }])
  expect(panel).not.toHaveTextContent('Заявка — подтвердите')
})

test('приём состоялся — оплата: сумма из цены услуги, способ «Карта»', async () => {
  const sent = backend([appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', servicePriceSom: 2500, version: 1 })])
  renderApp()
  const panel = await open(/Бакыт М\./)
  const form = within(panel).getByRole('form', { name: 'Оплата' })
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
  await userEvent.type(within(panel).getByLabelText('Сумма, сом'), '4000')
  await userEvent.click(within(panel).getByRole('button', { name: /На кассу/ }))

  expect(await within(panel).findByText(/К оплате на кассе: 4\s000 сом/)).toBeInTheDocument()
  expect(within(panel).getByRole('button', { name: /^Принять оплату/ })).toBeInTheDocument()
  expect(sent).toEqual([{ path: 'bill', body: { chargeSom: 4000 } }])
})

test('отменить запись — только после подтверждения в диалоге', async () => {
  const sent = backend([appointment(10, 1, '10:00', 'Бакыт М.')])
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  renderApp()
  const panel = await open(/Бакыт М\./)

  await userEvent.click(within(panel).getByRole('button', { name: 'Отменить запись' }))
  expect(sent).toEqual([])
  await userEvent.click(within(panel).getByRole('button', { name: 'Отменить запись' }))
  expect(await within(panel).findByText(/Отменён/)).toBeInTheDocument()
  expect(sent).toEqual([{ path: 'status', body: { version: 0, status: 'CANCELLED' } }])
  confirm.mockRestore()
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
  expect(within(panel).getByLabelText('Врач')).toHaveAttribute('data-value', '2')

  await userEvent.type(within(panel).getByLabelText('Найти пациента'), 'Нур')
  await userEvent.click(await within(panel).findByRole('button', { name: /Нурлан К\./ }))
  await userEvent.click(within(within(panel).getByRole('group', { name: 'Услуга' })).getByRole('button', { name: /Чистка/ }))
  expect(within(panel).getByLabelText('Длительность')).toHaveAttribute('data-value', '60')
  await userEvent.click(within(panel).getByLabelText(/Хочет раньше/))
  await userEvent.click(within(panel).getByRole('button', { name: 'Записать' }))

  // После записи справа — карточка нового приёма
  expect(await screen.findByRole('complementary', { name: 'Карточка приёма' })).toHaveTextContent('Нурлан К.')
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
  await userEvent.click(within(panel).getByRole('button', { name: '＋ Новый пациент' }))
  await userEvent.type(within(panel).getByLabelText('Имя и фамилия'), 'Айжан')
  await userEvent.type(within(panel).getByLabelText('Телефон'), '555 000 111')
  // Время не подставлено — выбрать в сетке свободного
  await userEvent.click(await within(panel).findByRole('button', { name: '23:00' }))
  await userEvent.click(within(panel).getByRole('button', { name: 'Записать' }))

  expect(await within(panel).findByText(/Пациент с этим номером уже есть: Айжан Б\./)).toBeInTheDocument()
  expect(phone).toBe('+996 555 000 111')
  await userEvent.click(within(panel).getByRole('button', { name: 'Выбрать его' }))
  await userEvent.click(within(panel).getByRole('button', { name: 'Записать' }))
  expect(await screen.findByRole('complementary', { name: 'Карточка приёма' })).toHaveTextContent('Айжан Б.')
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

test('из карточки приёма — медкарта пациента и обратно к этому приёму', async () => {
  backend([appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', version: 1 })])
  server.use(
    http.get('*/api/patients/:id/teeth', () => HttpResponse.json([])),
    http.get('*/api/patients/:id/plan', () => HttpResponse.json([])),
    http.get('*/api/patients/:id/files', () => HttpResponse.json([])),
  )
  renderApp()
  const panel = await open(/Бакыт М\./)
  await userEvent.click(within(panel).getByRole('button', { name: 'Карта зубов и план лечения' }))
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
  await userEvent.click(within(panel).getByRole('button', { name: 'Записать' }))

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
  expect(await within(panel).findByRole('button', { name: 'Приём состоялся' })).toBeInTheDocument()
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
  const chips = () => within(panel).getByRole('group', { name: 'Услуга' })
  await within(panel).findByRole('group', { name: 'Услуга' })
  expect(within(chips()).getAllByRole('button')).toHaveLength(1)
  expect(within(chips()).getByRole('button', { name: /Удаление зуба/ })).toBeInTheDocument()

  // У врача 1 услуги не выбраны — все услуги клиники
  await choose(within(panel).getByLabelText('Врач'), '1')
  await userEvent.click(within(chips()).getByRole('button', { name: /Чистка/ }))
  expect(within(chips()).getByRole('button', { name: /Чистка/ })).toHaveAttribute('aria-pressed', 'true')

  // Обратно к врачу 2: «Чистку» он не оказывает — её нет, выбор снят
  await choose(within(panel).getByLabelText('Врач'), '2')
  expect(within(chips()).queryByRole('button', { name: /Чистка/ })).not.toBeInTheDocument()
  expect(within(chips()).getByRole('button', { name: /Удаление зуба/ })).toHaveAttribute('aria-pressed', 'false')
})
