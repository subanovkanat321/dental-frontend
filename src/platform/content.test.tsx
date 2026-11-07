import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { todayIn } from '../lib/time'
// Настоящий готовый план из сборки (public/content/plan.json) — формат должен совпадать с контрактом импорта
import realPlan from '../../public/content/plan.json?raw'
import { choose } from '../test/select'

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
      return HttpResponse.json({ added: plan.length, updated: 0, unchanged: 0, removed: 3 } satisfies Schemas['ContentPostsImported'])
    }),
  )
  const user = await openTab()
  expect(await screen.findByText(/В этом месяце постов нет/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Загрузить готовый план' }))
  expect(await screen.findByText(`План загружен: добавлено ${plan.length}, обновлено 0, без изменений 0, убрано из старого плана 3`)).toBeInTheDocument()
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
  await choose(within(form).getByRole('combobox', { name: 'Тип' }), 'Рилс')
  await user.type(within(form).getByRole('textbox', { name: 'Название' }), 'Утро в клинике')
  await user.type(within(form).getByRole('textbox', { name: /Картинки/ }), 'https://x.example/a.png')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  // Ошибка поля — под полем и в полосе «Сохранить» (поле может быть выше, за краем экрана)
  expect(await within(form).findByRole('alert')).toHaveTextContent('картинка — адрес на сайте вида /content/…')
  expect(within(form).getAllByText('картинка — адрес на сайте вида /content/…')).toHaveLength(2)

  await user.clear(within(form).getByRole('textbox', { name: /Картинки/ }))
  await user.type(within(form).getByRole('textbox', { name: /Картинки/ }), '/content/a.png{Enter}{Enter} /content/b.png ')
  await user.type(within(form).getByRole('textbox', { name: 'Что снять' }), 'Кофе и улыбки')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await screen.findByText(/В этом месяце постов нет/)).toBeInTheDocument()
  expect(screen.queryByRole('form', { name: 'Новый пост' })).not.toBeInTheDocument()
  expect(sent).toEqual({ date: today, kind: 'REELS', title: 'Утро в клинике', caption: '', note: 'Кофе и улыбки', images: ['/content/a.png', '/content/b.png'] })
})

test('Instagram подключён: «Опубликовать в Instagram» после подтверждения, бейдж со ссылкой; ошибка — текстом', async () => {
  let posts = [
    post(1, { kind: 'POST', title: 'Тишка', images: ['/content/a.png'] }),
    post(2, { kind: 'REELS', title: 'Видео', images: ['/content/v.png'] }),
    post(3, { kind: 'STORIES', title: 'Опрос', images: ['/content/s.png'] }),
  ]
  const published: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/content', () => HttpResponse.json(posts)),
    http.get('*/api/platform/content/instagram', () =>
      HttpResponse.json({ enabled: true, expiresAt: '2027-01-04T06:00:00Z' } satisfies Schemas['InstagramTokensState'])),
    http.post('*/api/platform/content/:id/publish', ({ params }) => {
      published.push(String(params.id))
      if (params.id === '3') {
        return HttpResponse.json({ status: 409, title: 'Conflict', code: 'instagram-failed',
          detail: 'Токен Instagram истёк или отозван — получите новый и пропишите INSTAGRAM_TOKEN в .env' }, { status: 409 })
      }
      posts = posts.map((p) => (p.id === 1 ? { ...p, status: 'DONE', instagramMediaId: 'm1', instagramUrl: 'https://www.instagram.com/p/T1/' } : p))
      return HttpResponse.json(posts[0]!)
    }),
  )
  const user = await openTab()
  expect(await screen.findByText(/Instagram подключён · токен до 4 янв 2027/)).toBeInTheDocument()
  const card = await screen.findByRole('article', { name: 'Тишка' })
  // У Reels видео нет — публиковать вручную
  expect(within(screen.getByRole('article', { name: 'Видео' })).queryByRole('button', { name: 'Опубликовать в Instagram' })).not.toBeInTheDocument()

  // Отмена в окне — запроса нет
  await user.click(within(card).getByRole('button', { name: 'Опубликовать в Instagram' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('Опубликовать «Тишка» в Instagram? Пост выйдет сразу.')
  await user.click(within(dialog).getByRole('button', { name: 'Отмена' }))
  expect(published).toEqual([])

  await user.click(within(card).getByRole('button', { name: 'Опубликовать в Instagram' }))
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Опубликовать' }))
  const badge = await within(card).findByRole('link', { name: 'В Instagram ↗' })
  expect(badge).toHaveAttribute('href', 'https://www.instagram.com/p/T1/')
  expect(within(card).getByText('Опубликован')).toBeInTheDocument()
  expect(within(card).queryByRole('button', { name: 'Опубликовать в Instagram' })).not.toBeInTheDocument()

  const story = screen.getByRole('article', { name: 'Опрос' })
  await user.click(within(story).getByRole('button', { name: 'Опубликовать в Instagram' }))
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Опубликовать' }))
  expect(await within(story).findByRole('alert')).toHaveTextContent('Токен Instagram истёк')
  expect(within(story).getByRole('button', { name: 'Опубликовать в Instagram' })).toBeEnabled()
  expect(published).toEqual(['1', '3'])
})

test('Instagram не подключён: кнопок публикации нет, подсказка про переменные окружения', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/content', () => HttpResponse.json([post(1, { kind: 'POST', title: 'Тишка', images: ['/content/a.png'] })])),
  )
  await openTab()
  const card = await screen.findByRole('article', { name: 'Тишка' })
  expect(await screen.findByRole('note')).toHaveTextContent('INSTAGRAM_USER_ID и INSTAGRAM_TOKEN')
  expect(within(card).queryByRole('button', { name: 'Опубликовать в Instagram' })).not.toBeInTheDocument()
})

test('менеджеру вкладки «Контент» нет', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ doctor: false, platform: true, owner: false, fullName: 'Мира' })))
  renderApp()
  expect(await screen.findByRole('tab', { name: 'Клиники' })).toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: 'Контент' })).not.toBeInTheDocument()
})

test('рилс в плане: плеер с обложкой, время; публикация — в фоне (202), «Публикуется в Instagram»', async () => {
  const video = '02-chto-dumaet-stomatolog/02-chto-dumaet-stomatolog.mp4'
  let posts = [
    post(7, { kind: 'REELS', title: 'Что думает стоматолог', caption: 'POV #tish', publishTime: '19:30:00', video,
      videoUrl: `/web/materials/reel/${video}?exp=1&sig=a`, coverUrl: '/web/materials/reel/02-chto-dumaet-stomatolog/cover.png?exp=1&sig=b' }),
    post(8, { kind: 'REELS', title: 'Пропал', video: '05-x/05-x.mp4' }),
  ]
  const published: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/content', () => HttpResponse.json(posts)),
    http.get('*/api/platform/content/instagram', () => HttpResponse.json({ enabled: true } satisfies Schemas['InstagramTokensState'])),
    http.post('*/api/platform/content/:id/publish', ({ params }) => {
      published.push(String(params.id))
      posts = posts.map((p) => (p.id === 7 ? { ...p, instagramPublishing: true } : p))
      return HttpResponse.json(posts[0]!, { status: 202 })
    }),
  )
  const user = await openTab()
  const card = await screen.findByRole('article', { name: 'Что думает стоматолог' })
  expect(card).toHaveTextContent('Рилс')
  expect(card).toHaveTextContent('· 19:30')
  const player = within(card).getByLabelText('Рилс: Что думает стоматолог')
  expect(player.tagName).toBe('VIDEO')
  expect(player).toHaveAttribute('src', `/web/materials/reel/${video}?exp=1&sig=a`)
  expect(player).toHaveAttribute('poster', '/web/materials/reel/02-chto-dumaet-stomatolog/cover.png?exp=1&sig=b')
  expect(player).toHaveAttribute('preload', 'none')
  // «Скачать видео» — та же ссылка с download=true, файл под своим именем
  const save = within(card).getByRole('link', { name: 'Скачать рилс: Что думает стоматолог' })
  expect(save).toHaveAttribute('href', `${window.location.origin}/web/materials/reel/${video}?exp=1&sig=a&download=true`)
  expect(save).toHaveAttribute('download', '02-chto-dumaet-stomatolog.mp4')
  // Файла нет на сервере — понятная подсказка, публиковать нечего
  const lost = screen.getByRole('article', { name: 'Пропал' })
  expect(lost).toHaveTextContent('Видео рилса нет на сервере (05-x/05-x.mp4)')

  await user.click(within(card).getByRole('button', { name: 'Опубликовать в Instagram' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('Опубликовать рилс «Что думает стоматолог» в Instagram?')
  expect(dialog).toHaveTextContent('итог придёт в Telegram')
  await user.click(within(dialog).getByRole('button', { name: 'Опубликовать' }))
  expect(await within(card).findByText('Публикуется в Instagram')).toBeInTheDocument()
  expect(within(card).queryByRole('button', { name: 'Опубликовать в Instagram' })).not.toBeInTheDocument()
  expect(published).toEqual(['7'])
})

test('«Добавить рилсы в план»: после подтверждения — запрос и итог; повтор — «все уже в плане»', async () => {
  let calls = 0
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/content', () => HttpResponse.json([])),
    http.post('*/api/platform/content/reels', () => {
      calls++
      return HttpResponse.json((calls === 1
        ? { added: 6, already: 0, missing: [], from: today, time: '19:30:00' }
        : { added: 0, already: 6, missing: [], time: '19:30:00' }) satisfies Schemas['ContentPostsReelsAdded'])
    }),
  )
  const user = await openTab()
  const button = await screen.findByRole('button', { name: 'Добавить рилсы в план (6 шт., по одному в день)' })
  await user.click(button)
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('по одному в день в 19:30')
  await user.click(within(dialog).getByRole('button', { name: 'Отмена' }))
  expect(calls).toBe(0)

  await user.click(button)
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Добавить' }))
  expect(await screen.findByText(/^Рилсы добавлены: 6, по одному в день с .+ в 19:30$/)).toBeInTheDocument()

  await user.click(button)
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Добавить' }))
  expect(await screen.findByText('Новых рилсов нет — все уже в плане')).toBeInTheDocument()
  expect(calls).toBe(2)
})

test('изменить рилс: время и подпись уходят на сервер, видео не меняется', async () => {
  let sent: Schemas['ContentPostsDraft'] | null = null
  const reel = post(7, { kind: 'REELS', title: 'Миф или правда', caption: 'Старая', publishTime: '19:30:00', video: '04-m/04-m.mp4' })
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/content', () => HttpResponse.json([reel])),
    http.put('*/api/platform/content/:id', async ({ request }) => {
      sent = (await request.json()) as Schemas['ContentPostsDraft']
      return HttpResponse.json(reel)
    }),
  )
  const user = await openTab()
  const card = await screen.findByRole('article', { name: 'Миф или правда' })
  await user.click(within(card).getByRole('button', { name: 'Изменить' }))
  const form = screen.getByRole('form', { name: 'Изменить пост' })
  const time = within(form).getByLabelText(/Время публикации/)
  expect(time).toHaveValue('19:30')
  expect(form).toHaveTextContent('Видео рилса: 04-m/04-m.mp4')
  await user.clear(time)
  await user.type(time, '18:15')
  const caption = within(form).getByRole('textbox', { name: /Текст поста/ })
  await user.clear(caption)
  await user.type(caption, 'Новая подпись')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  await vi.waitFor(() => expect(sent).not.toBeNull())
  expect(sent).toMatchObject({ date: today, kind: 'REELS', title: 'Миф или правда', caption: 'Новая подпись', time: '18:15' })
})
