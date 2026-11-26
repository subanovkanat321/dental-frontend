import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, findSub, querySub } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'
import { filterText, insertAt, patientsText, tasksText } from './groupsModel'

/** Вымышленные пациенты и группы. */
const groups: Schemas['SegmentServiceGroups'] = {
  ready: [
    { kind: 'READY', ready: 'LAPSED_6', name: 'Не были 6+ месяцев', count: 2, canEdit: false },
    { kind: 'READY', ready: 'DEBT', name: 'Долг', count: 0, canEdit: false },
  ],
  tags: [{ kind: 'TAG', tagId: 5, name: 'С меткой «Боится»', count: 1, canEdit: false }],
  custom: [{ kind: 'CUSTOM', groupId: 7, name: 'Без бота, были за год', count: 1, canEdit: true, filter: { inBot: false, lastVisitNewerMonths: 12 } }],
}

const members: Schemas['SegmentServiceMembers'] = {
  name: 'Не были 6+ месяцев', total: 2, inBot: 1, optedOut: 0, taskTitle: 'Позвонить: давно не был — предложить осмотр',
  messageText: 'Здравствуйте, {имя}! Запишитесь на осмотр.',
  patients: [
    { patientId: 21, fullName: 'Тест Бермет', phone: '996555009002', lastVisit: '2025-09-20T04:00:00Z', doctorId: 2, doctor: 'Дастан Т.',
      reason: 'не был 1 год 2 мес.', inBot: false, optedOut: false, booked: false },
    { patientId: 22, fullName: 'Тест Айбек', lastVisit: '2026-03-20T04:00:00Z', doctorId: 1, doctor: 'Айгерим Садыкова', reason: 'не был 8 мес.',
      inBot: true, optedOut: true, booked: false },
  ],
  history: [{ id: 40, kind: 'MESSAGE', at: '2026-11-10T04:00:00Z', by: 'Айгерим', reached: 2, booked: 1, skipped: 0 }],
}

const message = (extra: Partial<Schemas['SegmentServiceMessageView']> = {}): Schemas['SegmentServiceMessageView'] => ({
  id: 41, name: 'Не были 6+ месяцев', at: '2026-11-23T04:00:00Z', bot: 1, sent: 0, failed: 0, whatsapp: 1, written: 0,
  skipped: [{ patientId: 23, fullName: 'Тест Гулина', reason: 'RECENT' }],
  queue: [{ patientId: 21, fullName: 'Тест Бермет', phone: '996555009002', text: '🦷 Сообщение от клиники\n\nЗдравствуйте, Тест Бермет!', written: false }],
  running: true, booked: 0, auditText: 'в бот 1, WhatsApp 1, пропущено 1', ...extra,
})

beforeEach(() => {
  window.location.hash = '/patients'
  vi.stubGlobal('open', vi.fn())
})
afterEach(() => {
  window.location.hash = ''
  vi.unstubAllGlobals()
})

function base() {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([])),
    http.get('*/api/patient-groups', () => HttpResponse.json(groups)),
    http.get('*/api/patient-groups/members', () => HttpResponse.json(members)),
    http.get('*/api/patient-tags', () => HttpResponse.json([])),
    http.get('*/api/service-types', () => HttpResponse.json([])),
    http.get('*/api/tasks/assignees', () => HttpResponse.json([
      { telegramId: 111, fullName: 'Айгерим', role: 'Руководитель', me: true },
      { telegramId: 5901, fullName: 'Бермет Регистратура', role: 'Регистратура', me: false },
    ] satisfies Schemas['TaskControllerAssignee'][])),
  )
}

/** «Позвать снова» → карточка «Не были 6+ месяцев» (до 2026-11-24 — «Группы» → группа). */
async function openGroup(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await findSub('Позвать снова'))
  await user.click(within(await screen.findByRole('group', { name: 'Кого позвать' })).getByRole('button', { name: /Не были 6\+ месяцев/ }))
  return screen.findByRole('list', { name: 'Не были 6+ месяцев' })
}

test('слова и подстановки', () => {
  expect(patientsText(1)).toBe('1 пациент')
  expect(patientsText(3)).toBe('3 пациента')
  expect(patientsText(12)).toBe('12 пациентов')
  expect(tasksText(2)).toBe('2 задачи')
  expect(tasksText(5)).toBe('5 задач')
  expect(insertAt('Здравствуйте, !', '{имя}', 14, 14)).toEqual({ text: 'Здравствуйте, {имя}!', caret: 19 })
  expect(insertAt('Текст', '{врач}', null, null).text).toBe('Текст{врач}')
  expect(filterText({ inBot: false, lastVisitOlderMonths: 6, notBooked: true }, {})).toBe('не были 6+ мес. · без бота · без записи')
})

test('карточки групп с числами, пустые скрыты, своя группа с ✏️; старый адрес «Группы»; ассистенту нет', async () => {
  base()
  const asked: string[] = []
  server.use(http.get('*/api/patient-groups/members', ({ request }) => {
    asked.push(new URL(request.url).searchParams.toString())
    return HttpResponse.json(members)
  }))
  // Старая ссылка «Группы» (плитка «Аналитики», закладка) — «Позвать снова»
  window.location.hash = '/patients/groups'
  const user = userEvent.setup()
  const { unmount } = renderApp()
  const cards = await screen.findByRole('group', { name: 'Кого позвать' })
  expect(window.location.hash).toBe('#/patients/comeback')
  expect(querySub('Группы')).toBeNull()
  await waitFor(() => expect(within(cards).getByRole('button', { name: /Не были 6\+ месяцев/ })).toHaveTextContent('2'))
  // «Долг» пустой — не видно; карточек меток нет (метка — условие своей группы)
  expect(within(cards).queryByRole('button', { name: /Долг/ })).toBeNull()
  expect(within(cards).queryByRole('button', { name: /Боится/ })).toBeNull()
  const own = within(cards).getByRole('button', { name: /Без бота, были за год/ })
  expect(own).toHaveTextContent('1')
  expect(own).toHaveAttribute('title', 'были за 12 мес. · без бота')
  await user.click(own)
  expect(own).toHaveAttribute('aria-pressed', 'true')
  expect(window.location.hash).toBe('#/patients/comeback/group-7')
  await waitFor(() => expect(asked.at(-1)).toContain('groupId=7'))
  expect(screen.getByRole('button', { name: 'Изменить группу: Без бота, были за год' })).toBeInTheDocument()
  // Своя группа — по адресу (обновили страницу)
  unmount()
  renderApp()
  expect(within(await screen.findByRole('group', { name: 'Кого позвать' })).getByRole('button', { name: /Без бота, были за год/ }))
    .toHaveAttribute('aria-pressed', 'true')
})

test('ассистенту «Позвать снова» нет — у него «Профосмотр»', async () => {
  base()
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, doctorId: undefined, assistantOf: [1] })))
  renderApp()
  await findSub('Профосмотр')
  expect(querySub('Позвать снова')).toBeNull()
  expect(querySub('Группы')).toBeNull()
})

test('редактор своей группы: условия, число подходящих, сохранить', async () => {
  base()
  const counts: unknown[] = []
  const saved: unknown[] = []
  server.use(
    http.post('*/api/patient-groups/count', async ({ request }) => {
      counts.push(await request.json())
      return HttpResponse.json({ total: 3 } satisfies Schemas['SegmentServiceCount'])
    }),
    http.post('*/api/patient-groups', async ({ request }) => {
      const body = await request.json() as Schemas['SegmentServiceSaveGroup']
      saved.push(body)
      return HttpResponse.json({ kind: 'CUSTOM', groupId: 8, name: body.name, count: 3, canEdit: true, filter: body.filter } satisfies Schemas['SegmentServiceGroupItem'])
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Позвать снова'))
  await user.click(within(await screen.findByRole('group', { name: 'Кого позвать' })).getByRole('button', { name: /Своя группа/ }))
  const dialog = await screen.findByRole('dialog', { name: 'Своя группа' })
  await user.type(within(dialog).getByLabelText('Название'), 'Давно без бота')
  await choose(within(dialog).getByLabelText('Последний визит больше'), '6 мес. назад')
  await user.click(within(dialog).getByRole('button', { name: 'Без бота' }))
  expect(await within(dialog).findByText(/Подходит:/)).toHaveTextContent('Подходит: 3 пациента')
  await waitFor(() => expect(counts.at(-1)).toEqual({ lastVisitOlderMonths: 6, inBot: false, notBooked: true }))
  await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(saved).toEqual([{ name: 'Давно без бота', filter: { lastVisitOlderMonths: 6, inBot: false, notBooked: true } }]))
  // Сохранили — сразу открыта её карточка
  await waitFor(() => expect(window.location.hash).toBe('#/patients/comeback/group-8'))
})

test('карточка группы: пациенты, «⋯» строки, «Позвать всех» → задачи на обзвон одним нажатием, «Что уже делали» внизу', async () => {
  base()
  const created: Schemas['SegmentServiceTasksRequest'][] = []
  server.use(http.post('*/api/patient-groups/tasks', async ({ request }) => {
    created.push(await request.json() as Schemas['SegmentServiceTasksRequest'])
    return HttpResponse.json({ actionId: 1, created: 1, skipped: 1, total: 2, auditText: 'задач 1' } satisfies Schemas['SegmentServiceTasksResult'])
  }))
  const user = userEvent.setup()
  renderApp()
  const list = await openGroup(user)
  const items = within(list).getAllByRole('listitem')
  expect(items[0]).toHaveTextContent('Тест Бермет')
  expect(items[0]).toHaveTextContent('не был 1 год 2 мес. · Дастан Т.')
  expect(items[1]).toHaveTextContent('без сообщений')
  expect(screen.getByLabelText('В группе')).toHaveTextContent('2 пациента · в боте 1')
  // В строке — «Связаться» (есть номер); в «⋯» — записать и задача (у группы своих «Не звать» нет)
  expect(within(items[0]!).getByRole('button', { name: /Связаться|Позвонить/ })).toBeInTheDocument()
  await user.click(within(items[0]!).getByRole('button', { name: 'Ещё: Тест Бермет' }))
  expect(within(items[0]!).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['＋ Записать', '＋ Задача'])
  await user.click(within(items[0]!).getByRole('menuitem', { name: '＋ Задача' }))
  expect(await screen.findByDisplayValue('Позвонить: давно не был — предложить осмотр')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  // «Что уже делали» — внизу, свёрнуто
  await user.click(screen.getByText('Что уже делали и кто вернулся'))
  expect(screen.getByRole('region', { name: 'Что уже делали' })).toHaveTextContent('записались 1')

  await user.click(screen.getByRole('button', { name: 'Позвать всех 2' }))
  const dialog = await screen.findByRole('dialog', { name: 'Позвать группу' })
  expect(within(dialog).getByRole('radio', { name: /Задачи на обзвон/ })).toHaveAttribute('aria-checked', 'true')
  expect(within(dialog).getByDisplayValue('Позвонить: давно не был — предложить осмотр')).toBeInTheDocument()
  await choose(within(dialog).getByLabelText('Кому'), 'Бермет Регистратура — Регистратура')
  await user.click(within(dialog).getByRole('button', { name: 'Создать 2 задачи' }))
  expect(await within(dialog).findByRole('status')).toHaveTextContent('Создано: 1 задача · у 1 пациент такая задача уже есть')
  expect(created[0]).toMatchObject({ group: { ready: 'LAPSED_6' }, title: 'Позвонить: давно не был — предложить осмотр', assigneeId: 5901 })
  expect(created[0]!.dueAt).toBeTruthy()
})

test('«Сообщение»: подстановка, предпросмотр, отправка, ход в бот и WhatsApp по очереди', async () => {
  base()
  let sent: Schemas['SegmentServiceMessageRequest'] | null = null
  let view = message()
  server.use(
    http.post('*/api/patient-groups/preview', async ({ request }) => {
      const body = await request.json() as Schemas['SegmentServiceMessageRequest']
      return HttpResponse.json({ text: body.text.replace('{имя}', 'Тест Бермет'), fullName: 'Тест Бермет' } satisfies Schemas['SegmentServicePreview'])
    }),
    http.post('*/api/patient-groups/send', async ({ request }) => {
      sent = await request.json() as Schemas['SegmentServiceMessageRequest']
      return HttpResponse.json(view)
    }),
    http.get('*/api/patient-groups/messages/41', () => HttpResponse.json(view)),
    http.post('*/api/patient-groups/messages/41/written/21', () => {
      view = message({ written: 1, running: false, sent: 1, queue: [{ ...view.queue[0]!, written: true }] })
      return HttpResponse.json(view)
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await openGroup(user)
  await user.click(screen.getByRole('button', { name: 'Позвать всех 2' }))
  const dialog = await screen.findByRole('dialog', { name: 'Позвать группу' })
  await user.click(within(dialog).getByRole('radio', { name: /Сообщение/ }))
  const text = within(dialog).getByLabelText('Текст')
  expect(text).toHaveValue('Здравствуйте, {имя}! Запишитесь на осмотр.')
  await user.click(text)
  await user.keyboard('{End}')
  await user.click(within(dialog).getByRole('button', { name: '＋ Врач' }))
  expect(text).toHaveValue('Здравствуйте, {имя}! Запишитесь на осмотр.{врач}')
  expect(await within(dialog).findByText(/Здравствуйте, Тест Бермет! Запишитесь/)).toBeInTheDocument()
  expect(within(dialog).getByText(/Так увидит Тест Бермет/)).toBeInTheDocument()
  expect(dialog).toHaveTextContent('В бот: 1')
  await user.click(within(dialog).getByRole('button', { name: 'Отправить' }))

  const progress = await screen.findByRole('dialog', { name: 'Сообщение группе' })
  expect(sent).toMatchObject({ group: { ready: 'LAPSED_6' }, text: 'Здравствуйте, {имя}! Запишитесь на осмотр.{врач}' })
  expect(within(progress).getByLabelText('В бот')).toHaveTextContent('В бот: отправлено 0 из 1')
  expect(within(progress).getByText('Пропущено: 1')).toBeInTheDocument()
  const queue = within(progress).getByLabelText('WhatsApp по очереди')
  expect(queue).toHaveTextContent('Тест Бермет')
  await user.click(within(queue).getByRole('button', { name: 'Открыть WhatsApp' }))
  const url = decodeURIComponent(String(vi.mocked(window.open).mock.calls[0]?.[0]))
  expect(url).toContain('996555009002')
  expect(url).toContain('Здравствуйте, Тест Бермет!')
  await user.click(within(queue).getByRole('button', { name: '✓ Написали' }))
  expect(await within(progress).findByText('Всем написали ✓')).toBeInTheDocument()
  expect(within(progress).getByLabelText('WhatsApp по очереди')).toHaveTextContent('написали 1 из 1')
  expect(within(progress).getByLabelText('В бот')).toHaveTextContent('отправлено 1 из 1')
})

test('ошибка сервера под текстом — неизвестная подстановка', async () => {
  base()
  server.use(
    http.post('*/api/patient-groups/preview', () => HttpResponse.json(
      { status: 422, detail: 'Проверьте поля', errors: [{ field: 'text', message: 'Неизвестная подстановка {имя }' }] }, { status: 422 })),
    http.post('*/api/patient-groups/send', () => HttpResponse.json(
      { status: 422, detail: 'Проверьте поля', errors: [{ field: 'text', message: 'Неизвестная подстановка {имя }' }] }, { status: 422 })),
  )
  const user = userEvent.setup()
  renderApp()
  await openGroup(user)
  await user.click(screen.getByRole('button', { name: 'Позвать всех 2' }))
  const dialog = await screen.findByRole('dialog', { name: 'Позвать группу' })
  await user.click(within(dialog).getByRole('radio', { name: /Сообщение/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Отправить' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Неизвестная подстановка {имя }')
})

test('«Позвать всех» у карточек «Позвать снова»: «Отменили» — группа CANCELLED, «План отправлен» — PLAN_SENT', async () => {
  base()
  const day = 86_400_000
  const asked: (string | null)[] = []
  const created: Schemas['SegmentServiceTasksRequest'][] = []
  server.use(
    http.get('*/api/comebacks', () => HttpResponse.json({
      patients: [{ patientId: 5, fullName: 'Тест Динара', phone: '996555000295', telegram: false, reason: 'CANCELLED', planSom: 0, plan: [], invites: 0, urgent: 0,
        planSentAt: '2026-11-03T05:00:00Z', cancelled: { at: new Date(Date.now() - 3 * day).toISOString(), source: 'PATIENT', service: 'Чистка', doctorId: 2,
          doctor: 'Дастан Т.', startAt: '2026-11-08T05:00:00Z', minutes: 60 } }],
      planSom: 0, planPatients: 0, noShows: 0, recalls: 0, cancelled: 1, total: 1, sent: 1, agreed: 0,
    } satisfies Schemas['ComebacksBoard'])),
    http.get('*/api/patient-groups/members', ({ request }) => {
      const ready = new URL(request.url).searchParams.get('ready')
      asked.push(ready)
      return HttpResponse.json({ ...members, name: ready === 'CANCELLED' ? 'Отменили' : 'План отправлен', total: 1, patients: [],
        taskTitle: ready === 'CANCELLED' ? 'Позвонить: отменил запись — предложить другое время' : 'Позвонить: обсудить отправленный план лечения', history: [] })
    }),
    http.post('*/api/patient-groups/tasks', async ({ request }) => {
      created.push(await request.json() as Schemas['SegmentServiceTasksRequest'])
      return HttpResponse.json({ actionId: 2, created: 1, skipped: 0, total: 1, auditText: 'задач 1' } satisfies Schemas['SegmentServiceTasksResult'])
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Позвать снова'))
  const cards = await screen.findByRole('group', { name: 'Кого позвать' })
  await user.click(within(cards).getByRole('button', { name: /Отменили/ }))
  // Строка «Отменили»: «Напомнить» в строке, в «⋯» — «Записать» и «Не звать»
  const row = within(await screen.findByRole('list', { name: 'Кого вернуть' })).getAllByRole('listitem')[0]!
  expect(within(row).getByRole('button', { name: 'Напомнить' })).toBeInTheDocument()
  await user.click(within(row).getByRole('button', { name: 'Ещё: Тест Динара' }))
  expect(within(row).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Записать', 'Не звать'])
  await user.keyboard('{Escape}')
  await user.click(await screen.findByRole('button', { name: 'Позвать всех 1' }))
  const dialog = await screen.findByRole('dialog', { name: 'Позвать группу' })
  expect(dialog).toHaveTextContent('Отменили · 1 пациент')
  await user.click(within(dialog).getByRole('button', { name: 'Создать 1 задача' }))
  await waitFor(() => expect(created[0]).toMatchObject({ group: { ready: 'CANCELLED' }, title: 'Позвонить: отменил запись — предложить другое время' }))
  await user.click(within(dialog).getByRole('button', { name: 'Готово' }))

  await user.click(within(cards).getByRole('button', { name: /План отправлен/ }))
  await waitFor(() => expect(asked.at(-1)).toBe('PLAN_SENT'))
  expect(window.location.hash).toBe('#/patients/comeback/sent')
})
