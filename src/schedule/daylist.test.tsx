import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { slotInstant, todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

/** Телефон: экран уже 760px — «День» списком. */
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width'), media: query, addEventListener() {}, removeEventListener() {}, onchange: null,
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

const at = (time: string) => slotInstant(todayIn(), Number(time.slice(0, 2)) * 60 + Number(time.slice(3)))

function backend() {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => {
      const doctorId = Number(new URL(request.url).searchParams.get('doctorId'))
      return HttpResponse.json(doctorId === 1 ? [appointment(10, 1, '10:00', 'Бакыт М.')] : [appointment(11, 2, '12:00', 'Нурлан К.')])
    }),
    http.get('*/api/appointments/counts', () => HttpResponse.json([])),
    http.get('*/api/slots', ({ request }) => {
      const doctorId = Number(new URL(request.url).searchParams.get('doctorId'))
      return HttpResponse.json({
        workingDay: true, breaks: [],
        free: doctorId === 1 ? [{ start: at('13:00'), end: at('15:00') }] : [{ start: at('09:00'), end: at('12:00') }],
      })
    }),
  )
}

test('телефон, «Все врачи» — список: приёмы обоих врачей и свободные окна с именем врача', async () => {
  backend()
  localStorage.setItem('crm.schedule.view', 'all')
  renderApp()
  // Как в прежнем приложении: открывается свой день, даже если в прошлый раз смотрели всех
  expect(await screen.findByRole('button', { name: /10:00–10:30, Бакыт М\./ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /12:00–12:30, Нурлан К\./ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /^Чьё расписание: Айгерим Садыкова/ }))
  const options = screen.getByRole('listbox', { name: 'Чьё расписание' })
  expect(within(options).getAllByRole('option').map((o) => o.querySelector('strong')?.textContent)).toEqual(['Айгерим Садыкова (я)', 'Дастан Т.', 'Все врачи'])
  await userEvent.click(within(options).getByRole('option', { name: /Все врачи/ }))
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(await screen.findByRole('button', { name: /12:00–12:30, Нурлан К\./ })).toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'Дастан Т.' })).not.toBeInTheDocument() // не сетка
  // Верх на телефоне — без повторов: один день крупно, одна «Новая запись» рядом с «Без записи»
  expect(screen.getAllByRole('button', { name: 'Предыдущий день' })).toHaveLength(1)
  expect(screen.getAllByRole('button', { name: '＋ Новая запись' })).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Принять сейчас (без записи)' })).toBeInTheDocument()
  expect(screen.getByLabelText('Выбрать дату')).toBeInTheDocument()
  // У каждого врача свой блок: приём Нурлана — в блоке Дастана, не в общем списке
  const dastan = screen.getByRole('region', { name: 'Дастан Т.' })
  expect(within(dastan).getByRole('button', { name: /12:00–12:30, Нурлан К\./ })).toBeInTheDocument()
  expect(within(dastan).queryByRole('button', { name: /10:00–10:30, Бакыт М\./ })).not.toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: 'Айгерим Садыкова' })).getByRole('button', { name: /10:00–10:30, Бакыт М\./ })).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: /Свободно с 09:00 до 12:00 у врача Дастан/ }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  expect(within(panel).getByLabelText('Врач')).toHaveValue('2')
})

test('телефон, один врач — только его приёмы и окна', async () => {
  backend()
  localStorage.setItem('crm.schedule.view', '1')
  renderApp()
  expect(await screen.findByRole('button', { name: /10:00–10:30, Бакыт М\./ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /12:00–12:30, Нурлан К\./ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Свободно с 13:00 до 15:00, записать/ })).toBeInTheDocument()
})

test('телефон в Telegram — «＋ Новая запись» кнопкой на экране, рядом с «Без записи»', async () => {
  backend()
  vi.stubGlobal('Telegram', { WebApp: { initData: 'query_id=test', platform: 'ios', ready() {}, expand() {} } })
  try {
    renderApp()
    expect(await screen.findByRole('button', { name: /10:00–10:30, Бакыт М\./ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '＋ Новая запись' }))
    expect(await screen.findByRole('complementary', { name: 'Новая запись' })).toBeInTheDocument()
  } finally {
    vi.unstubAllGlobals()
  }
})

test('телефон: вместо ленты — один день; стрелка — «Завтра», «Сегодня» — назад', async () => {
  backend()
  renderApp()
  const bar = await screen.findByRole('group', { name: 'День' })
  expect(within(bar).getByText('Сегодня')).toBeInTheDocument()
  expect(within(bar).queryByRole('button', { name: 'Сегодня' })).not.toBeInTheDocument()
  await userEvent.click(within(bar).getByRole('button', { name: 'Следующий день' }))
  expect(within(bar).getByText('Завтра')).toBeInTheDocument()
  await userEvent.click(within(bar).getByRole('button', { name: 'Сегодня' }))
  expect(within(bar).getByText('Сегодня')).toBeInTheDocument()
  expect(within(bar).queryByRole('button', { name: 'Сегодня' })).not.toBeInTheDocument()
})

function remindBackend(start: ReturnType<typeof appointment>, fail = false) {
  let a = { ...start }
  const calls: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? [a] : [])),
    http.get('*/api/appointments/counts', () => HttpResponse.json([])),
    http.post('*/api/appointments/:id/remind-telegram', () => {
      calls.push('telegram')
      if (fail) return HttpResponse.json({ title: 'Bad Gateway', status: 502, detail: 'Telegram не ответил, попробуйте ещё раз' }, { status: 502 })
      a = { ...a, reminderOpenedAt: new Date().toISOString(), version: a.version! + 1 }
      return HttpResponse.json(a)
    }),
    http.post('*/api/appointments/:id/reminder-opened', () => {
      calls.push('opened')
      a = { ...a, reminderOpenedAt: new Date().toISOString() }
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return calls
}

test('телефон: быстрое «TG» — «✓ отправлено» вместо кнопки, второй раз не отправить', async () => {
  const calls = remindBackend(appointment(10, 1, '23:30', 'Бакыт М.', { patient: { id: 10, fullName: 'Бакыт М.', telegram: true } }))
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Напомнить в Telegram: Бакыт М\./ }))
  expect(await screen.findByRole('status', { name: /Напоминание отправлено: Бакыт М\./ })).toHaveTextContent('✓ отправлено')
  expect(screen.queryByRole('button', { name: /Напомнить в Telegram/ })).not.toBeInTheDocument()
  expect(calls).toEqual(['telegram'])
})

test('телефон: быстрое «TG» не прошло — ошибка под приёмом, кнопка остаётся', async () => {
  remindBackend(appointment(10, 1, '23:30', 'Бакыт М.', { patient: { id: 10, fullName: 'Бакыт М.', telegram: true } }), true)
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Напомнить в Telegram: Бакыт М\./ }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Telegram не ответил')
  expect(screen.getByRole('button', { name: /Напомнить в Telegram: Бакыт М\./ })).toBeEnabled()
})

test('телефон: «WA» — WhatsApp с подписью клиники, затем «✓ отправлено»; уже напомнили — сразу отметка', async () => {
  const calls = remindBackend(appointment(10, 1, '23:30', 'Бакыт М.'))
  const opened: string[] = []
  vi.spyOn(window, 'open').mockImplementation((url) => { opened.push(String(url)); return null })
  renderApp()
  const wa = await screen.findByRole('button', { name: /Напомнить в WhatsApp: Бакыт М\./ })
  await vi.waitFor(() => expect(wa).toBeEnabled()) // ждёт настройки: без них в тексте нет подписи
  await userEvent.click(wa)
  expect(decodeURIComponent(opened[0]!)).toContain('Стоматология «Тест»')
  expect(await screen.findByRole('status', { name: /Напоминание отправлено: Бакыт М\./ })).toBeInTheDocument()
  expect(calls).toEqual(['opened'])
  vi.restoreAllMocks()
})

test('телефон: короткая полоса «Сегодня» над днём — заявки и склад; нажать на заявку — её карточка', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1'
      ? [appointment(10, 1, '23:30', 'Бакыт М.', { status: 'REQUESTED' })] : [])),
    http.get('*/api/appointments/counts', () => HttpResponse.json([])),
    http.get('*/api/supplies', () => HttpResponse.json([{ id: 1, name: 'Анестетик', unit: 'шт', quantity: 1, minQuantity: 5, low: true }])),
  )
  renderApp()
  const strip = await screen.findByRole('group', { name: 'Требует внимания' })
  expect(strip).toHaveClass('compact')
  expect(await within(strip).findByRole('button', { name: /1 склад: мало/ })).toBeInTheDocument()
  await userEvent.click(within(strip).getByRole('button', { name: /1 заявка/ }))
  expect(await screen.findByRole('complementary', { name: 'Карточка приёма' })).toHaveTextContent('Бакыт М.')
})
