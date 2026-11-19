import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { readDeepLink } from '../lib/deepLink'
import { findSub, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'
import { dueText, groupTasks, quickDues } from './group'

type Task = Schemas['TaskView']

afterEach(() => {
  window.location.hash = ''
  vi.restoreAllMocks()
})

// «Сейчас» в тестах — 2026-11-11 12:00 по Бишкеку (test/now.ts). Сотрудники и пациенты вымышленные
const base = { status: 'OPEN', assigneeId: 1, assigneeName: 'Айгерим', createdById: 1, createdByName: 'Айгерим',
  createdAt: '2026-11-10T04:00:00Z', overdue: false, mine: true, canEdit: true } as const
const overdue: Task = { ...base, id: 1, title: 'Перезвонить после удаления', dueAt: '2026-11-11T03:00:00Z', overdue: true, patientId: 2, patientName: 'Айгуль Т.' }
const today: Task = { ...base, id: 2, title: 'Напомнить про оплату', dueAt: '2026-11-11T12:00:00Z' }
const later: Task = { ...base, id: 3, title: 'Отправить снимок в лабораторию', dueAt: '2026-11-13T04:00:00Z' }
const someone: Task = { ...base, id: 4, title: 'Заказать композит', assigneeId: 9, assigneeName: 'Бермет', mine: false, canEdit: false }

function backend(start: Task[]) {
  let tasks = [...start]
  const calls: string[] = []
  const created: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/patients/recent', () => HttpResponse.json([{ id: 2, fullName: 'Айгуль Т.', phone: '996700333444', telegram: false }])),
    http.get('*/api/appointments/by-patient/2', () => HttpResponse.json({ patient: { id: 2, fullName: 'Айгуль Т.', phone: '996700333444', telegram: false }, done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [] })),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/tasks/summary', () => HttpResponse.json({ overdue: tasks.filter((t) => t.status === 'OPEN' && t.overdue && t.mine).length })),
    http.get('*/api/tasks/assignees', () => HttpResponse.json([
      { telegramId: 1, fullName: 'Айгерим', role: 'руководитель', me: true },
      { telegramId: 9, fullName: 'Бермет', role: 'ассистент', me: false },
    ] satisfies Schemas['TaskControllerAssignee'][])),
    http.get('*/api/tasks', ({ request }) => {
      const q = new URL(request.url).searchParams
      calls.push(`list ${q.toString()}`)
      const status = q.get('status') ?? 'OPEN'
      return HttpResponse.json(tasks.filter((t) => t.status === status && (q.get('mine') !== 'true' || t.mine)
        && (!q.get('patientId') || t.patientId === Number(q.get('patientId')))))
    }),
    http.post('*/api/tasks', async ({ request }) => {
      const body = (await request.json()) as Schemas['NewTask']
      created.push(body)
      const task: Task = { ...base, id: 50, title: body.title, dueAt: body.dueAt, patientId: body.patientId, patientName: 'Айгуль Т.' }
      tasks = [...tasks, task]
      return HttpResponse.json(task, { status: 201 })
    }),
    http.post('*/api/tasks/:id/done', ({ params }) => {
      calls.push(`done ${params.id}`)
      tasks = tasks.map((t) => (t.id === Number(params.id) ? { ...t, status: 'DONE', doneAt: '2026-11-11T06:00:00Z', doneByName: 'Айгерим' } : t))
      return HttpResponse.json(tasks.find((t) => t.id === Number(params.id)))
    }),
    http.post('*/api/tasks/:id/reopen', ({ params }) => {
      calls.push(`reopen ${params.id}`)
      tasks = tasks.map((t) => (t.id === Number(params.id) ? { ...t, status: 'OPEN', doneAt: undefined } : t))
      return HttpResponse.json(tasks.find((t) => t.id === Number(params.id)))
    }),
  )
  return { calls, created }
}

test('группы по сроку по Бишкеку и короткий срок', () => {
  const groups = groupTasks([later, { ...base, id: 5, title: 'Без срока' }, today, overdue])
  expect(groups.map(([g, list]) => [g, list.map((t) => t.id)])).toEqual([['overdue', [1]], ['today', [2]], ['later', [3]], ['none', [5]]])
  expect(dueText(today.dueAt!)).toBe('18:00')
  expect(dueText('2026-11-10T04:00:00Z')).toBe('вчера, 10:00')
  expect(dueText('2026-11-12T04:00:00Z')).toBe('завтра, 10:00')
  // До 18:00 — «Сегодня 18:00» есть, после — нет
  expect(quickDues().map((q) => q.label)).toEqual(['Сегодня 18:00', 'Завтра 10:00', 'Через неделю'])
  expect(quickDues(new Date('2026-11-11T19:00:00+06:00')).map((q) => q.label)).toEqual(['Завтра 10:00', 'Через неделю'])
  expect(readDeepLink('?screen=tasks&task=5')).toEqual({ page: 'patients', tab: 'tasks', taskId: 5 })
})

test('«Задачи»: счётчик просроченных, группы, галочка — выполнить, «Вернуть» — назад', async () => {
  window.location.hash = '/patients'
  const { calls } = backend([overdue, today, later])
  renderApp()
  // Число у подраздела — мои просроченные, заметное
  await userEvent.click(await findSub('Задачи · 1'))
  const overdueGroup = await screen.findByRole('region', { name: 'Просрочено' })
  expect(overdueGroup).toHaveTextContent('Перезвонить после удаления')
  expect(overdueGroup).toHaveTextContent('пациент: Айгуль Т.')
  expect(within(overdueGroup).getByText('09:00')).toHaveClass('overdue')
  expect(screen.getByRole('region', { name: 'Сегодня' })).toHaveTextContent('Напомнить про оплату')
  expect(screen.getByRole('region', { name: 'Позже' })).toHaveTextContent('Отправить снимок в лабораторию')

  await userEvent.click(within(overdueGroup).getByRole('checkbox', { name: 'Выполнить: Перезвонить после удаления' }))
  const undo = await screen.findByRole('status')
  expect(undo).toHaveTextContent('Выполнено: Перезвонить после удаления')
  await waitForSlow(() => expect(screen.queryByRole('region', { name: 'Просрочено' })).toBeNull())
  await userEvent.click(within(undo).getByRole('button', { name: 'Вернуть' }))
  expect(await screen.findByRole('region', { name: 'Просрочено' })).toBeInTheDocument()
  expect(calls).toContain('done 1')
  expect(calls).toContain('reopen 1')
})

test('«Мои / Все»: сначала мои, «Все» — задачи коллег с именем исполнителя', async () => {
  window.location.hash = '/patients/tasks'
  const { calls } = backend([today, someone])
  renderApp()
  expect(await screen.findByText('Напомнить про оплату')).toBeInTheDocument()
  expect(screen.queryByText('Заказать композит')).toBeNull()
  expect(calls).toContain('list status=OPEN&mine=true')
  await userEvent.click(screen.getByRole('button', { name: 'Все' }))
  const row = (await screen.findByText('Заказать композит')).closest('li')!
  expect(row).toHaveTextContent('Бермет')
  // Чужую задачу не изменить: в «⋯» нет «Изменить» и «Удалить» (выполнить можно)
  expect(within(row).queryByRole('button', { name: /^Ещё/ })).toBeNull()
  expect(within(row).getByRole('checkbox', { name: 'Выполнить: Заказать композит' })).toBeEnabled()
})

test('карточка пациента: «＋ Задача» с этим пациентом, «Завтра 10:00» — срок по Бишкеку; блок «Задачи»', async () => {
  window.location.hash = '/patients'
  const { created } = backend([])
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Айгуль Т.' }))
  const panel = await screen.findByRole('complementary', { name: 'Карточка пациента' })
  // «＋ Задача» — ссылкой в строке под сводкой; блока «Задачи», пока их нет, тоже нет (пустых строк нет)
  await userEvent.click(await within(panel).findByRole('button', { name: '＋ Задача' }))
  expect(within(panel).queryByRole('region', { name: 'Задачи пациента' })).toBeNull()
  const dialog = await screen.findByRole('dialog', { name: 'Новая задача' })
  expect(dialog).toHaveTextContent('Пациент: Айгуль Т.')
  await userEvent.type(within(dialog).getByLabelText('Что сделать'), 'Перезвонить после удаления')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Завтра 10:00' }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Создать' }))
  await waitForSlow(() => expect(screen.queryByRole('dialog')).toBeNull())
  // Исполнитель не выбран — сервер поставит автора; цену и прочее не шлём
  expect(created).toEqual([{ title: 'Перезвонить после удаления', dueAt: '2026-11-12T04:00:00.000Z', patientId: 2 }])
  const block = await within(panel).findByRole('region', { name: 'Задачи пациента' })
  expect(await within(block).findByText('Перезвонить после удаления')).toBeInTheDocument()
  expect(block).toHaveTextContent('Задачи 1')
})

test('«✏️ Изменить» под карточкой задачи помощника в боте (?assist=токен): окно задачи с полями из черновика', async () => {
  backend([])
  const tokens: string[] = []
  server.use(http.post('*/api/assist/draft', async ({ request }) => {
    tokens.push(((await request.json()) as { token: string }).token)
    return HttpResponse.json({ kind: 'TASK', title: 'Перезвонить Асель', dueAt: '2026-11-12T04:00:00Z', assigneeId: 9,
      patient: { id: 2, fullName: 'Айгуль Т.', phone: '996700333444', telegram: false } } satisfies Schemas['AssistDraft'])
  }))
  window.history.replaceState(null, '', '/?assist=AbCdEfGhIjKlMnOpQrStUv')
  renderApp()

  const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 })
  expect(within(dialog).getByRole('textbox', { name: 'Что сделать' })).toHaveValue('Перезвонить Асель')
  expect(within(dialog).getByText('Айгуль Т.')).toBeInTheDocument()
  expect(tokens).toEqual(['AbCdEfGhIjKlMnOpQrStUv'])
  // В адресе токена больше нет: одноразовый
  expect(window.location.search).toBe('')
  expect(readDeepLink('?assist=AbCdEfGhIjKlMnOpQrStUv')).toEqual({ page: 'schedule', assistToken: 'AbCdEfGhIjKlMnOpQrStUv' })
})
