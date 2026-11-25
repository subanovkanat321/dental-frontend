import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, todayIn } from '../lib/time'
import { appointment, contactMenu, me, meArrivals, pickContact, pickStatus, renderApp, statusMenu } from '../test/fixtures'
import { fixNow } from '../test/now'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

// Сетка «Все врачи» на компьютере: с 2026-11-25 по умолчанию открывается свой врач — выбор «Все врачи» запомнен
beforeEach(() => { localStorage.setItem('crm.schedule.view.v2', 'all') })

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
      const body = await request.json() as { status: Appointment['status']; reason?: Appointment['cancelReason']; reasonNote?: string }
      sent.push({ status: body.status, ...(body.reason ? { reason: body.reason } : {}), ...(body.reasonNote ? { note: body.reasonNote } : {}) })
      current = { ...current, status: body.status, cancelReason: body.reason, cancelNote: body.reasonNote, version: current.version + 1 }
      return HttpResponse.json(current)
    }),
    http.post('*/api/appointments/:id/undo', async ({ request }) => {
      const body = await request.json() as { previousStatus: Appointment['status'] }
      sent.push({ undo: body.previousStatus })
      current = { ...current, status: body.previousStatus, version: current.version + 1 }
      return HttpResponse.json(current)
    }),
    http.post('*/api/appointments/:id/arrived', async ({ request }) => {
      const body = await request.json() as { arrived: boolean }
      sent.push({ arrived: body.arrived })
      current = { ...current, arrivedAt: body.arrived ? new Date().toISOString() : undefined, version: current.version + 1 }
      return HttpResponse.json(current)
    }),
    // «В кресле» (V235): как сервер — «Пришёл» ставится вместе, если не было
    http.post('*/api/appointments/:id/in-chair', async ({ request }) => {
      const body = await request.json() as { inChair: boolean }
      sent.push({ inChair: body.inChair })
      const now = new Date().toISOString()
      current = { ...current, inChairAt: body.inChair ? now : undefined, arrivedAt: body.inChair ? current.arrivedAt ?? now : current.arrivedAt, version: current.version + 1 }
      return HttpResponse.json(current)
    }),
    http.post('*/api/appointments/:id/reply', async ({ request }) => {
      const body = await request.json() as { reply: Appointment['reply'] }
      sent.push({ reply: body.reply })
      current = { ...current, reply: body.reply, version: current.version + 1 }
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

test('неявка — окно с причиной; причина в карточке; «Вернуть» возвращает как было', async () => {
  const sent = backend(appointment(10, 1, '00:05', 'Бакыт М.', { version: 1 }))
  renderApp()
  const panel = await open(/Бакыт М\./)
  await pickStatus(panel, 'Неявка')
  const sheet = screen.getByRole('dialog', { name: 'Причина неявки' })
  expect(sheet).toHaveTextContent('Отметить неявку: Бакыт М. не пришёл(ла) на приём?')
  // У неявки «Клиника отменила» не предлагаем
  expect(within(sheet).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Передумал', 'Заболел', 'Перенёс на другое время', 'Дубль записи', 'Другое'])
  await userEvent.click(within(sheet).getByRole('radio', { name: 'Заболел' }))
  expect(within(sheet).getByRole('radio', { name: 'Заболел' })).toHaveAttribute('aria-checked', 'true')
  await userEvent.click(within(sheet).getByRole('button', { name: 'Отметить неявку' }))
  expect(await within(panel).findByText('Отмечено: неявка')).toBeInTheDocument()
  expect(within(panel).getByText('Неявка · заболел')).toBeInTheDocument()
  expect(statusMenu(panel)).toHaveAccessibleName('Статус: Неявка')
  // Исправить — тем же списком статусов: из неявки можно «Приём состоялся» и «Записан»
  await userEvent.click(statusMenu(panel)!)
  expect(screen.getByRole('menuitemradio', { name: /^Приём состоялся/ })).toBeEnabled()
  await userEvent.keyboard('{Escape}')
  await userEvent.click(within(panel).getByRole('button', { name: 'Вернуть' }))
  expect(await within(panel).findByRole('button', { name: 'Приём состоялся' })).toBeInTheDocument()
  expect(sent).toEqual([{ status: 'NO_SHOW', reason: 'ILL' }, { undo: 'SCHEDULED' }])
})

test('отменённую запись — «Записан» в списке (восстановить); удалить запись может только владелец Tish', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const cancelled = appointment(10, 1, '10:00', 'Бакыт М.', { status: 'CANCELLED', version: 1 })
  const sent = backend(cancelled, { ...me, owner: true })
  server.use(http.get('*/api/appointments/10', () => HttpResponse.json(cancelled)))
  // Отменённых в сетке нет — открываем кнопкой бота «Открыть приём»
  window.history.replaceState(null, '', '/?appointment=10')
  renderApp()
  const panel = await screen.findByRole('complementary', { name: 'Карточка приёма' })
  expect(statusMenu(panel)).toHaveAccessibleName('Статус: Отменён')
  // «Восстановить» — это «Записан» в списке статуса
  await pickStatus(panel, 'Записан')
  await waitForSlow(() => expect(statusMenu(panel)).toHaveAccessibleName('Статус: Записан'))
  // «Удалить запись» — в «⋯» шапки карточки
  await userEvent.click(within(panel).getByRole('button', { name: 'Ещё действия' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Удалить запись' }))
  await waitForSlow(() => expect(screen.queryByRole('complementary', { name: 'Карточка приёма' })).not.toBeInTheDocument())
  expect(sent).toEqual([{ status: 'SCHEDULED' }, 'delete'])
  window.history.replaceState(null, '', '/')
})

test('админ клиники запись не удаляет — только отменяет', async () => {
  backend(appointment(10, 1, '10:00', 'Бакыт М.'), { ...me, admin: true, owner: false })
  renderApp()
  const panel = await open(/Бакыт М\./)
  expect(statusMenu(panel)).toBeInTheDocument()
  // «⋯» с «Удалить запись» — только у владельца Tish
  expect(within(panel).queryByRole('button', { name: 'Ещё действия' })).toBeNull()
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
  // Статус виден пилюлей без ▾ — только посмотреть
  expect(statusMenu(panel)).not.toBeInTheDocument()
  expect(within(panel).getByLabelText('Статус: Записан')).toBeInTheDocument()
  expect(within(panel).queryByRole('button', { name: 'Приём состоялся' })).toBeNull()
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

test('«Приём состоялся» по ошибке — «Записан» (вернуть в запланированные); с оплатой — серый пункт с причиной', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const sent = backend(appointment(10, 1, '00:05', 'Бакыт М.', { version: 1, status: 'DONE' }))
  const { unmount } = renderApp()
  const panel = await open(/Бакыт М\./)
  await pickStatus(panel, 'Записан')
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Вернуть приём в запланированные'))
  expect(await within(panel).findByRole('button', { name: 'Приём состоялся' })).toBeInTheDocument()
  expect(sent).toEqual([{ undo: 'SCHEDULED' }])
  // Отдельной кнопки «Вернуть в запланированные» больше нет — ни внизу, ни под «Ещё»
  expect(within(panel).queryByRole('button', { name: 'Вернуть в запланированные' })).toBeNull()
  unmount()

  // Оплата уже внесена — «Записан» серый, причина — под ним в списке
  backend(appointment(11, 1, '00:05', 'Айгуль С.', { version: 1, status: 'DONE', paidSom: 3000, paymentMethod: 'CASH' }))
  renderApp()
  const paid = await open(/Айгуль С\./)
  await userEvent.click(statusMenu(paid)!)
  const back = screen.getByRole('menuitemradio', { name: /^Записан/ })
  expect(back).toBeDisabled()
  expect(back).toHaveTextContent(/сначала «Снять отметку оплаты»/)
})

test('до начала приёма — без заметки и материалов («Показать сейчас»); карточка — на весь экран', async () => {
  // 09:00 по Бишкеку: приём в 15:00 сегодня ещё не начался (подменяем только часы, таймеры настоящие)
  fixNow(`${todayIn()}T09:00:00+06:00`, { frozen: true })
  backend(appointment(10, 1, '15:00', 'Бакыт М.', { version: 1 }))
  renderApp()
  const panel = await open(/Бакыт М\./)
  expect(within(panel).queryByRole('form', { name: 'Заметка о приёме' })).not.toBeInTheDocument()
  expect(within(panel).getByText(/к началу приёма/)).toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: 'Показать сейчас' }))
  expect(await within(panel).findByRole('form', { name: 'Заметка о приёме' })).toBeInTheDocument()

  // Компьютер — всегда сразу на весь экран; свернули — только эту карточку, не запоминается
  expect(panel).toHaveClass('panel-full')
  await userEvent.click(within(panel).getByRole('button', { name: 'Свернуть карточку' }))
  expect(panel).not.toHaveClass('panel-full')
  expect(localStorage.getItem('tish.full.appointment')).toBeNull()
  await userEvent.click(within(panel).getByRole('button', { name: 'Карточка на весь экран' }))
  expect(panel).toHaveClass('panel-full')
})

test('до приёма «＋ Промокод» — своей строкой под «＋ Комментарий»; «＋ Предоплата · ＋ В лист ожидания» — строкой ссылок, без свёрнутого «Ещё»', async () => {
  backend(appointment(11, 1, '23:59', 'Айгуль С.', { version: 1 }))
  server.use(http.get('*/api/waitlist', () => HttpResponse.json([])))
  renderApp()
  const panel = await open(/Айгуль С\./)
  // Промокод (2026-11-20, владелец) — не в строке с комментарием: у состоявшегося приёма он в оплате, рядом со скидкой
  expect(within(panel).getByRole('button', { name: '＋ Промокод' }).parentElement).not.toContainElement(within(panel).getByRole('button', { name: '＋ Комментарий' }))
  expect(within(panel).queryByRole('button', { name: /^Ещё ·|^Ещё$/ })).not.toBeInTheDocument()
  expect(within(panel).queryByRole('region', { name: 'Ещё' })).not.toBeInTheDocument()
  const deposit = within(panel).getByRole('button', { name: '＋ Предоплата' })
  const waitlist = await within(panel).findByRole('button', { name: '＋ В лист ожидания' })
  expect(deposit.parentElement).toContainElement(waitlist)
  await userEvent.click(deposit)
  expect(within(panel).getByRole('group', { name: 'Предоплата' })).toBeInTheDocument()
  expect(within(panel).queryByRole('button', { name: '＋ Предоплата' })).not.toBeInTheDocument()
  await userEvent.click(within(within(panel).getByRole('group', { name: 'Предоплата' })).getByRole('button', { name: 'Отмена' }))
  expect(within(panel).getByRole('button', { name: '＋ Предоплата' })).toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: '＋ В лист ожидания' }))
  expect(await within(panel).findByRole('form', { name: 'В лист ожидания' })).toBeInTheDocument()
})

test('промокод уже задан — виден сразу, с карандашом «Изменить промокод»', async () => {
  backend(appointment(12, 1, '23:59', 'Нурлан К.', { version: 1, promoCode: 'OSEN5' }))
  renderApp()
  const panel = await open(/Нурлан К\./)
  expect(within(panel).getByText('🎟 OSEN5')).toBeInTheDocument()
  expect(within(panel).getByRole('button', { name: 'Изменить промокод' })).toHaveAttribute('title', 'Изменить промокод')
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

test('пилюля статуса: текущий с ✓, допустимые статусы списком (без «Пришёл» и «В кресле» — клиника их не отмечает); Esc закрывает список, а не карточку', async () => {
  backend(appointment(10, 1, '00:05', 'Бакыт М.', { version: 1 }))
  renderApp()
  const panel = await open(/Бакыт М\./)
  // Прежних отдельных кнопок статуса нет
  expect(within(panel).queryByRole('button', { name: /^Неявка или отмена/ })).toBeNull()
  expect(within(panel).queryByRole('button', { name: 'Отклонить заявку' })).toBeNull()
  const pill = statusMenu(panel)!
  expect(pill).toHaveAccessibleName('Статус: Записан')
  expect(pill).toHaveAttribute('aria-haspopup', 'menu')
  await userEvent.click(pill)
  expect(pill).toHaveAttribute('aria-expanded', 'true')
  const menu = screen.getByRole('menu', { name: 'Статус приёма' })
  // Заявкой приём снова не станет — пункта нет
  expect(within(menu).getAllByRole('menuitemradio').map((i) => i.querySelector('.menu-text')?.firstChild?.textContent))
    .toEqual(['Записан', 'Подтвердил (придёт)', 'Просит перенести', 'Нет ответа', 'Приём состоялся', 'Неявка', 'Отменён'])
  expect(within(menu).getByRole('menuitemradio', { name: /^Записан/ })).toHaveAttribute('aria-checked', 'true')
  expect(within(menu).getByRole('menuitemradio', { name: /^Подтвердил/ })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('menu')).toBeNull()
  expect(screen.getByRole('complementary', { name: 'Карточка приёма' })).toBeInTheDocument()
  expect(pill).toHaveFocus()
})

test('приём на завтра — «Пришёл», «В кресле», «Состоялся» и «Неявка» серые «с дня приёма»; отмена — с причиной', async () => {
  const today = appointment(10, 1, '10:00', 'Бакыт М.', { version: 1 })
  const day = 24 * 3600_000
  const tomorrow = { ...today, startAt: new Date(Date.parse(today.startAt) + day).toISOString(), endAt: new Date(Date.parse(today.endAt) + day).toISOString() }
  const sent = backend(tomorrow, meArrivals)
  server.use(http.get('*/api/appointments/10', () => HttpResponse.json(tomorrow)))
  // Открываем кнопкой бота «Открыть приём» — без листания расписания на завтра
  window.history.replaceState(null, '', '/?appointment=10')
  renderApp()
  const panel = await screen.findByRole('complementary', { name: 'Карточка приёма' })
  // Следующего шага до дня приёма нет
  expect(within(panel).queryByRole('button', { name: 'Пришёл' })).toBeNull()
  await userEvent.click(await waitForSlow(() => statusMenu(panel)!))
  for (const name of ['Пришёл', 'В кресле', 'Приём состоялся', 'Неявка']) {
    const item = screen.getByRole('menuitemradio', { name: new RegExp(`^${name}`) })
    expect(item).toBeDisabled()
    expect(item).toHaveTextContent('с дня приёма')
  }
  await userEvent.click(screen.getByRole('menuitemradio', { name: /^Отменён/ }))
  const sheet = screen.getByRole('dialog', { name: 'Причина отмены' })
  expect(sheet).toHaveTextContent('Отменить запись Бакыт М.? Время освободится.')
  expect(within(sheet).getAllByRole('radio')).toHaveLength(6)
  await userEvent.click(within(sheet).getByRole('radio', { name: 'Дубль записи' }))
  await userEvent.click(within(sheet).getByRole('button', { name: 'Отменить запись' }))
  expect(await within(panel).findByText('Запись отменена')).toBeInTheDocument()
  expect(within(panel).getByText('Дубль записи')).toBeInTheDocument()
  expect(sent).toEqual([{ status: 'CANCELLED', reason: 'DUPLICATE' }])
  window.history.replaceState(null, '', '/')
})

test('клиника отмечает приход — следующий шаг одним касанием: «Пришёл» → «Начать приём» (В кресле) → «Приём состоялся» → оплата', async () => {
  // 10:10 по Бишкеку: приём 10:00–10:30 идёт
  fixNow(`${todayIn()}T10:10:00+06:00`, { frozen: true })
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', { version: 1 }), meArrivals)
  renderApp()
  const panel = await open(/Бакыт М\./)
  await userEvent.click(within(panel).getByRole('button', { name: 'Пришёл' }))
  await waitForSlow(() => expect(statusMenu(panel)).toHaveAccessibleName('Статус: Пришёл'))
  await userEvent.click(within(panel).getByRole('button', { name: 'Начать приём' }))
  await waitForSlow(() => expect(statusMenu(panel)).toHaveAccessibleName('Статус: В кресле'))
  expect(statusMenu(panel)).toHaveClass('s-chair')
  await userEvent.click(within(panel).getByRole('button', { name: 'Приём состоялся' }))
  await waitForSlow(() => expect(statusMenu(panel)).toHaveAccessibleName('Статус: Приём состоялся'))
  expect(sent).toEqual([{ arrived: true }, { inChair: true }, { status: 'DONE' }])
  // После приёма главная — оплата
  expect(within(panel).getByRole('button', { name: 'Принять оплату' })).toBeInTheDocument()
})

test('клиника отмечает приход — «В кресле» в списке статусов: «Пришёл» снимает только кресло, «Записан» — обе отметки', async () => {
  const sent = backend(appointment(10, 1, '00:05', 'Бакыт М.', { version: 1 }), meArrivals)
  renderApp()
  const panel = await open(/Бакыт М\./)
  await pickStatus(panel, 'В кресле')
  await waitForSlow(() => expect(statusMenu(panel)).toHaveAccessibleName('Статус: В кресле'))
  await userEvent.click(statusMenu(panel)!)
  expect(screen.getByRole('menuitemradio', { name: /^В кресле/ })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('menuitemradio', { name: /^Пришёл/ })).toHaveTextContent('снять «В кресле»')
  await userEvent.keyboard('{Escape}')
  await pickStatus(panel, 'Пришёл')
  await waitForSlow(() => expect(statusMenu(panel)).toHaveAccessibleName('Статус: Пришёл'))
  expect(sent).toEqual([{ inChair: true }, { inChair: false }])
})

test('по умолчанию (приход не отмечают): до начала — главная «Приём состоялся» без «Неявки» рядом; после начала — «🚷 Неявка» ссылкой', async () => {
  // 09:50 по Бишкеку: приём 10:00–10:30 ещё не начался
  fixNow(`${todayIn()}T09:50:00+06:00`, { frozen: true })
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', { version: 1 }))
  renderApp()
  const panel = await open(/Бакыт М\./)
  expect(within(panel).queryByRole('button', { name: 'Пришёл' })).toBeNull()
  expect(within(panel).queryByRole('button', { name: 'Начать приём' })).toBeNull()
  expect(within(panel).getByRole('button', { name: 'Приём состоялся' })).toHaveClass('primary')
  expect(within(panel).queryByRole('button', { name: '🚷 Неявка' })).toBeNull()
  await userEvent.click(within(panel).getByRole('button', { name: 'Приём состоялся' }))
  await waitForSlow(() => expect(statusMenu(panel)).toHaveAccessibleName('Статус: Приём состоялся'))
  expect(sent).toEqual([{ status: 'DONE' }])
})

test('по умолчанию: время приёма наступило — «🚷 Неявка» ссылкой рядом с главной, с причиной', async () => {
  fixNow(`${todayIn()}T10:10:00+06:00`, { frozen: true })
  const sent = backend(appointment(10, 1, '10:00', 'Бакыт М.', { version: 1 }))
  renderApp()
  const panel = await open(/Бакыт М\./)
  // Одна главная кнопка (DESIGN.md), «Неявка» — ссылка
  expect(within(panel).getAllByRole('button').filter((b) => b.classList.contains('primary'))).toHaveLength(1)
  const noShow = within(panel).getByRole('button', { name: '🚷 Неявка' })
  expect(noShow).toHaveClass('link')
  await userEvent.click(noShow)
  const sheet = screen.getByRole('dialog', { name: /Причина/ })
  await userEvent.click(within(sheet).getByRole('button', { name: 'Отметить неявку' }))
  await waitForSlow(() => expect(statusMenu(panel)).toHaveAccessibleName('Статус: Неявка'))
  expect(sent).toEqual([{ status: 'NO_SHOW' }])
})

test('по умолчанию: старая отметка «Пришёл» видна в пилюле, но «В кресле» не предлагается; главная — «Приём состоялся»', async () => {
  backend(appointment(10, 1, '00:05', 'Бакыт М.', { version: 1, arrivedAt: new Date().toISOString() }))
  renderApp()
  const panel = await open(/Бакыт М\./)
  expect(statusMenu(panel)).toHaveAccessibleName('Статус: Пришёл')
  expect(within(panel).getByRole('button', { name: 'Приём состоялся' })).toBeInTheDocument()
  await userEvent.click(statusMenu(panel)!)
  const menu = screen.getByRole('menu', { name: 'Статус приёма' })
  expect(within(menu).getAllByRole('menuitemradio').map((i) => i.querySelector('.menu-text')?.firstChild?.textContent))
    .toEqual(['Записан', 'Пришёл', 'Приём состоялся', 'Неявка', 'Отменён'])
  expect(within(menu).getByRole('menuitemradio', { name: /^Пришёл/ })).toHaveAttribute('aria-checked', 'true')
  expect(within(menu).getByRole('menuitemradio', { name: /^Записан/ })).toHaveTextContent('снять «Пришёл»')
})

test('отмена «Другое» с парой слов — текст уходит на сервер и виден в карточке; «Не отменять» — ничего не шлёт', async () => {
  const sent = backend(appointment(10, 1, '23:00', 'Бакыт М.', { version: 1 }))
  renderApp()
  const panel = await open(/Бакыт М\./)
  await pickStatus(panel, 'Отменён')
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Причина отмены' })).getByRole('button', { name: 'Не отменять' }))
  expect(screen.queryByRole('dialog', { name: 'Причина отмены' })).toBeNull()
  expect(sent).toEqual([])
  await pickStatus(panel, 'Отменён')
  const sheet = screen.getByRole('dialog', { name: 'Причина отмены' })
  await userEvent.click(within(sheet).getByRole('radio', { name: 'Другое' }))
  await userEvent.type(within(sheet).getByRole('textbox', { name: 'Причина — пара слов' }), 'уехал в Ош')
  await userEvent.click(within(sheet).getByRole('button', { name: 'Отменить запись' }))
  expect(await within(panel).findByText('Другое — уехал в Ош')).toBeInTheDocument()
  expect(sent).toEqual([{ status: 'CANCELLED', reason: 'OTHER', note: 'уехал в Ош' }])
})

test('«Подтвердил (придёт)» в списке — ответ пациента; «Записан» снимает его', async () => {
  const sent = backend(appointment(10, 1, '23:00', 'Бакыт М.', { version: 1 }))
  renderApp()
  const panel = await open(/Бакыт М\./)
  await pickStatus(panel, 'Подтвердил')
  await waitForSlow(() => expect(statusMenu(panel)).toHaveAccessibleName('Статус: Подтвердил'))
  await pickStatus(panel, 'Записан')
  await waitForSlow(() => expect(statusMenu(panel)).toHaveAccessibleName('Статус: Записан'))
  expect(sent).toEqual([{ reply: 'CONFIRMED' }, { reply: 'NONE' }])
})

test('заявка: «Подтвердить» рядом со статусом; «Отменён» в списке — «Отклонить заявку?», причину можно не выбирать', async () => {
  const sent = backend(appointment(10, 1, '23:00', 'Бакыт М.', { version: 1, status: 'REQUESTED' }))
  renderApp()
  const panel = await open(/Бакыт М\./)
  expect(statusMenu(panel)).toHaveAccessibleName('Статус: Заявка')
  expect(within(panel).getByRole('button', { name: 'Подтвердить' })).toHaveClass('primary')
  await pickStatus(panel, 'Отменён')
  const sheet = screen.getByRole('dialog', { name: 'Причина отмены' })
  expect(sheet).toHaveTextContent('Отклонить заявку? Пациенту придёт сообщение.')
  await userEvent.click(within(sheet).getByRole('button', { name: 'Отклонить заявку' }))
  expect(await within(panel).findByText('Заявка отклонена')).toBeInTheDocument()
  expect(sent).toEqual([{ status: 'CANCELLED' }])
})

test('«📞 Связаться ▾»: позвонить и WhatsApp сверху, напомнить о приёме — группой «Отправить пациенту»', async () => {
  backend(appointment(10, 1, '23:30', 'Бакыт М.', { version: 1 }))
  renderApp()
  const panel = await open(/Бакыт М\./)
  // Отдельных кнопок связи в карточке нет — только «Связаться»
  expect(within(panel).queryByRole('link', { name: /Позвонить/ })).toBeNull()
  expect(within(panel).queryByRole('button', { name: 'Напомнить в WhatsApp' })).toBeNull()
  await userEvent.click(contactMenu(panel)!)
  const menu = screen.getByRole('menu', { name: 'Связаться' })
  expect(within(menu).getByText('Связаться')).toHaveClass('menu-group')
  expect(within(menu).getByText('Отправить пациенту')).toHaveClass('menu-group')
  expect(within(menu).getAllByRole('menuitem').map((i) => i.querySelector('.menu-text')?.firstChild?.textContent))
    .toEqual(['Позвонить', 'Написать в WhatsApp', 'Напомнить о приёме в WhatsApp', 'Пригласить в Telegram-бот'])
  expect(within(menu).getByRole('menuitem', { name: /^Позвонить/ })).toHaveAttribute('href', 'tel:+996555123456')
})

test('один пункт связи — сразу кнопка без меню (заявка: только позвонить); ни телефона, ни бота — «Связаться» нет', async () => {
  backend(appointment(10, 1, '23:30', 'Бакыт М.', { version: 1, status: 'REQUESTED' }))
  const { unmount } = renderApp()
  const panel = await open(/Бакыт М\./)
  expect(contactMenu(panel)).toBeNull()
  expect(within(panel).getByRole('link', { name: /Позвонить/ })).toHaveAttribute('href', 'tel:+996555123456')
  unmount()

  backend(appointment(11, 1, '23:30', 'Айгуль С.', { version: 1, patient: { id: 11, fullName: 'Айгуль С.', telegram: false } }))
  renderApp()
  const none = await open(/Айгуль С\./)
  expect(contactMenu(none)).toBeNull()
  expect(within(none).queryByRole('link', { name: /Позвонить/ })).toBeNull()
  expect(within(none).getByText(/Нет Telegram и номера/)).toBeInTheDocument()
})

test('у пациента долг — «Связаться» → «Напомнить о долге»: форма с текстом сервера прямо в карточке приёма', async () => {
  backend(appointment(10, 1, '23:30', 'Бакыт М.', { version: 1 }))
  server.use(
    http.get('*/api/appointments/debts', () => HttpResponse.json([{ appointmentId: 5, patientId: 10, patientName: 'Бакыт М.', startAt: '2026-11-01T04:00:00Z', debtSom: 1500, doctorId: 1 }] as unknown as Schemas['PaymentQueryDebt'][])),
    http.get('*/api/patients/10/debt-reminder', () => HttpResponse.json({ text: 'Здравствуйте! Напоминаем о долге 1 500 сом.', telegram: false, phone: '996555123456' } as unknown as Schemas['DebtRemindersDraft'])),
  )
  renderApp()
  const panel = await open(/Бакыт М\./)
  await pickContact(panel, /^Напомнить о долге/)
  const form = await within(panel).findByRole('form', { name: 'Напоминание о долге: Бакыт М.' })
  expect(form).toHaveTextContent('Напоминаем о долге 1 500 сом')
})
