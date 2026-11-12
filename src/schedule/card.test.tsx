import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, todayIn } from '../lib/time'
import { appointment, me, openMore, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

type Appointment = Schemas['AppointmentView']

afterEach(() => {
  window.location.hash = ''
  localStorage.clear()
})

/** День одного врача; статус и «Вернуть» меняют приём, как сервер. */
function backend(a: Appointment, who: Schemas['BookingViewsMe'] = me) {
  let current = a
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === String(a.doctorId) ? [current] : [])),
    http.post('*/api/appointments/:id/status', async ({ request }) => {
      const body = await request.json() as { status: Appointment['status'] }
      sent.push({ status: body.status })
      current = { ...current, status: body.status, version: current.version + 1 }
      return HttpResponse.json(current)
    }),
    http.post('*/api/appointments/:id/undo', async ({ request }) => {
      const body = await request.json() as { previousStatus: Appointment['status'] }
      sent.push({ undo: body.previousStatus })
      current = { ...current, status: body.previousStatus, version: current.version + 1 }
      return HttpResponse.json(current)
    }),
    http.delete('*/api/appointments/:id', () => {
      sent.push('delete')
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return sent
}

const open = async (name: RegExp) => {
  await userEvent.click(await screen.findByRole('button', { name }))
  return screen.getByRole('complementary', { name: 'Карточка приёма' })
}

test('неявка — «Вернуть» возвращает как было', async () => {
  const sent = backend(appointment(10, 1, '00:05', 'Бакыт М.', { version: 1 }))
  renderApp()
  const panel = await open(/Бакыт М\./)
  await userEvent.click(within(panel).getByRole('button', { name: 'Неявка' }))
  expect(await within(panel).findByText('Отмечено: неявка')).toBeInTheDocument()
  // Исправить статус — редкое, под «Ещё»; главная кнопка неявки — «Записать снова»
  await openMore(panel)
  expect(within(panel).getByRole('button', { name: 'Исправить: приём состоялся' })).toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: 'Вернуть' }))
  expect(await within(panel).findByRole('button', { name: 'Приём состоялся' })).toBeInTheDocument()
  expect(sent).toEqual([{ status: 'NO_SHOW' }, { undo: 'SCHEDULED' }])
})

test('отменённую запись — «Восстановить»; удалить запись может только владелец Tish', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const cancelled = appointment(10, 1, '10:00', 'Бакыт М.', { status: 'CANCELLED', version: 1 })
  const sent = backend(cancelled, { ...me, owner: true })
  server.use(http.get('*/api/appointments/10', () => HttpResponse.json(cancelled)))
  // Отменённых в сетке нет — открываем кнопкой бота «Открыть приём»
  window.history.replaceState(null, '', '/?appointment=10')
  renderApp()
  const panel = await screen.findByRole('complementary', { name: 'Карточка приёма' })
  await userEvent.click(within(panel).getByRole('button', { name: 'Восстановить' }))
  expect(await within(panel).findByRole('button', { name: 'Отменить запись' })).toBeInTheDocument()
  await openMore(panel)
  await userEvent.click(within(panel).getByRole('button', { name: 'Удалить запись' }))
  await waitForSlow(() => expect(screen.queryByRole('complementary', { name: 'Карточка приёма' })).not.toBeInTheDocument())
  expect(sent).toEqual([{ status: 'SCHEDULED' }, 'delete'])
  window.history.replaceState(null, '', '/')
})

test('админ клиники запись не удаляет — только отменяет', async () => {
  backend(appointment(10, 1, '10:00', 'Бакыт М.'), { ...me, admin: true, owner: false })
  renderApp()
  const panel = await open(/Бакыт М\./)
  expect(within(panel).getByRole('button', { name: 'Отменить запись' })).toBeInTheDocument()
  await openMore(panel)
  expect(within(panel).queryByRole('button', { name: 'Удалить запись' })).not.toBeInTheDocument()
})

test('состоялся: «Записать на следующий визит» — «Новая запись» на того же пациента через неделю', async () => {
  backend(appointment(10, 1, '00:05', 'Бакыт М.', { status: 'DONE', paidSom: 1000, paymentMethod: 'CASH', version: 1 }))
  renderApp()
  const panel = await open(/Бакыт М\./)
  await userEvent.click(within(panel).getByRole('button', { name: 'Записать на следующий визит' }))
  const fresh = await screen.findByRole('complementary', { name: 'Новая запись' })
  expect(fresh).toHaveTextContent('Бакыт М.')
  expect(within(fresh).getByRole('combobox', { name: /Длительность/ })).toHaveAttribute('data-value', '30')
  expect(fresh).toHaveTextContent(new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(new Date(`${addDays(todayIn(), 7)}T00:00:00Z`)))
})

test('приём коллеги — только посмотреть и позвонить', async () => {
  backend(appointment(20, 2, '10:00', 'Айгуль Т.', { version: 1 }), { ...me, admin: false, doctorId: 1 })
  renderApp()
  const panel = await open(/Айгуль Т\./)
  expect(within(panel).getByText(/Приём коллеги/)).toBeInTheDocument()
  expect(within(panel).getByRole('link', { name: /Позвонить/ })).toHaveAttribute('href', 'tel:+996555123456')
  expect(within(panel).queryByRole('button', { name: 'Отменить запись' })).not.toBeInTheDocument()
})

test('имя пациента в карточке — его карточка в «Пациентах»', async () => {
  backend(appointment(10, 1, '10:00', 'Бакыт М.', { version: 1 }))
  server.use(
    http.get('*/api/patients/recent', () => HttpResponse.json([])),
    http.get('*/api/appointments/by-patient/10', () => HttpResponse.json({ patient: { id: 10, fullName: 'Бакыт М.', phone: '996555123456' }, done: 0, noShow: 0, cancelled: 0, upcoming: [], past: [] })),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
  )
  renderApp()
  const panel = await open(/Бакыт М\./)
  await userEvent.click(within(panel).getByRole('button', { name: 'Бакыт М. ›' }))
  const card = await screen.findByRole('complementary', { name: 'Карточка пациента' })
  expect(await within(card).findByRole('heading', { name: 'Бакыт М.' })).toBeInTheDocument()
  expect(window.location.hash).toBe('#/patients/all')
})

test('ребёнка записала мама из бота — в карточке приёма кто и кем приходится', async () => {
  backend(appointment(10, 1, '10:00', 'Аружан А.', { version: 1, source: 'PATIENT', bookedBy: { fullName: 'Асанова Жылдыз', relation: 'CHILD' } }))
  renderApp()
  const panel = await open(/Аружан А\./)
  expect(within(panel).getByText('Записал(а) через бота: Асанова Жылдыз, родитель')).toBeInTheDocument()
  expect(within(panel).queryByText('Запись через бота')).toBeNull()
})

test('«Приём состоялся» по ошибке — «Вернуть в запланированные»; с оплатой — сначала снять оплату', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const sent = backend(appointment(10, 1, '00:05', 'Бакыт М.', { version: 1, status: 'DONE' }))
  const { unmount } = renderApp()
  const panel = await open(/Бакыт М\./)
  await openMore(panel)
  await userEvent.click(within(panel).getByRole('button', { name: 'Вернуть в запланированные' }))
  expect(await within(panel).findByRole('button', { name: 'Приём состоялся' })).toBeInTheDocument()
  expect(sent).toEqual([{ undo: 'SCHEDULED' }])
  unmount()

  // Оплата уже внесена — кнопки нет, подсказка, что сделать сначала
  backend(appointment(11, 1, '00:05', 'Айгуль С.', { version: 1, status: 'DONE', paidSom: 3000, paymentMethod: 'CASH' }))
  renderApp()
  const paid = await open(/Айгуль С\./)
  await openMore(paid)
  expect(within(paid).queryByRole('button', { name: 'Вернуть в запланированные' })).not.toBeInTheDocument()
  expect(within(paid).getByText(/сначала «Снять отметку оплаты»/)).toBeInTheDocument()
})

test('до начала приёма — без заметки и материалов («Показать сейчас»); карточка — на весь экран', async () => {
  // 09:00 по Бишкеку: приём в 15:00 сегодня ещё не начался (подменяем только часы, таймеры настоящие)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${new Date().toISOString().slice(0, 10)}T03:00:00Z`))
  try {
    backend(appointment(10, 1, '15:00', 'Бакыт М.', { version: 1 }))
    renderApp()
    const panel = await open(/Бакыт М\./)
    expect(within(panel).queryByRole('form', { name: 'Заметка о приёме' })).not.toBeInTheDocument()
    expect(within(panel).getByText(/к началу приёма/)).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Показать сейчас' }))
    expect(await within(panel).findByRole('form', { name: 'Заметка о приёме' })).toBeInTheDocument()

    await userEvent.click(within(panel).getByRole('button', { name: 'Карточка на весь экран' }))
    expect(panel).toHaveClass('panel-full')
    expect(localStorage.getItem('tish.full.appointment')).toBe('1')
    await userEvent.click(within(panel).getByRole('button', { name: 'Свернуть карточку' }))
    expect(panel).not.toHaveClass('panel-full')
  }
  finally {
    vi.useRealTimers()
  }
})

test('редкое — под «Ещё»: промокод, предоплата, лист ожидания; уже заданный промокод — на виду', async () => {
  backend(appointment(11, 1, '23:59', 'Айгуль С.', { version: 1 }))
  renderApp()
  const panel = await open(/Айгуль С\./)
  expect(within(panel).queryByRole('button', { name: '＋ Промокод' })).not.toBeInTheDocument()
  expect(within(panel).queryByRole('button', { name: 'Попросить предоплату' })).not.toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: /^Ещё/ }))
  expect(within(panel).getByRole('button', { name: '＋ Промокод' })).toBeInTheDocument()
  expect(within(panel).getByRole('button', { name: 'Попросить предоплату' })).toBeInTheDocument()
})

test('промокод уже задан — виден сразу, не под «Ещё»', async () => {
  backend(appointment(12, 1, '23:59', 'Нурлан К.', { version: 1, promoCode: 'OSEN5' }))
  renderApp()
  const panel = await open(/Нурлан К\./)
  expect(within(panel).getByText('🎟 OSEN5')).toBeInTheDocument()
  expect(within(panel).getByRole('button', { name: /^Ещё/ })).not.toHaveAccessibleName(/промокод/)
})

test('снимки и фото — прямо из карточки приёма: свёрнутая строка, раскрыть — загрузка и «до / после»', async () => {
  backend(appointment(10, 1, '00:05', 'Бакыт М.', { version: 1, status: 'DONE' }))
  renderApp()
  const panel = await open(/Бакыт М\./)
  await userEvent.click(await within(panel).findByRole('button', { name: /^Снимки и фото/ }))
  const files = within(panel).getByRole('region', { name: 'Снимки и фото' })
  expect(within(files).getByLabelText('Файлы снимков')).toBeInTheDocument()
  // В приёме по умолчанию — «Фото»
  expect(within(files).getByRole('button', { name: '📷 Фото зубов' })).toHaveAttribute('aria-pressed', 'true')
  expect(await within(files).findByRole('region', { name: 'Для Instagram' })).toBeInTheDocument()
})
