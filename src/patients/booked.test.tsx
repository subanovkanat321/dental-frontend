import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, todayIn } from '../lib/time'
import { appointment, me, renderApp, findSub } from '../test/fixtures'
import { server } from '../test/server'
import { choose, chosen } from '../test/select'
import { waitForSlow } from '../test/wait'

/** Приём через n дней в time — вымышленный пациент. */
function later(id: number, doctorId: number, days: number, time: string, name: string, extra: Partial<Schemas['AppointmentView']> = {}) {
  const a = appointment(id, doctorId, time, name, extra)
  const start = new Date(`${addDays(todayIn(), days)}T${time}:00+06:00`)
  return { ...a, startAt: start.toISOString(), endAt: new Date(start.getTime() + 30 * 60000).toISOString() }
}

afterEach(() => {
  window.location.hash = ''
})

test('«Пациенты → Записаны»: будущие записи всех врачей по дням, без отменённых; «не подтвердили», врач, период', async () => {
  const asked: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/range', ({ request }) => {
      const q = new URL(request.url).searchParams
      asked.push(`${q.get('doctorId')}:${q.get('days')}`)
      return HttpResponse.json(q.get('doctorId') === '1'
        ? [later(1, 1, 1, '10:00', 'Айгуль Т.', { serviceName: 'Лечение кариеса', reply: 'CONFIRMED' }),
            later(2, 1, 1, '12:00', 'Отменённая К.', { status: 'CANCELLED' }),
            later(3, 1, 3, '09:00', 'Бакыт М.')]
        : [later(4, 2, 1, '11:00', 'Нурлан К.', { status: 'REQUESTED' })])
    }),
  )
  window.location.hash = '/patients'
  renderApp()
  await userEvent.click(await findSub('Записаны'))
  const list = await screen.findByRole('region', { name: 'Записанные пациенты' })
  expect(await within(list).findByText('Айгуль Т.')).toBeInTheDocument()
  // По умолчанию — свой врач (2026-11-25): Нурлана (врач 2) нет, пока не выбрали «Все врачи»
  expect(chosen(screen.getByRole('button', { name: /^Врач:/ }))).toContain('Айгерим')
  expect(within(list).queryByText('Нурлан К.')).toBeNull()
  await choose(screen.getByRole('button', { name: /^Врач:/ }), 'Все врачи')
  expect(await within(list).findByText('Нурлан К.')).toBeInTheDocument()
  // Фильтры — в строке шапки «Пациентов» (PageHead); сколько — тихо у заголовка дня, общего счётчика нет
  expect(within(list).getAllByRole('heading', { level: 3 }).map((h) => h.textContent?.replace(/^.*·\s*/, ''))).toEqual(['2', '1'])
  expect(screen.queryByText(/Записей:/)).toBeNull()
  expect(within(list).queryByText('Отменённая К.')).toBeNull()
  // По дням и по времени: завтра 10:00 Айгуль, 11:00 Нурлан (заявка) — потом через 3 дня Бакыт
  const names = within(list).getAllByRole('listitem').map((li) => within(li).getAllByRole('button')[0]!.textContent)
  expect(names).toEqual(['Айгуль Т.', 'Нурлан К.', 'Бакыт М.'])
  // Значок — только у заявки (её надо подтвердить); «подтвердил» — тихим словом справа, без эмодзи
  const [aigul, nurlan] = within(list).getAllByRole('listitem')
  expect(aigul).toHaveTextContent(/Лечение кариеса.*подтвердил/)
  expect(aigul).not.toHaveTextContent('👍')
  expect(within(nurlan!).getByText('Заявка')).toBeInTheDocument()
  expect(asked).toEqual(expect.arrayContaining(['1:7', '2:7']))

  // Только кто не подтвердил: Айгуль (придёт) уходит
  await userEvent.click(screen.getByRole('checkbox', { name: /не подтвердил/ }))
  expect(within(list).queryByText('Айгуль Т.')).toBeNull()
  expect(within(list).getAllByRole('listitem')).toHaveLength(2)

  // Один врач и месяц — запрос с days=31 только по нему
  await choose(screen.getByRole('button', { name: /^Врач:/ }), 'Дастан Т.')
  await userEvent.click(screen.getByRole('button', { name: 'Месяц' }))
  expect(await within(list).findByText('Нурлан К.')).toBeInTheDocument()
  expect(within(list).queryByText('Бакыт М.')).toBeNull()
  expect(asked).toContain('2:31')
})

test('кнопка сводки «📲 Напомнить» (?screen=booked&day=tomorrow&unconfirmed=1&doctor=2): «Записаны» на завтра, только кто не подтвердил, этот врач', async () => {
  const asked: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/range', ({ request }) => {
      const q = new URL(request.url).searchParams
      asked.push(`${q.get('doctorId')}:${q.get('from')}:${q.get('days')}`)
      return HttpResponse.json([later(4, 2, 1, '11:00', 'Нурлан К.'), later(5, 2, 1, '12:00', 'Айгуль Т.', { reply: 'CONFIRMED' })])
    }),
  )
  window.history.replaceState(null, '', '/?screen=booked&day=tomorrow&unconfirmed=1&doctor=2&v=abc')
  renderApp()
  const list = await screen.findByRole('region', { name: 'Записанные пациенты' })
  expect(await within(list).findByText('Нурлан К.')).toBeInTheDocument()
  expect(within(list).queryByText('Айгуль Т.')).toBeNull()
  expect(screen.getByRole('button', { name: 'Завтра' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('checkbox', { name: /не подтвердил/ })).toBeChecked()
  expect(screen.getByRole('button', { name: /^Врач:/ })).toHaveTextContent('Дастан Т.')
  expect(asked).toEqual([`2:${addDays(todayIn(), 1)}:1`])
  // Адрес чистый: ссылку не открыть повторно обновлением страницы
  expect(window.location.search).toBe('')
  expect(window.location.hash).toBe('#/patients/booked')
  window.history.replaceState(null, '', '/')
})

test('кнопка «Отметить (N)» (?screen=booked&day=today&unmarked=1&doctor=2): сегодня только прошедшие без отметки, без WhatsApp', async () => {
  const ago = (id: number, minutes: number, name: string, extra: Partial<Schemas['AppointmentView']> = {}) => {
    const a = appointment(id, 2, '10:00', name, extra)
    const end = Date.now() - minutes * 60000
    return { ...a, startAt: new Date(end - 30 * 60000).toISOString(), endAt: new Date(end).toISOString() }
  }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/range', () => HttpResponse.json([
      ago(1, 40, 'Бакыт М.', { patient: { id: 1, fullName: 'Бакыт М.', phone: '996700111222', telegram: false } }),
      ago(2, 90, 'Айгуль Т.', { status: 'DONE' }),
      ago(3, 120, 'Асель Н.', { status: 'NO_SHOW' }),
      ago(4, -60, 'Нурлан К.'), // ещё впереди
    ])),
  )
  window.history.replaceState(null, '', '/?screen=booked&day=today&unmarked=1&doctor=2')
  renderApp()
  const list = await screen.findByRole('region', { name: 'Записанные пациенты' })
  expect(await within(list).findByText('Бакыт М.')).toBeInTheDocument()
  expect(within(list).getAllByRole('listitem')).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Сегодня' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('checkbox', { name: 'Не отмечено' })).toBeChecked()
  // Прошедшему напоминать поздно — кнопки WhatsApp нет
  expect(within(list).queryByRole('button', { name: /WhatsApp/ })).toBeNull()
  // Сняли галочку — снова будущие
  await userEvent.click(screen.getByRole('checkbox', { name: 'Не отмечено' }))
  expect(await within(list).findByText('Нурлан К.')).toBeInTheDocument()
  expect(within(list).queryByText('Бакыт М.')).toBeNull()
  window.history.replaceState(null, '', '/')
})

test('«WhatsApp» в строке неподтверждённого: готовый текст напоминания и отметка «напомнили»; у подтвердивших и заявок кнопки нет', async () => {
  const calls: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/range', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1'
      ? [later(1, 1, 1, '10:00', 'Бакыт М.', { patient: { id: 1, fullName: 'Бакыт М.', phone: '996700111222', telegram: true }, reminderOpenedAt: new Date().toISOString() }),
          later(2, 1, 1, '11:00', 'Айгуль Т.', { reply: 'CONFIRMED' }),
          later(3, 1, 1, '12:00', 'Нурлан К.', { status: 'REQUESTED' })]
      : [])),
    http.post('*/api/appointments/:id/reminder-opened', ({ params }) => {
      calls.push(`opened:${String(params.id)}`)
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const opened: string[] = []
  vi.spyOn(window, 'open').mockImplementation((url) => { opened.push(String(url)); return null })
  window.location.hash = '/patients'
  renderApp()
  await userEvent.click(await findSub('Записаны'))
  const list = await screen.findByRole('region', { name: 'Записанные пациенты' })
  // Telegram-пациент, бот уже писал, ответа нет — WhatsApp всё равно можно
  const wa = await within(list).findByRole('button', { name: /Напомнить в WhatsApp: Бакыт М\., 10:00/ })
  expect(within(list).queryByRole('button', { name: /WhatsApp: Айгуль/ })).toBeNull()
  expect(within(list).queryByRole('button', { name: /WhatsApp: Нурлан/ })).toBeNull()
  await waitForSlow(() => expect(wa).toBeEnabled()) // ждёт настройки: без них в тексте нет подписи
  await userEvent.click(wa)
  expect(opened[0]).toContain('phone=996700111222')
  expect(decodeURIComponent(opened[0]!)).toContain('Стоматология «Тест»')
  await waitForSlow(() => expect(calls).toEqual(['opened:1']))
  vi.restoreAllMocks()
})

test('«Завтра»: обзвон — счётчики «Напомнили · Не напомнили · Нет контакта · Подтвердили», каждый — фильтр', async () => {
  const tomorrow = addDays(todayIn(), 1)
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/range', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? [
      later(1, 1, 1, '09:00', 'Подтвердил А.', { reply: 'CONFIRMED', reminderOpenedAt: `${tomorrow}T00:00:00Z` }),
      later(2, 1, 1, '10:00', 'Напомнили Б.', { reminderOpenedAt: `${tomorrow}T00:00:00Z` }),
      later(3, 1, 1, '11:00', 'Перенести В.', { reply: 'RESCHEDULE' }),
      later(4, 1, 1, '12:00', 'Ботом Г.', { soonRemindedAt: `${tomorrow}T00:00:00Z` }),
      later(5, 1, 1, '13:00', 'Ждём Д.'),
      later(6, 1, 1, '14:00', 'Без номера Е.', { patient: { id: 6, fullName: 'Без номера Е.', telegram: false } }),
      later(7, 1, 1, '15:00', 'Заявка Ж.', { status: 'REQUESTED' }),
    ] : [])),
  )
  window.location.hash = '/patients'
  renderApp()
  await userEvent.click(await findSub('Записаны'))
  const list = await screen.findByRole('region', { name: 'Записанные пациенты' })
  // «Неделя» — счётчиков нет: они для обзвона на сегодня и завтра
  expect(await within(list).findByText('Ждём Д.')).toBeInTheDocument()
  expect(within(list).queryByRole('group', { name: 'Обзвон' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Завтра' }))
  const summary = await within(list).findByRole('group', { name: 'Обзвон' })
  expect(within(summary).getAllByRole('button').map((b) => b.textContent))
    .toEqual(['Напомнили 3', 'Не напомнили 1', 'Нет контакта 1', 'Подтвердили 1'])

  await userEvent.click(within(summary).getByRole('button', { name: 'Напомнили 3' }))
  const names = () => within(list).getAllByRole('listitem').map((li) => within(li).getAllByRole('button')[0]!.textContent)
  expect(names()).toEqual(['Напомнили Б.', 'Перенести В.', 'Ботом Г.'])
  expect(within(summary).getByRole('button', { name: 'Напомнили 3' })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(within(summary).getByRole('button', { name: 'Нет контакта 1' }))
  expect(names()).toEqual(['Без номера Е.'])
  // Ещё раз — все, и заявка тоже
  await userEvent.click(within(summary).getByRole('button', { name: 'Нет контакта 1' }))
  expect(names()).toHaveLength(7)
})

test('«Не напомнили» → «Отметить напомненными (N)»: вопрос, отметка reminder-opened каждому, без отправки сообщений', async () => {
  const marked: string[] = []
  let sent = false
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/range', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? [
      later(2, 1, 1, '10:00', 'Ждём Б.', { reminderOpenedAt: marked.includes('2') ? new Date().toISOString() : undefined }),
      later(3, 1, 1, '11:00', 'Ждём В.', { reminderOpenedAt: marked.includes('3') ? new Date().toISOString() : undefined }),
      later(4, 1, 1, '12:00', 'Пришёл Г.', { reply: 'CONFIRMED' }),
    ] : [])),
    http.post('*/api/appointments/:id/reminder-opened', ({ params }) => { marked.push(String(params.id)); return new HttpResponse(null, { status: 204 }) }),
    http.post('*/api/appointments/:id/remind-telegram', () => { sent = true; return HttpResponse.json({}) }),
    http.post('*/api/appointments/:id/remind-whatsapp', () => { sent = true; return HttpResponse.json({}) }),
  )
  window.location.hash = '/patients'
  renderApp()
  await userEvent.click(await findSub('Записаны'))
  await userEvent.click(await screen.findByRole('button', { name: 'Завтра' }))
  const summary = await screen.findByRole('group', { name: 'Обзвон' })
  // Кнопка — только в фильтре «Не напомнили»
  expect(within(summary).queryByRole('button', { name: /Отметить напомненными/ })).toBeNull()
  await userEvent.click(within(summary).getByRole('button', { name: 'Не напомнили 2' }))
  await userEvent.click(within(summary).getByRole('button', { name: 'Отметить напомненными (2)' }))
  const question = await screen.findByRole('alertdialog')
  expect(question).toHaveTextContent('Отметить 2 записи как «напомнили»? Сообщения Tish не отправит')
  await userEvent.click(within(question).getByRole('button', { name: 'Отметить (2)' }))
  expect(await within(summary).findByRole('status')).toHaveTextContent('Отмечено напомненными: 2')
  expect(marked.sort()).toEqual(['2', '3'])
  expect(sent).toBe(false)
  // Перечитали: оба — в «Напомнили»
  await waitForSlow(() => expect(within(summary).getByRole('button', { name: 'Напомнили 2' })).toBeInTheDocument())
})
