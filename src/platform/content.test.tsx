import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { todayIn } from '../lib/time'
// Настоящий готовый план из сборки (public/content/plan.json) — формат должен совпадать с контрактом импорта
import realPlan from '../../public/content/plan.json?raw'

beforeEach(() => {
  window.location.hash = '/platform'
  server.use(http.get('*/api/platform/clinics', () => HttpResponse.json([])), http.get('*/api/platform/applications', () => HttpResponse.json([])))
})
afterEach(() => {
  window.location.hash = ''
})

const owner = { ...me, owner: true, platform: true }
const today = todayIn()

const post = (id: number, extra: Partial<Schemas['ContentPostsPost']> = {}) => ({
  id, publishOn: today, kind: 'CAROUSEL', title: `Пост ${id}`, caption: '', images: [], note: '', status: 'PLANNED', ...extra,
}) satisfies Schemas['ContentPostsPost']

async function openTab() {
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('tab', { name: 'Контент' }))
  return user
}

test('владелец: пост дня с картинками, текст копируется, «Опубликовал» и «На завтра» — запросами', async () => {
  let posts = [
    post(1, { title: 'Как ухаживать за брекетами', caption: '5 советов #tish', images: ['/content/a.png', '/content/b.png'] }),
    post(2, { kind: 'REELS', title: 'Один день клиники', note: 'Ресепшен и кресло', status: 'DONE' }),
  ]
  const calls: string[] = []
  let query = ''
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/content', ({ request }) => {
      query = new URL(request.url).search
      return HttpResponse.json(posts)
    }),
    http.post('*/api/platform/content/:id/:action', ({ params }) => {
      calls.push(`${String(params.id)} ${String(params.action)}`)
      if (params.action === 'done') posts = posts.map((p) => (p.id === Number(params.id) ? { ...p, status: 'DONE' } : p))
      return HttpResponse.json(posts[0])
    }),
  )
  const user = await openTab()
  const card = await screen.findByRole('article', { name: 'Как ухаживать за брекетами' })
  expect(query).toBe(`?from=${today.slice(0, 7)}-01&to=${query.slice(-10)}`)
  expect(screen.getAllByRole('region', { name: /^Неделя / })).toHaveLength(1)
  expect(card).toHaveTextContent('Карусель')
  expect(card).toHaveTextContent('В плане')
  expect(within(card).getAllByRole('img').map((i) => i.getAttribute('src'))).toEqual(['/content/a.png', '/content/b.png'])

  await user.click(within(card).getByRole('button', { name: 'Скопировать' }))
  expect(await navigator.clipboard.readText()).toBe('5 советов #tish')
  expect(within(card).getByRole('status')).toHaveTextContent('Скопировано')

  const reels = screen.getByRole('article', { name: 'Один день клиники' })
  expect(reels).toHaveTextContent('Что снять: Ресепшен и кресло')
  expect(reels).toHaveTextContent('Опубликован')
  expect(within(reels).queryByRole('button', { name: 'Опубликовал' })).not.toBeInTheDocument()

  await user.click(within(card).getByRole('button', { name: 'На завтра' }))
  await vi.waitFor(() => expect(calls).toHaveLength(1))
  await user.click(within(card).getByRole('button', { name: 'Опубликовал' }))
  expect(await within(card).findByText('Опубликован')).toBeInTheDocument()
  expect(calls).toEqual(['1 postpone', '1 done'])
})

test('«Загрузить готовый план»: файл из /content/plan.json — в импорт, итог; нет файла — «Плана пока нет»', async () => {
  const plan = JSON.parse(realPlan) as Schemas['ContentPostsDraft'][]
  expect(plan.length).toBeGreaterThan(0)
  for (const item of plan) {
    expect(Object.keys(item).every((k) => ['date', 'kind', 'title', 'caption', 'images', 'note'].includes(k))).toBe(true)
    expect(['POST', 'CAROUSEL', 'REELS', 'STORIES']).toContain(item.kind)
    expect(item.images?.every((i) => i.startsWith('/content/'))).toBe(true)
  }
  let imported: unknown = null
  let file: unknown[] | null = plan
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/content', () => HttpResponse.json([])),
    http.get('*/content/plan.json', () => (file ? HttpResponse.json(file) : new HttpResponse(null, { status: 404 }))),
    http.post('*/api/platform/content/import', async ({ request }) => {
      imported = await request.json()
      return HttpResponse.json({ added: plan.length, updated: 0, unchanged: 0 } satisfies Schemas['ContentPostsImported'])
    }),
  )
  const user = await openTab()
  expect(await screen.findByText(/В этом месяце постов нет/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Загрузить готовый план' }))
  expect(await screen.findByText(`План загружен: добавлено ${plan.length}, обновлено 0, без изменений 0`)).toBeInTheDocument()
  expect(imported).toEqual(plan)

  file = null
  imported = null
  await user.click(screen.getByRole('button', { name: 'Загрузить готовый план' }))
  expect(await screen.findByText('Плана пока нет')).toBeInTheDocument()
  expect(imported).toBeNull()
})

test('«＋ Добавить пост»: картинки по строкам, ошибка поля — под полем', async () => {
  let sent: Schemas['ContentPostsDraft'] | null = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/content', () => HttpResponse.json([])),
    http.post('*/api/platform/content', async ({ request }) => {
      sent = (await request.json()) as Schemas['ContentPostsDraft']
      if (sent.images?.some((i) => i.startsWith('http'))) {
        return HttpResponse.json({ status: 422, detail: 'Ошибка', errors: [{ field: 'images', message: 'картинка — адрес на сайте вида /content/…' }] }, { status: 422 })
      }
      return HttpResponse.json(post(5, { title: sent.title }), { status: 201 })
    }),
  )
  const user = await openTab()
  await user.click(await screen.findByRole('button', { name: '＋ Добавить пост' }))
  const form = screen.getByRole('form', { name: 'Новый пост' })
  await user.selectOptions(within(form).getByRole('combobox', { name: 'Тип' }), 'Reels')
  await user.type(within(form).getByRole('textbox', { name: 'Название' }), 'Утро в клинике')
  await user.type(within(form).getByRole('textbox', { name: /Картинки/ }), 'https://x.example/a.png')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await within(form).findByText('картинка — адрес на сайте вида /content/…')).toBeInTheDocument()

  await user.clear(within(form).getByRole('textbox', { name: /Картинки/ }))
  await user.type(within(form).getByRole('textbox', { name: /Картинки/ }), '/content/a.png{Enter}{Enter} /content/b.png ')
  await user.type(within(form).getByRole('textbox', { name: 'Что снять' }), 'Кофе и улыбки')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await screen.findByText(/В этом месяце постов нет/)).toBeInTheDocument()
  expect(screen.queryByRole('form', { name: 'Новый пост' })).not.toBeInTheDocument()
  expect(sent).toEqual({ date: today, kind: 'REELS', title: 'Утро в клинике', caption: '', note: 'Кофе и улыбки', images: ['/content/a.png', '/content/b.png'] })
})

test('менеджеру вкладки «Контент» нет', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ doctor: false, platform: true, owner: false, fullName: 'Мира' })))
  renderApp()
  expect(await screen.findByRole('tab', { name: 'Клиники' })).toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: 'Контент' })).not.toBeInTheDocument()
})
