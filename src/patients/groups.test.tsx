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

async function openGroup(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await findSub('Группы'))
  await user.click(await screen.findByRole('button', { name: 'Не были 6+ месяцев' }))
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

test('список групп с числами, своя группа с ✏️; ассистенту подраздела нет', async () => {
  base()
  const user = userEvent.setup()
  const { unmount } = renderApp()
  await user.click(await findSub('Группы'))
  const ready = await screen.findByRole('region', { name: 'Готовые группы' })
  expect(within(ready).getAllByRole('listitem')[0]).toHaveTextContent('Не были 6+ месяцев')
  expect(within(ready).getAllByRole('listitem')[0]).toHaveTextContent('2')
  expect(screen.getByRole('region', { name: 'По меткам' })).toHaveTextContent('С меткой «Боится»')
  const own = screen.getByRole('region', { name: 'Свои группы' })
  expect(own).toHaveTextContent('были за 12 мес. · без бота')
  expect(within(own).getByRole('button', { name: 'Изменить группу: Без бота, были за год' })).toBeInTheDocument()
  unmount()

  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, doctorId: undefined, assistantOf: [1] })))
  window.location.hash = '/patients'
  renderApp()
  await findSub('Все')
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
  await user.click(await findSub('Группы'))
  await user.click(await screen.findByRole('button', { name: '＋ Своя группа' }))
  const dialog = await screen.findByRole('dialog', { name: 'Своя группа' })
  await user.type(within(dialog).getByLabelText('Название'), 'Давно без бота')
  await choose(within(dialog).getByLabelText('Последний визит больше'), '6 мес. назад')
  await user.click(within(dialog).getByRole('button', { name: 'Без бота' }))
  expect(await within(dialog).findByText(/Подходит:/)).toHaveTextContent('Подходит: 3 пациента')
  await waitFor(() => expect(counts.at(-1)).toEqual({ lastVisitOlderMonths: 6, inBot: false, notBooked: true }))
  await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(saved).toEqual([{ name: 'Давно без бота', filter: { lastVisitOlderMonths: 6, inBot: false, notBooked: true } }]))
  // Сохранили — сразу открылась группа
  expect(await screen.findByRole('heading', { name: /Не были 6\+ месяцев|Давно без бота/ })).toBeInTheDocument()
})

test('страница группы: пациенты, «Позвать группу» → задачи на обзвон одним нажатием', async () => {
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
  expect(screen.getByRole('region', { name: 'Что уже делали' })).toHaveTextContent('записались 1')

  await user.click(screen.getByRole('button', { name: 'Позвать группу' }))
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
  await user.click(screen.getByRole('button', { name: 'Позвать группу' }))
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
  await user.click(screen.getByRole('button', { name: 'Позвать группу' }))
  const dialog = await screen.findByRole('dialog', { name: 'Позвать группу' })
  await user.click(within(dialog).getByRole('radio', { name: /Сообщение/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Отправить' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Неизвестная подстановка {имя }')
})
