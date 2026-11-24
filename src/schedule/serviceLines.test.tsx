import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, openPay, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'
import { waitForSlow } from '../test/wait'

type Appointment = Schemas['AppointmentView']
type Line = Schemas['ServiceLine']

// Несколько услуг в приёме и «правка закрытого приёма в течение дня» (шаг 5А). Пациенты и услуги — вымышленные
const SERVICES: Schemas['ServiceTypeView'][] = [
  { id: 1, name: 'Профгигиена', durationMinutes: 60, active: true, priceSom: 3000, group: 'HYGIENE' },
  { id: 2, name: 'Лечение кариеса', durationMinutes: 45, active: true, priceSom: 6000, group: 'THERAPY' },
  { id: 3, name: 'Снимок', durationMinutes: 15, active: true, group: 'EXAM' },
]

const line = (id: number, serviceTypeId: number, name: string, priceSom: number, qty = 1, teeth: number[] = []): Line =>
  ({ id, serviceTypeId, name, priceSom, qty, teeth, amountSom: priceSom * qty })

/** Скидка строки (V258), как считает сервер: процент от цены × количество или сумма; итог — netSom. */
function withOff(l: Line, d?: { percent?: number; som?: number }): Line {
  const off = !d ? 0 : d.som ?? (d.percent ? Math.round(((l.amountSom ?? 0) * d.percent) / 100) : 0)
  return off ? { ...l, discountSom: off, discountPercent: d?.percent, netSom: (l.amountSom ?? 0) - off } : l
}

/** Сервер строк, как AppointmentLines: главная — первая строка, сумма — цена × количество. */
function backend(a: Appointment, who: Schemas['BookingViewsMe'] = me) {
  let current = a
  const sent: unknown[] = []
  const withLines = (lines: Line[]) => {
    const priced = lines.filter((l) => l.amountSom != null)
    current = {
      ...current, services: lines, serviceName: lines[0]?.name,
      servicesTotalSom: priced.length ? priced.reduce((s, l) => s + (l.netSom ?? l.amountSom ?? 0), 0) : undefined, version: current.version + 1,
    }
    return HttpResponse.json(current)
  }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/service-types', () => HttpResponse.json(SERVICES)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(
      Number(new URL(request.url).searchParams.get('doctorId')) === current.doctorId ? [current] : [])),
    http.get('*/api/appointments/:id/payments', () => HttpResponse.json([])),
    http.post('*/api/appointments/:id/services', async ({ request }) => {
      const b = await request.json() as Schemas['AppointmentRequestsAddLine']
      sent.push({ add: b })
      const s = SERVICES.find((x) => x.id === b.serviceTypeId)!
      return withLines([...(current.services ?? []), line(100 + (current.services?.length ?? 0), s.id, s.name, s.priceSom ?? 0)])
    }),
    http.put('*/api/appointments/:id/services/:lineId', async ({ request, params }) => {
      const b = await request.json() as Schemas['AppointmentRequestsUpdateLine']
      sent.push({ update: Number(params.lineId), ...b })
      return withLines((current.services ?? []).map((l) => (l.id === Number(params.lineId)
        ? withOff(line(l.id, l.serviceTypeId!, l.name, b.priceSom ?? l.priceSom ?? 0, b.qty ?? l.qty, b.teeth ?? l.teeth), b.discount) : l)))
    }),
    http.delete('*/api/appointments/:id/services/:lineId', ({ params }) => {
      sent.push({ remove: Number(params.lineId) })
      return withLines((current.services ?? []).filter((l) => l.id !== Number(params.lineId)))
    }),
    http.put('*/api/appointments/:id/promo-code', async ({ request }) => {
      const b = await request.json() as { promoCode: string }
      sent.push({ promo: b.promoCode })
      current = { ...current, promoCode: b.promoCode || undefined, version: current.version + 1 }
      return HttpResponse.json(current)
    }),
  )
  return sent
}

async function card(name: RegExp) {
  await userEvent.click(await screen.findByRole('button', { name }))
  return screen.getByRole('complementary', { name: 'Карточка приёма' })
}

test('«Услуги» в карточке: строка с зубами и количеством, «изменить», ✕ и «＋ Услуга»; в дне — «Профгигиена +1»', async () => {
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', {
    version: 1, serviceName: 'Профгигиена',
    services: [line(1, 1, 'Профгигиена', 3000), line(2, 2, 'Лечение кариеса', 6000, 2, [36, 37])], servicesTotalSom: 15000,
  }))
  renderApp()
  expect(await screen.findByText('Профгигиена +1')).toBeInTheDocument()
  const panel = await card(/Бакыт М\./)
  const block = within(panel).getByLabelText('Услуги')
  expect(block).toHaveTextContent(/Лечение кариеса · 36, 37 ·\s×\s2 ·\s12\s000 сом/)
  expect(block).toHaveTextContent(/итого 15\s000 сом/)

  await userEvent.click(within(block).getByRole('button', { name: 'Изменить: Лечение кариеса' }))
  const edit = within(block).getByRole('form', { name: 'Услуга: Лечение кариеса' })
  const teeth = within(edit).getByLabelText('Зубы')
  await userEvent.clear(teeth)
  await userEvent.type(teeth, '36, 37, 46')
  // Вписали три зуба — количество 3
  expect(within(edit).getByRole('group', { name: 'Количество' })).toHaveTextContent('3')
  await userEvent.click(within(edit).getByRole('button', { name: 'Сохранить' }))
  expect(await within(block).findByText(/×\s3/)).toBeInTheDocument()

  await userEvent.click(within(block).getByRole('button', { name: 'Убрать: Профгигиена' }))
  expect(await within(block).findByText(/^Лечение кариеса$/)).toBeInTheDocument()
  // Цену не трогали — её и скидку не шлём: сервер оставит как было
  expect(sent).toEqual([{ update: 2, teeth: [36, 37, 46], qty: 3 }, { remove: 1 }])
})

test('прошлый состоявшийся приём: врачу — «🔒 изменить может руководитель», без правки услуг', async () => {
  const doctor = { ...me, admin: false }
  backend(appointment(10, 1, '10:00', 'Бакыт М.', {
    version: 1, status: 'DONE', paidSom: 3000, chargeSom: 3000, serviceName: 'Профгигиена',
    services: [line(1, 1, 'Профгигиена', 3000)], servicesTotalSom: 3000, lockedForDoctors: true,
  }), doctor)
  renderApp()
  const panel = await card(/Бакыт М\./)
  const block = within(panel).getByLabelText('Услуги')
  expect(block).toHaveTextContent('🔒 изменить может руководитель')
  expect(within(block).queryByRole('button', { name: '＋ Услуга' })).not.toBeInTheDocument()
  expect(within(block).queryByRole('button', { name: /Изменить:/ })).not.toBeInTheDocument()
})

test('руководитель меняет и прошлый приём: «＋ Услуга» добавляет строку', async () => {
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', {
    version: 1, status: 'DONE', serviceName: 'Профгигиена', services: [line(1, 1, 'Профгигиена', 3000)], servicesTotalSom: 3000, lockedForDoctors: true,
  }))
  renderApp()
  const panel = await card(/Бакыт М\./)
  const block = within(panel).getByLabelText('Услуги')
  expect(block).not.toHaveTextContent('🔒')
  await userEvent.click(within(block).getByRole('button', { name: '＋ Услуга' }))
  await userEvent.click(within(block).getByRole('combobox', { name: 'Добавить услугу' }))
  await userEvent.click(within(screen.getByRole('listbox')).getAllByRole('option', { name: /Лечение кариеса/ })[0]!)
  expect(await within(block).findByText(/итого 9\s000 сом/)).toBeInTheDocument()
  expect(sent).toEqual([{ add: { serviceTypeId: 2 } }])
})

test('оплата: услуги и «По услугам», цена до скидки — их сумма; промокод со скидкой подставляет скидку и виден в строке оплаты', async () => {
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', {
    version: 1, status: 'DONE', serviceName: 'Профгигиена',
    services: [line(1, 1, 'Профгигиена', 3000), line(2, 2, 'Лечение кариеса', 6000, 2, [36, 37])], servicesTotalSom: 15000,
  }))
  server.use(
    http.get('*/api/promo-codes', () => HttpResponse.json([{ id: 1, code: 'ZUBY10', active: true, discountPercent: 10, appointments: 0 }])),
    http.get('*/api/clinic/discounts', () => HttpResponse.json({ who: 'ADMIN', maxPercent: 10, canGive: true, myMaxPercent: 100 })),
  )
  renderApp()
  const panel = await card(/Бакыт М\./)
  const form = await openPay(panel)
  const lines = within(form).getByLabelText('Услуги приёма')
  expect(lines).toHaveTextContent(/Лечение кариеса · 36, 37\s×\s2\s*12\s000 сом/)
  expect(lines).toHaveTextContent(/По услугам\s*15\s000 сом/)
  expect(within(form).getByLabelText('Сумма, сом')).toHaveValue(15000)

  await userEvent.click(within(form).getByRole('combobox', { name: 'Промокод' }))
  await userEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /ZUBY10/ }))
  const discount = await within(form).findByRole('group', { name: 'Скидка' })
  expect(within(discount).getByLabelText('Скидка, %')).toHaveValue(10)
  expect(within(discount).getByLabelText('Итог со скидкой')).toHaveTextContent(/К оплате 13\s500 сом/)
  expect(sent).toEqual([{ promo: 'ZUBY10' }])
})

test('новая запись: две услуги — чипы, длительность и подсказка суммы складываются, на сервер — serviceTypeIds', async () => {
  let body: Record<string, unknown> = {}
  server.use(
    http.get('*/api/service-types', () => HttpResponse.json(SERVICES)),
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/patients/recent', () => HttpResponse.json([{ id: 50, fullName: 'Айжан Вымышленная', phone: '996555000050', telegram: false }])),
    http.post('*/api/appointments', async ({ request }) => {
      body = await request.json() as Record<string, unknown>
      return HttpResponse.json(appointment(77, 1, '15:00', 'Айжан Вымышленная'), { status: 201 })
    }),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: '＋ Новая запись' }))
  const form = await screen.findByRole('complementary', { name: 'Новая запись' })
  await userEvent.click(await within(form).findByRole('button', { name: /Айжан Вымышленная/ }))
  for (const name of [/Профгигиена/, /Лечение кариеса/]) {
    await userEvent.click(within(form).getByRole('combobox', { name: 'Услуга' }))
    await userEvent.click(within(screen.getByRole('listbox')).getAllByRole('option', { name })[0]!)
  }
  expect(within(form).getByRole('list', { name: 'Выбранные услуги' })).toHaveTextContent(/Профгигиена.*Лечение кариеса/)
  expect(within(form).getByTestId('services-sum')).toHaveTextContent(/2 услуги · 1 ч 45 мин · от 9\s000 сом/)
  expect(within(form).getByLabelText('Длительность, мин')).toHaveValue(105)
  await userEvent.click(within(form).getByRole('button', { name: /⚡ Сейчас/ }))
  await userEvent.click(within(form).getByRole('button', { name: /^Начать приём|^Записать/ }))
  await waitForSlow(() => expect(body.serviceTypeIds).toEqual([1, 2]))
  expect(body).toMatchObject({ serviceTypeId: 1, durationMinutes: 105 })
})

test('«Настройки → Правка приёмов»: руководитель выбирает «Всегда» — PUT /api/clinic/visit-edit', async () => {
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/clinic/visit-edit', () => HttpResponse.json({ doctorWindow: 'SAME_DAY' })),
    http.put('*/api/clinic/visit-edit', async ({ request }) => {
      const body = await request.json() as Schemas['VisitEditControllerSetting']
      sent.push(body)
      return HttpResponse.json(body)
    }),
  )
  window.location.hash = '/settings/visit-edit'
  renderApp()
  const group = await screen.findByRole('radiogroup', { name: 'Врач может менять состоявшийся приём' })
  expect(within(group).getByRole('radio', { name: /Только в день приёма/ })).toBeChecked()
  await userEvent.click(within(group).getByRole('radio', { name: /Всегда/ }))
  expect(await screen.findByRole('status')).toHaveTextContent('Сохранено')
  expect(sent).toEqual([{ doctorWindow: 'ALWAYS' }])
  window.location.hash = ''
})

test('новая запись: длительность вручную (коронки на 3 зуба — 90 мин) не перетирается выбором услуг; «Вернуть» — по услугам', async () => {
  let body: Record<string, unknown> = {}
  server.use(
    http.get('*/api/service-types', () => HttpResponse.json(SERVICES)),
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/patients/recent', () => HttpResponse.json([{ id: 50, fullName: 'Айжан Вымышленная', phone: '996555000050', telegram: false }])),
    http.post('*/api/appointments', async ({ request }) => {
      body = await request.json() as Record<string, unknown>
      return HttpResponse.json(appointment(77, 1, '15:00', 'Айжан Вымышленная'), { status: 201 })
    }),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: '＋ Новая запись' }))
  const form = await screen.findByRole('complementary', { name: 'Новая запись' })
  await userEvent.click(await within(form).findByRole('button', { name: /Айжан Вымышленная/ }))
  const pick = async (name: RegExp) => {
    await userEvent.click(within(form).getByRole('combobox', { name: 'Услуга' }))
    await userEvent.click(within(screen.getByRole('listbox')).getAllByRole('option', { name })[0]!)
  }
  await pick(/Профгигиена/)
  // Врач ставит сам: 90 минут (из списка)
  await choose(within(form).getByLabelText('Длительность'), '90 мин')
  // Ещё услуга — длительность остаётся 90, рядом подсказка «По услугам — …» и «Вернуть»
  await pick(/Лечение кариеса/)
  expect(within(form).getByText(/^По услугам — 1 ч 45 мин\./)).toBeInTheDocument()
  await userEvent.click(within(form).getByRole('button', { name: /⚡ Сейчас/ }))
  await userEvent.click(within(form).getByRole('button', { name: /^Начать приём|^Записать/ }))
  await waitForSlow(() => expect(body).toMatchObject({ durationMinutes: 90 }))
})

test('новая запись: «Вернуть» — снова длительность по услугам, и дальше она снова считается сама', async () => {
  server.use(
    http.get('*/api/service-types', () => HttpResponse.json(SERVICES)),
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/patients/recent', () => HttpResponse.json([{ id: 50, fullName: 'Айжан Вымышленная', phone: '996555000050', telegram: false }])),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: '＋ Новая запись' }))
  const form = await screen.findByRole('complementary', { name: 'Новая запись' })
  await userEvent.click(await within(form).findByRole('button', { name: /Айжан Вымышленная/ }))
  const pick = async (name: RegExp) => {
    await userEvent.click(within(form).getByRole('combobox', { name: 'Услуга' }))
    await userEvent.click(within(screen.getByRole('listbox')).getAllByRole('option', { name })[0]!)
  }
  await pick(/Профгигиена/)
  await pick(/Лечение кариеса/)
  const field = () => within(form).getByLabelText('Длительность, мин')
  await userEvent.clear(field())
  await userEvent.type(field(), '120')
  await userEvent.click(within(form).getByRole('button', { name: 'Вернуть' }))
  expect(field()).toHaveValue(105)
  expect(within(form).queryByText(/^По услугам —/)).not.toBeInTheDocument()
})

test('услуги не помещаются в приём (кариес × 2 = 90 мин, приём 30) — «Услуги займут … · Продлить до …» → перенос с той же даты на 90 мин', async () => {
  const a = appointment(10, 1, '10:00', 'Бакыт М.', { version: 1, serviceName: 'Лечение кариеса', services: [line(2, 2, 'Лечение кариеса', 6000, 2, [36, 37])] })
  backend({ ...a, endAt: new Date(Date.parse(a.startAt) + 30 * 60_000).toISOString() })
  const moved: Schemas['AppointmentRequestsReschedule'][] = []
  server.use(http.post('*/api/appointments/:id/reschedule', async ({ request }) => {
    const b = await request.json() as Schemas['AppointmentRequestsReschedule']
    moved.push(b)
    return HttpResponse.json({ ...a, endAt: new Date(Date.parse(a.startAt) + 90 * 60_000).toISOString(), version: 2 })
  }))
  renderApp()
  const panel = await card(/Бакыт М\./)
  const note = (await within(panel).findByText(/Услуги займут/)).closest('p')!
  expect(note).toHaveTextContent(/Услуги займут 1 ч 30 мин, а приём — 30 мин\./)
  await userEvent.click(within(note).getByRole('button', { name: /^Продлить до 11:30$/ }))
  await waitForSlow(() => expect(moved).toEqual([expect.objectContaining({ startAt: a.startAt, durationMinutes: 90, version: 1 })]))
})

test('«＋ Услуга» той же услугой ещё раз — «× 2» в той же строке, а не вторая строка', async () => {
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', { version: 1, serviceName: 'Профгигиена', services: [line(1, 1, 'Профгигиена', 3000)] }))
  renderApp()
  const panel = await card(/Бакыт М\./)
  const block = within(panel).getByLabelText('Услуги')
  await userEvent.click(within(block).getByRole('button', { name: '＋ Услуга' }))
  await userEvent.click(within(block).getByRole('combobox', { name: 'Добавить услугу' }))
  await userEvent.click(within(screen.getByRole('listbox')).getAllByRole('option', { name: /Профгигиена/ })[0]!)
  await waitForSlow(() => expect(sent).toEqual([{ update: 1, qty: 2 }]))
  expect(await within(block).findByText(/×\s2/)).toBeInTheDocument()
  expect(within(block).getAllByRole('listitem')).toHaveLength(1)
})

test('скидка строки (V258): цена за коронку 7 000 → 6 000 × 4 — скидка 4 000 на строку; в строке — зачёркнутая сумма', async () => {
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', {
    version: 1, serviceName: 'Коронка', services: [line(1, 2, 'Коронка', 7000, 4, [14, 15, 24, 25])], servicesTotalSom: 28000,
  }))
  renderApp()
  const panel = await card(/Бакыт М\./)
  const block = within(panel).getByLabelText('Услуги')
  await userEvent.click(within(block).getByRole('button', { name: 'Изменить: Коронка' }))
  const edit = within(block).getByRole('form', { name: 'Услуга: Коронка' })
  const price = within(edit).getByRole('spinbutton', { name: 'Цена за единицу, сом' })
  await userEvent.clear(price)
  await userEvent.type(price, '6000')
  expect(within(edit).getByRole('note', { name: 'Скидка этапа' })).toHaveTextContent(/7\s000 сом → 6\s000 сом, скидка 1\s000 сом/)
  expect(edit).toHaveTextContent(/Скидка на строку: 4\s000 сом \(× 4\)/)
  await userEvent.click(within(edit).getByRole('button', { name: 'Сохранить' }))
  expect(sent).toContainEqual({ update: 1, teeth: [14, 15, 24, 25], qty: 4, priceSom: 7000, discount: { som: 4000 } })
  await waitForSlow(() => expect(within(panel).getByLabelText('Услуги')).toHaveTextContent(/28\s000 сом\s*24\s000 сом\s*\(скидка 4\s000 сом\)/))
})

test('оплата со скидками строк (V258): строка зачёркнута, «Скидка по услугам», цена — сумма уже со скидками', async () => {
  backend(appointment(10, 1, '10:00', 'Бакыт М.', {
    version: 1, status: 'DONE', serviceName: 'Коронка',
    services: [{ ...line(1, 2, 'Коронка', 7000, 4, [14, 15, 24, 25]), discountSom: 4000, netSom: 24000 },
      { ...line(2, 2, 'Лечение кариеса', 4000, 1, [36]), discountSom: 2000, discountPercent: 50, netSom: 2000 }],
    servicesTotalSom: 26000,
  }))
  renderApp()
  const panel = await card(/Бакыт М\./)
  const form = await openPay(panel)
  const lines = within(form).getByLabelText('Услуги приёма')
  expect(lines).toHaveTextContent(/Коронка · 14, 15, 24, 25\s×\s4\s*28\s000 сом\s*24\s000 сом/)
  expect(within(lines).getByRole('note')).toHaveTextContent(/Скидка по услугам: −6\s000 сом — уже в сумме/)
  expect(lines).toHaveTextContent(/По услугам со скидкой\s*26\s000 сом/)
  expect(within(form).getByLabelText('Сумма, сом')).toHaveValue(26000)
})
