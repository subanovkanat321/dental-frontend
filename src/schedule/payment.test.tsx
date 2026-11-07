import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, renderApp, openMore, openPay } from '../test/fixtures'
import { addDays, todayIn } from '../lib/time'
import { pickDate } from '../test/date'
import { choose } from '../test/select'
import { server } from '../test/server'

type Appointment = Schemas['AppointmentView']

/** Один приём на сервере; любое действие с оплатой запоминается и возвращает приём с правками. */
function backend(a: Appointment, after: (path: string, body: Record<string, unknown>) => Partial<Appointment>,
  extra: { payments?: Schemas['PaymentQueryEntry'][]; who?: Schemas['BookingViewsMe'] } = {}) {
  let current = a
  const sent: { path: string; body: unknown }[] = []
  const reply = async (path: string, request: Request) => {
    const body = (await request.json()) as Record<string, unknown>
    sent.push({ path, body })
    // Как на сервере: деньги версию приёма не меняют
    current = { ...current, ...after(path, body) }
    return HttpResponse.json(current)
  }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(extra.who ?? me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(
      Number(new URL(request.url).searchParams.get('doctorId')) === current.doctorId ? [current] : [])),
    http.get('*/api/appointments/:id/payments', () => HttpResponse.json(extra.payments ?? [])),
    http.get('*/api/service-types', () => HttpResponse.json([
      { id: 1, name: 'Пломба', active: true, priceSom: 3000 },
      { id: 2, name: 'Чистка', active: true, priceSom: 2000 },
      { id: 3, name: 'Старое', active: false, priceSom: 100 },
    ])),
    http.post('*/api/appointments/:id/payment', ({ request }) => reply('payment', request)),
    http.post('*/api/appointments/:id/payment/:kind', ({ request, params }) => reply(String(params.kind), request)),
  )
  return sent
}

async function card() {
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  return screen.getByRole('complementary', { name: 'Карточка приёма' })
}

test('оплата по шагам: стоимость из цен услуг, «часть, остальное потом» — долг и срок, «разными способами»', async () => {
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', version: 1 }),
    (_, b) => ({ paidSom: b.amountSom as number, chargeSom: b.chargeSom as number, debtSom: (b.chargeSom as number) - (b.amountSom as number), dueOn: b.dueOn as string }))
  renderApp()
  const panel = await card()
  const form = await openPay(panel)
  // 1. Стоимость: цены услуг складываются
  // Прайс — одним списком, а не кнопками на полэкрана
  const price = await within(form).findByRole('combobox', { name: 'Цена из прайса' })
  await choose(price, 'Пломба · 3 000 сом')
  await choose(within(form).getByRole('combobox', { name: 'Цена из прайса' }), 'Чистка · 2 000 сом')
  expect(within(form).getByLabelText('Сумма, сом')).toHaveValue(5000)
  expect(within(form).getByText('Из прайса: Пломба + Чистка')).toBeInTheDocument()
  expect(within(form).getByRole('button', { name: /Всё сразу · 5\s000 сом/ })).toHaveAttribute('aria-pressed', 'true')

  // 2. Часть сейчас — остальное видно сразу, срок по желанию
  await userEvent.click(within(form).getByRole('button', { name: 'Часть, остальное потом' }))
  await userEvent.type(within(form).getByLabelText('Заплатил сейчас, сом'), '2500')
  expect(within(form).getByText(/Остальное потом:/)).toHaveTextContent(/2\s500 сом/)
  const due = addDays(todayIn(), 40)
  await pickDate(within(form).getByLabelText(/Доплатит до/), due)

  // 3. Разными способами — сумма по каждому, пока не сойдётся
  await userEvent.click(within(form).getByRole('button', { name: 'Разными способами' }))
  await userEvent.type(within(form).getByLabelText('Наличными, сом'), '1000')
  expect(within(form).getByText(/Распределено 1\s000 сом из 2\s500 сом/)).toBeInTheDocument()
  await userEvent.click(within(form).getByRole('button', { name: /^Сохранить оплату/ }))
  expect(within(form).getByRole('alert')).toHaveTextContent('поправьте суммы')
  await userEvent.type(within(form).getByLabelText('Переводом, сом'), '1500')
  expect(within(form).getByText(/Сходится/)).toBeInTheDocument()
  await userEvent.click(within(form).getByRole('button', { name: /^Сохранить оплату · 2\s500 сом/ }))

  expect(await within(panel).findByText(/Долг 2\s500 сом · доплатит до/)).toBeInTheDocument()
  expect(sent).toEqual([{ path: 'payment', body: {
    amountSom: 2500, method: 'CASH', chargeSom: 5000, dueOn: due,
    parts: [{ amountSom: 1000, method: 'CASH' }, { amountSom: 1500, method: 'TRANSFER' }],
  } }])
  expect(within(panel).getByRole('button', { name: 'Принять доплату' })).toBeInTheDocument()
})

test('«часть»: заплатил не меньше стоимости — подсказка «выберите Всё сразу», запрос не уходит', async () => {
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', servicePriceSom: 2000, version: 1 }), () => ({}))
  renderApp()
  const form = await openPay(await card())
  await userEvent.click(within(form).getByRole('button', { name: 'Часть, остальное потом' }))
  await userEvent.type(within(form).getByLabelText('Заплатил сейчас, сом'), '2000')
  await userEvent.click(within(form).getByRole('button', { name: /^Сохранить оплату/ }))
  expect(within(form).getByRole('alert')).toHaveTextContent('выберите «Всё сразу»')
  expect(sent).toEqual([])
})

test('оплачено разными способами: история, «Изменить» открывает форму с суммами по способам', async () => {
  backend(appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', paidSom: 5000, paymentMethod: 'CASH', version: 2 }), () => ({}), {
    payments: [{ id: 1, amountSom: 3000, method: 'CASH' }, { id: 2, amountSom: 2000, method: 'TRANSFER' }],
  })
  renderApp()
  const panel = await card()
  expect(await within(panel).findByText(/^наличные 3\s000 сом \+ перевод 2\s000 сом$/)).toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: 'Изменить' }))
  const form = await openPay(panel)
  expect(within(form).getByLabelText('Сумма, сом')).toHaveValue(5000)
  expect(within(form).getByRole('button', { name: 'Разными способами' })).toHaveAttribute('aria-pressed', 'true')
  expect(within(form).getByLabelText('Наличными, сом')).toHaveValue(3000)
  expect(within(form).getByLabelText('Переводом, сом')).toHaveValue(2000)
  await userEvent.click(within(form).getByRole('button', { name: 'Отмена' }))
  expect(within(panel).queryByRole('form', { name: 'Оплата' })).not.toBeInTheDocument()
})

test('после предоплаты — указать стоимость, остаток становится долгом', async () => {
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', {
    status: 'DONE', paidSom: 1000, paymentMethod: 'TRANSFER', depositStatus: 'RECEIVED', depositSom: 1000, servicePriceSom: 4000, version: 1,
  }), (_, b) => ({ chargeSom: b.chargeSom as number, debtSom: (b.chargeSom as number) - 1000 }))
  renderApp()
  const panel = await card()
  await userEvent.click(await within(panel).findByRole('button', { name: 'Указать стоимость и принять остаток' }))
  await userEvent.click(within(panel).getByRole('button', { name: 'Дальше — остаток' }))
  expect(await within(panel).findByText(/1\s000 сом из 4\s000 сом/)).toBeInTheDocument()
  expect(sent).toEqual([{ path: 'charge', body: { chargeSom: 4000 } }])
  expect(within(panel).getByText(/^Долг 3\s000 сом$/)).toBeInTheDocument()
})

test('долг закрыт — «Оплачено полностью»; врач правит сумму на кассу', async () => {
  backend(appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', paidSom: 4000, chargeSom: 4000, debtSom: 0, version: 1 }), () => ({}))
  renderApp()
  expect(await within(await card()).findByText(/Оплачено полностью/)).toBeInTheDocument()
})

test('на кассе: врач меняет сумму счёта', async () => {
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', chargeSom: 4000, version: 1 }),
    (_, b) => ({ chargeSom: b.chargeSom as number }), { who: { ...me, admin: false, hasReception: true } })
  renderApp()
  const panel = await card()
  await userEvent.click(await within(panel).findByRole('button', { name: 'Изменить сумму' }))
  const form = within(panel).getByRole('form', { name: 'Сумма на кассу' })
  await userEvent.clear(within(form).getByLabelText('Сумма, сом'))
  await userEvent.type(within(form).getByLabelText('Сумма, сом'), '4500')
  await userEvent.click(within(form).getByRole('button', { name: /На кассу/ }))
  expect(await within(panel).findByText(/К оплате на кассе: 4\s500 сом/)).toBeInTheDocument()
  expect(sent).toEqual([{ path: 'bill', body: { chargeSom: 4500 } }])
})

test('«Снять отметку оплаты» — отдельной кнопкой и только после вопроса', async () => {
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', version: 1, paidSom: 1500, paymentMethod: 'CASH' }),
    (_, b) => ({ paidSom: b.amountSom as number | undefined }))
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  renderApp()
  const panel = await card()
  await userEvent.click(within(panel).getByRole('button', { name: 'Изменить' }))
  const form = await openPay(panel)
  await userEvent.click(within(form).getByRole('button', { name: 'Снять отметку оплаты' }))
  expect(confirm).toHaveBeenLastCalledWith(expect.stringMatching(/Снять отметку оплаты 1\s500 сом/))
  expect(sent).toEqual([])
  await userEvent.click(within(form).getByRole('button', { name: 'Снять отметку оплаты' }))
  await vi.waitFor(() => expect(sent).toEqual([{ path: 'payment', body: { method: 'CASH' } }]))
  confirm.mockRestore()
})

test('карточка приёма: «Расход по пациенту (техник)» — расход на врача приёма', async () => {
  backend(appointment(10, 2, '10:00', 'Бакыт М.', { status: 'DONE', version: 1 }), () => ({}))
  let expense: Record<string, unknown> | null = null
  server.use(
    http.get('*/api/patients/:id/expenses', () => HttpResponse.json(expense ? [{ id: 1, ...expense }] : [])),
    http.post('*/api/expenses', async ({ request }) => {
      expense = (await request.json()) as Record<string, unknown>
      return HttpResponse.json({ id: 1, ...expense }, { status: 201 })
    }),
  )
  renderApp()
  const panel = await card()
  // Расход техника — редкое, под «Ещё»
  await openMore(panel)
  await userEvent.click(await within(panel).findByRole('button', { name: '💸 Расход по пациенту (техник)' }))
  const form = within(panel).getByRole('form', { name: 'Расход по пациенту' })
  await userEvent.type(within(form).getByLabelText('Сумма, сом'), '4500')
  await userEvent.type(within(form).getByLabelText(/Комментарий/), 'коронка')
  await userEvent.click(within(form).getByRole('button', { name: 'Добавить расход' }))
  expect(await within(panel).findByText(/Расходы по пациенту:/)).toHaveTextContent(/4\s500 сом/)
  expect(expense).toMatchObject({ amountSom: 4500, category: 'Зуботехническая лаборатория', comment: 'коронка', doctorId: 2 })
})

test('карточка приёма: расход техника отметили ошибочно — «изменить»: сумма и статья; «Удалить расход»', async () => {
  backend(appointment(10, 2, '10:00', 'Бакыт М.', { status: 'DONE', version: 1 }), () => ({}))
  let list = [{ id: 7, spentOn: '2026-11-04', amountSom: 45000, category: 'Зуботехническая лаборатория', comment: 'коронка', doctorId: 2, patientId: 10 }]
  let sent: Record<string, unknown> | null = null
  server.use(
    http.get('*/api/patients/:id/expenses', () => HttpResponse.json(list)),
    http.put('*/api/expenses/:id', async ({ request }) => {
      sent = (await request.json()) as Record<string, unknown>
      list = [{ ...list[0]!, ...(sent as object) }]
      return HttpResponse.json(list[0])
    }),
    http.delete('*/api/expenses/:id', () => {
      list = []
      return new HttpResponse(null, { status: 204 })
    }),
  )
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  renderApp()
  const panel = await card()
  await openMore(panel)
  const expenses = await within(panel).findByRole('list', { name: 'Расходы по пациенту' })
  expect(expenses).toHaveTextContent(/45\s000 сом/)
  await userEvent.click(within(expenses).getByRole('button', { name: 'изменить' }))
  const form = within(panel).getByRole('form', { name: 'Исправить расход' })
  await userEvent.clear(within(form).getByLabelText('Сумма, сом'))
  await userEvent.type(within(form).getByLabelText('Сумма, сом'), '4500')
  await userEvent.clear(within(form).getByLabelText('Статья'))
  await userEvent.type(within(form).getByLabelText('Статья'), 'Техник')
  await userEvent.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await within(panel).findByText(/Расходы по пациенту:/)).toHaveTextContent(/4\s500 сом/)
  expect(sent).toMatchObject({ amountSom: 4500, category: 'Техник', comment: 'коронка' })

  await userEvent.click(within(within(panel).getByRole('list', { name: 'Расходы по пациенту' })).getByRole('button', { name: 'изменить' }))
  await userEvent.click(within(within(panel).getByRole('form', { name: 'Исправить расход' })).getByRole('button', { name: 'Удалить расход' }))
  await vi.waitFor(() => expect(within(panel).queryByText(/Расходы по пациенту:/)).not.toBeInTheDocument())
  vi.restoreAllMocks()
})

test('не оплачено — одна строка: «Бесплатно» отмечает приём с суммой 0 после вопроса', async () => {
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', version: 1 }),
    () => ({ paidSom: 0, chargeSom: 0, paymentMethod: 'CASH' }))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  renderApp()
  const panel = await card()
  // Формы на полэкрана нет — только строка с кнопками
  expect(within(panel).queryByRole('form', { name: 'Оплата' })).not.toBeInTheDocument()
  expect(within(panel).getByText('Оплата не отмечена')).toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: 'Бесплатно' }))
  await vi.waitFor(() => expect(sent).toContainEqual(expect.objectContaining({ body: { amountSom: 0, method: 'CASH', chargeSom: 0, freeReason: 'FREE' } })))
  expect(await within(panel).findByText('🎁 Бесплатно')).toBeInTheDocument()
  vi.restoreAllMocks()
})

test('«Оплачено заранее»: 0 сом в кассу, с комментарием после вопроса — приём оплачен, а не бесплатный', async () => {
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', version: 1 }),
    (_, b) => ({ paidSom: 0, chargeSom: 0, paymentMethod: 'CASH', freeReason: b.freeReason as 'PREPAID', freeComment: b.freeComment as string }))
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  renderApp()
  const panel = await card()
  await userEvent.click(within(panel).getByRole('button', { name: 'Оплачено заранее' }))
  const form = within(panel).getByRole('form', { name: 'Оплачено заранее' })
  await userEvent.type(within(form).getByLabelText('Комментарий (можно не писать)'), '  оплатил 12.10 вместе с лечением ')
  // Передумал в вопросе — ничего не ушло
  await userEvent.click(within(form).getByRole('button', { name: 'Отметить «Оплачено заранее»' }))
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('В кассу сегодня ничего не добавится'))
  expect(sent).toHaveLength(0)
  confirm.mockReturnValue(true)
  await userEvent.click(within(form).getByRole('button', { name: 'Отметить «Оплачено заранее»' }))
  await vi.waitFor(() => expect(sent).toContainEqual({ path: 'payment',
    body: { amountSom: 0, method: 'CASH', chargeSom: 0, freeReason: 'PREPAID', freeComment: 'оплатил 12.10 вместе с лечением' } }))
  expect(await within(panel).findByText('✅ Оплачено заранее')).toBeInTheDocument()
  expect(within(panel).getByText('оплатил 12.10 вместе с лечением')).toBeInTheDocument()
  expect(within(panel).queryByText('🎁 Бесплатно')).not.toBeInTheDocument()
  vi.restoreAllMocks()
})

test('«Оплачено заранее» без комментария; «Отмена» возвращает кнопки', async () => {
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', version: 1 }), () => ({}))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  renderApp()
  const panel = await card()
  await userEvent.click(within(panel).getByRole('button', { name: 'Оплачено заранее' }))
  await userEvent.click(within(panel).getByRole('button', { name: 'Отмена' }))
  expect(within(panel).queryByRole('form', { name: 'Оплачено заранее' })).not.toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: 'Оплачено заранее' }))
  await userEvent.click(within(panel).getByRole('button', { name: 'Отметить «Оплачено заранее»' }))
  await vi.waitFor(() => expect(sent).toContainEqual({ path: 'payment', body: { amountSom: 0, method: 'CASH', chargeSom: 0, freeReason: 'PREPAID' } }))
  vi.restoreAllMocks()
})

test('оплачено заранее — «Изменить» открывает обычную форму оплаты, как у бесплатного', async () => {
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', version: 1, paidSom: 0, chargeSom: 0, paymentMethod: 'CASH',
    freeReason: 'PREPAID', freeComment: 'вместе с лечением' }),
  (_, b) => ({ paidSom: b.amountSom as number, chargeSom: undefined, paymentMethod: b.method as 'CASH', freeReason: undefined, freeComment: undefined }),
  { payments: [{ id: 1, amountSom: 0, method: 'CASH', paidAt: '2026-10-12T05:00:00Z' }] })
  renderApp()
  const panel = await card()
  expect(await within(panel).findByText('✅ Оплачено заранее')).toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: 'Изменить' }))
  const form = await within(panel).findByRole('form', { name: 'Оплата' })
  await userEvent.clear(within(form).getByLabelText('Сумма, сом'))
  await userEvent.type(within(form).getByLabelText('Сумма, сом'), '1500')
  await userEvent.click(within(form).getByRole('button', { name: /^Сохранить оплату/ }))
  await vi.waitFor(() => expect(sent).toContainEqual(expect.objectContaining({ body: expect.objectContaining({ amountSom: 1500 }) })))
  expect(await within(panel).findByText(/1\s500 сом · наличные/)).toBeInTheDocument()
  expect(within(panel).queryByText('✅ Оплачено заранее')).not.toBeInTheDocument()
})

test('«Выбрать из прайса…»: длинный прайс — «Часто» сверху, дальше разделы, поиск', async () => {
  backend(appointment(10, 1, '10:00', 'Бакыт М.', { status: 'DONE', version: 1 }), () => ({}))
  const list: [string, Schemas['ServiceTypeView']['group']][] = [
    ['Консультация', 'EXAM'], ['Чистка', 'HYGIENE'], ['Фторирование', 'HYGIENE'], ['Пломба', 'THERAPY'], ['Лечение каналов', 'THERAPY'],
    ['Удаление', 'SURGERY'], ['Коронка', 'PROSTHETICS'], ['Брекеты', 'ORTHODONTICS'], ['Отбеливание', 'AESTHETICS'], ['Снимок', 'XRAY'],
  ]
  server.use(
    http.get('*/api/service-types', () => HttpResponse.json(list.map(([name, group], i) => ({
      id: i + 1, name, group, active: true, priceSom: (i + 1) * 1000,
    })) satisfies Schemas['ServiceTypeView'][])),
    http.get('*/api/service-types/popular', () => HttpResponse.json({ ids: [4] } satisfies Schemas['ServiceTypeControllerPopular'])),
  )
  renderApp()
  const form = await openPay(await card())
  await userEvent.click(await within(form).findByRole('combobox', { name: 'Цена из прайса' }))
  const box = screen.getByRole('listbox')
  // Разделы свёрнуты: только заголовки; «Часто» раскрыли — внутри частая услуга
  expect(within(box).getAllByRole('button').map((b) => b.textContent?.replace(/\s*\d+\s*[▸▾]$/, ''))).toEqual([
    'Часто', 'Осмотр и консультация', 'Профилактика и гигиена', 'Терапия', 'Хирургия', 'Ортопедия', 'Ортодонтия', 'Эстетика',
    'Рентген и диагностика',
  ])
  await userEvent.click(within(box).getByRole('button', { name: /^Часто/ }))
  expect(within(screen.getByRole('group', { name: 'Часто' })).getByRole('option')).toHaveTextContent('Пломба · 4 000 сом')
  await userEvent.type(screen.getByRole('searchbox', { name: 'Поиск в списке' }), 'КОРОН')
  await userEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Коронка/ }))
  expect(within(form).getByLabelText('Сумма, сом')).toHaveValue(7000)
})
