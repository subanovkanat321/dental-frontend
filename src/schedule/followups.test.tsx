import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Appointment = Schemas['AppointmentView']

afterEach(() => {
  window.location.hash = ''
  vi.restoreAllMocks()
})

function day(list: Appointment[], who: Schemas['BookingViewsMe'] = me) {
  const asked: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/appointments', ({ request }) => {
      asked.push('day')
      const doctorId = Number(new URL(request.url).searchParams.get('doctorId'))
      return HttpResponse.json(list.filter((a) => a.doctorId === doctorId))
    }),
    http.get('*/api/appointments/to-pay', () => {
      asked.push('to-pay')
      return HttpResponse.json([])
    }),
  )
  return asked
}

async function card(name: RegExp) {
  await userEvent.click(await screen.findByRole('button', { name }))
  return screen.getByRole('complementary', { name: 'Карточка приёма' })
}

test('«независимый» админ-врач: у приёма коллеги нет оплаты и предоплаты, у своего — есть', async () => {
  // Админ со своим приёмом (врач 1) в «независимом» кабинете: деньги коллеги (врач 2) не видит
  const independent = { ...me, hasReception: true, doctorId: 1, platform: false, clinic: { ...me.clinic, independentDoctors: true } }
  const asked = day([appointment(10, 2, '10:00', 'Бакыт М.', { status: 'DONE', version: 1 })], independent)
  renderApp()
  const panel = await card(/Бакыт М\./)
  expect(within(panel).getByText('Приём состоялся')).toBeInTheDocument()
  expect(within(panel).queryByRole('form', { name: 'Оплата' })).not.toBeInTheDocument()
  expect(within(panel).queryByText(/Оплата|к оплате/i)).not.toBeInTheDocument()
  // «Ждут оплаты» — своя очередь врача (сервер отдаёт только его приёмы)
  expect(asked).toContain('day')
})

test('свой приём у врача — форма оплаты есть; у коллеги на «Все врачи» — нет предоплаты', async () => {
  const doctor = { ...me, admin: false }
  day([appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', version: 1 }), appointment(11, 2, '23:30', 'Нурлан К.')], doctor)
  renderApp()
  expect(within(await card(/Бакыт М\./)).getByRole('form', { name: 'Оплата' })).toBeInTheDocument()
  const other = await card(/Нурлан К\./)
  expect(within(other).queryByRole('button', { name: 'Попросить предоплату' })).not.toBeInTheDocument()
})

test('удалить приём с оплатой нельзя — подсказка вместо кнопки; без денег — 409 has-records показывает текст сервера', async () => {
  day([
    appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', version: 1, paidSom: 2000, paymentMethod: 'CASH' }),
    appointment(11, 1, '12:00', 'Нурлан К.', { status: 'DONE', version: 1 }),
  ])
  server.use(http.delete('*/api/appointments/11', () => HttpResponse.json({
    status: 409, code: 'has-records', detail: 'У приёма есть заметка или оплата — отмените его вместо удаления',
  }, { status: 409 })))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  renderApp()
  const paid = await card(/Бакыт М\./)
  expect(within(paid).queryByRole('button', { name: 'Удалить запись' })).not.toBeInTheDocument()
  expect(paid).toHaveTextContent(/Удалить нельзя: у приёма есть оплата 2\s000 сом/)
  const empty = await card(/Нурлан К\./)
  await userEvent.click(within(empty).getByRole('button', { name: 'Удалить запись' }))
  expect(await within(empty).findByRole('alert')).toHaveTextContent('отмените его вместо удаления')
})

test('есть доплаты — «Изменить» оплату не предлагаем', async () => {
  day([appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', version: 1, paidSom: 3000, chargeSom: 5000, debtSom: 2000, paymentMethod: 'CASH' })])
  server.use(http.get('*/api/appointments/:id/payments', () => HttpResponse.json([
    { amountSom: 1000, method: 'CASH', paidAt: '2026-10-01T05:00:00Z' }, { amountSom: 2000, method: 'CASH', paidAt: '2026-10-15T05:00:00Z' },
  ] satisfies Schemas['PaymentQueryEntry'][])))
  renderApp()
  const panel = await card(/Бакыт М\./)
  expect(await within(panel).findByText(/Есть доплаты/)).toBeInTheDocument()
  expect(within(panel).queryByRole('button', { name: 'Изменить' })).not.toBeInTheDocument()
  expect(within(panel).getByRole('button', { name: 'Принять доплату' })).toBeInTheDocument()
})

test('409 stale — текст сервера и расписание перечитывается', async () => {
  const asked = day([appointment(10, 1, '23:30', 'Бакыт М.')])
  server.use(http.post('*/api/appointments/:id/status', () => HttpResponse.json({
    status: 409, code: 'stale', detail: 'Данные только что изменились — обновите экран',
  }, { status: 409 })))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  renderApp()
  const panel = await card(/Бакыт М\./)
  const before = asked.filter((x) => x === 'day').length
  await userEvent.click(within(panel).getByRole('button', { name: 'Отменить запись' }))
  expect(await within(panel).findByRole('alert')).toHaveTextContent('Данные только что изменились')
  await vi.waitFor(() => expect(asked.filter((x) => x === 'day').length).toBeGreaterThan(before))
})

test('регистратура: «Услуги» только списком — без «Добавить» и справочника', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, reception: true, doctorId: undefined })),
    http.get('*/api/service-types', () => HttpResponse.json([{ id: 5, name: 'Чистка', durationMinutes: 60, active: true, priceSom: 3000 }])),
  )
  window.location.hash = '/settings/services'
  renderApp()
  expect(await screen.findByRole('cell', { name: 'Чистка' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '+ Добавить услугу' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Из справочника' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Чистка' })).not.toBeInTheDocument()
})

test('ассистент: пациент чужого врача — без «Изменить данные» и листа ожидания', async () => {
  const assistant = { ...me, admin: false, doctorId: undefined, fullName: 'Асель', assistantOf: [2] }
  const visit = appointment(50, 1, '10:00', 'Айгуль Т.', { status: 'DONE' })
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(assistant)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/patients/recent', () => HttpResponse.json([{ id: 2, fullName: 'Айгуль Т.', phone: '996700333444' }])),
    http.get('*/api/appointments/by-patient/2', () => HttpResponse.json({ patient: { id: 2, fullName: 'Айгуль Т.' }, done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [visit] })),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
  )
  window.location.hash = '/patients'
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Айгуль Т.' }))
  const panel = await screen.findByRole('complementary', { name: 'Карточка пациента' })
  expect(await within(panel).findByRole('button', { name: '＋ Записать' })).toBeInTheDocument()
  expect(within(panel).queryByRole('button', { name: 'Изменить данные пациента' })).not.toBeInTheDocument()
  expect(within(panel).queryByRole('form', { name: 'В лист ожидания' })).not.toBeInTheDocument()
})
