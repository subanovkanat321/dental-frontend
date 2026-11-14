import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, findSub, querySub } from '../test/fixtures'
import { server } from '../test/server'
import { todayIn } from '../lib/time'
// Настоящий готовый план из сборки (public/content/plan.json) — формат должен совпадать с контрактом импорта
import realPlan from '../../public/content/plan.json?raw'
import { choose } from '../test/select'
import { waitForSlow } from '../test/wait'

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
  id, publishOn: today, kind: 'CAROUSEL', title: `Пост ${id}`, caption: '', images: [], note: '', status: 'PLANNED', instagramPublishing: false, story: false, storyPublishing: false, ...extra,
}) satisfies Schemas['ContentPostsPost']

/** Второстепенное действие поста — из «⋯» карточки. */
async function pick(user: ReturnType<typeof userEvent.setup>, card: HTMLElement, name: string) {
  await user.click(within(card).getByRole('button', { name: /^Ещё: / }))
  await user.click(within(card).getByRole('menuitem', { name }))
}

/** Залитые кнопки карточки (главное действие) — одна или ни одной. */
function mainActions(card: HTMLElement): string[] {
  return [...card.querySelectorAll('.content-actions .btn.primary')].map((b) => b.textContent ?? '')
}

async function openTab() {
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Контент'))
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

  // По умолчанию — только ждущие публикации: опубликованный рилс виден в «Все»
  expect(screen.queryByRole('article', { name: 'Один день клиники' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /^Все/ }))
  const reels = await screen.findByRole('article', { name: 'Один день клиники' })
  expect(reels).toHaveTextContent('Что снять: Ресепшен и кресло')
  expect(reels).toHaveTextContent('Опубликован')
  expect(within(reels).queryByRole('button', { name: 'Опубликовал' })).not.toBeInTheDocument()

  // Без Instagram главное — отметить руками «Опубликовал»; остальное — в «⋯»
  expect(mainActions(card)).toEqual(['Опубликовал'])
  expect(within(card).queryByRole('button', { name: 'На завтра' })).not.toBeInTheDocument()
  await pick(user, card, 'На завтра')
  await waitForSlow(() => expect(calls).toHaveLength(1))
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
  await user.click(screen.getByRole('button', { name: 'Загрузить план' }))
  expect(await screen.findByText(`План загружен: добавлено ${plan.length}, обновлено 0, без изменений 0, убрано из старого плана 3`)).toBeInTheDocument()
  expect(imported).toEqual(plan)

  file = null
  imported = null
  await user.click(screen.getByRole('button', { name: 'Загрузить план' }))
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
  expect(sent).toEqual({ date: today, kind: 'REELS', title: 'Утро в клинике', caption: '', note: 'Кофе и улыбки', images: ['/content/a.png', '/content/b.png'], story: false })
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
      return HttpResponse.json(posts[0])
    }),
  )
  const user = await openTab()
  expect(await screen.findByText(/Instagram подключён · токен до 4 янв 2027/)).toBeInTheDocument()
  // «Все»: опубликованный пост остаётся в списке с бейджем
  await user.click(await screen.findByRole('button', { name: /^Все/ }))
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
  // Выложен — главное теперь «В сторис», ссылка на пост — в «⋯»
  expect(await within(card).findByRole('button', { name: 'В сторис' })).toBeInTheDocument()
  expect(mainActions(card)).toEqual(['В сторис'])
  expect(within(card).getByText('В Instagram')).toBeInTheDocument()
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
  expect(await findSub('Клиники')).toBeInTheDocument()
  expect(querySub('Контент')).not.toBeInTheDocument()
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
      return HttpResponse.json(posts[0], { status: 202 })
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
        ? { added: 2, already: 6, moved: 4, missing: ['10', '11'], from: today, time: '19:30:00', reels: [] }
        : { added: 0, already: 8, moved: 0, missing: [], time: '19:30:00', reels: [] }) satisfies Schemas['ContentPostsReelsAdded'])
    }),
  )
  const user = await openTab()
  const button = await screen.findByRole('button', { name: '＋ Рилсы в план' })
  await user.click(button)
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('по одному в день в 19:30')
  expect(dialog).toHaveTextContent('переставятся, чтобы шли вперемешку')
  await user.click(within(dialog).getByRole('button', { name: 'Отмена' }))
  expect(calls).toBe(0)

  await user.click(button)
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Добавить' }))
  expect(await screen.findByText(/^Рилсы добавлены: 2, по одному в день с .+ в 19:30 · переставлено, чтобы шли вперемешку: 4 · уже были в плане: 6 · нет в каталоге на сервере: 10, 11$/)).toBeInTheDocument()

  await user.click(button)
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Добавить' }))
  expect(await screen.findByText('Новых рилсов нет — все уже в плане')).toBeInTheDocument()
  expect(calls).toBe(2)
})

test('«Рилсы — автоматически»: переключатель сохраняется сразу; без Instagram — предупреждение', async () => {
  const sent: boolean[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/content', () => HttpResponse.json([])),
    http.get('*/api/platform/content/instagram', () => HttpResponse.json({ enabled: false } satisfies Schemas['InstagramTokensState'])),
    http.put('*/api/platform/content/settings', async ({ request }) => {
      const body = await request.json() as Schemas['ContentSettingsSettings']
      sent.push(Boolean(body.reelsAuto))
      return HttpResponse.json(body satisfies Schemas['ContentSettingsSettings'])
    }),
  )
  const user = await openTab()
  const toggle = await screen.findByRole('checkbox', { name: 'Рилсы — автоматически' })
  expect(toggle).not.toBeChecked()
  // Одна строка у галочки, подробности — в «?»
  expect(screen.getByText('новые — в план, в 19:30 сами в Instagram')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Подсказка: Рилсы и сторис автоматически' })).toBeInTheDocument()
  expect(screen.queryByText(/Instagram не подключён — рилсы будут вставать в план/)).not.toBeInTheDocument()

  await user.click(toggle)
  expect(await screen.findByRole('checkbox', { name: 'Рилсы — автоматически' })).toBeChecked()
  expect(sent).toEqual([true])
  expect(screen.getByRole('alert')).toHaveTextContent('Instagram не подключён — рилсы будут вставать в план, но публиковать их придётся вручную')

  await user.click(screen.getByRole('checkbox', { name: 'Рилсы — автоматически' }))
  await waitForSlow(() => expect(sent).toEqual([true, false]))
  expect(screen.queryByText(/Instagram не подключён — рилсы будут вставать в план/)).not.toBeInTheDocument()
})

test('«Рилсы — автоматически» с подключённым Instagram — без предупреждения', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/content', () => HttpResponse.json([])),
    http.get('*/api/platform/content/instagram', () => HttpResponse.json({ enabled: true } satisfies Schemas['InstagramTokensState'])),
    http.get('*/api/platform/content/settings', () => HttpResponse.json({ reelsAuto: true, storiesAuto: false } satisfies Schemas['ContentSettingsSettings'])),
  )
  await openTab()
  expect(await screen.findByRole('checkbox', { name: 'Рилсы — автоматически' })).toBeChecked()
  expect(await screen.findByText(/Instagram подключён/)).toBeInTheDocument()
  expect(screen.queryByText(/Instagram не подключён — рилсы будут вставать в план/)).not.toBeInTheDocument()
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
  await pick(user, card, 'Изменить')
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
  await waitForSlow(() => expect(sent).not.toBeNull())
  expect(sent).toMatchObject({ date: today, kind: 'REELS', title: 'Миф или правда', caption: 'Новая подпись', time: '18:15' })
})

test('«⋯ → Прислать в бот»: пост уходит владельцу в Telegram, видно подтверждение', async () => {
  const sent: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/content', () => HttpResponse.json([post(7, { kind: 'REELS', title: 'Что думает стоматолог' })])),
    http.get('*/api/platform/content/instagram', () => HttpResponse.json({ enabled: false } satisfies Schemas['InstagramTokensState'])),
    http.post('*/api/platform/content/:id/to-telegram', ({ params }) => {
      sent.push(String(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const user = await openTab()
  const card = await screen.findByRole('article', { name: 'Что думает стоматолог' })
  await pick(user, card, 'Прислать в бот')
  expect(await within(card).findByRole('status')).toHaveTextContent('Отправили в Telegram')
  expect(sent).toEqual(['7'])
})

test('Instagram отказал — причина видна под постом, пост в плане', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/content', () => HttpResponse.json([post(7, { kind: 'REELS', title: 'Что думает стоматолог',
      instagramError: 'У токена нет права публиковать', instagramErrorAt: '2026-11-08T13:31:00Z' })])),
    http.get('*/api/platform/content/instagram', () => HttpResponse.json({ enabled: true } satisfies Schemas['InstagramTokensState'])),
  )
  await openTab()
  const card = await screen.findByRole('article', { name: 'Что думает стоматолог' })
  expect(within(card).getByRole('alert')).toHaveTextContent('⚠️ Не опубликовано в Instagram (8 нояб, 19:31): У токена нет права публиковать')
})

test('план — с сегодняшнего дня и на 2 месяца вперёд; прошедшие дни месяца — внизу, свёрнуты', async () => {
  const shift = (days: number) => {
    const d = new Date(`${today}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
  }
  const asked: (string | null)[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/content/instagram', () => HttpResponse.json({ enabled: false } satisfies Schemas['InstagramTokensState'])),
    http.get('*/api/platform/content', ({ request }) => {
      asked.push(new URL(request.url).searchParams.get('to'))
      const all = [post(1, { title: 'Сегодня', publishOn: today }), post(2, { title: 'Через 40 дней', publishOn: shift(40) })]
      // «Вчера» — только если вчера в этом же месяце
      if (shift(-1).slice(0, 7) === today.slice(0, 7)) all.unshift(post(3, { title: 'Вчера', publishOn: shift(-1), status: 'DONE' }))
      return HttpResponse.json(all)
    }),
  )
  const user = await openTab()
  const plan = await screen.findByRole('region', { name: 'Контент-план' })
  await within(plan).findByRole('article', { name: 'Сегодня' })
  await user.click(within(plan).getByRole('button', { name: /^Все/ }))
  expect(asked[0]).toBe(shift(60))
  // Сначала сегодня и дальше (в том числе следующий месяц), прошедшее — в свёрнутом блоке внизу
  const titles = within(plan).getAllByRole('article').map((a) => a.getAttribute('aria-label'))
  expect(titles.slice(0, 2)).toEqual(['Сегодня', 'Через 40 дней'])
  if (shift(-1).slice(0, 7) === today.slice(0, 7)) {
    const pastBlock = within(plan).getByText(/Прошедшие дни этого месяца: 1/).closest('details')!
    expect(pastBlock).not.toHaveAttribute('open')
    expect(within(pastBlock).getByRole('article', { name: 'Вчера' })).toBeInTheDocument()
  }
})

test('фильтр: по умолчанию только ждущие; в «Все» опубликованный вручную — без кнопки публикации', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/content/instagram', () => HttpResponse.json({ enabled: true } satisfies Schemas['InstagramTokensState'])),
    http.get('*/api/platform/content', () => HttpResponse.json([
      post(1, { title: 'Ждёт', images: ['/content/a.png'] }),
      post(2, { title: 'Выложил сам', images: ['/content/b.png'], status: 'DONE' }),
    ])),
  )
  const user = await openTab()
  const plan = await screen.findByRole('region', { name: 'Контент-план' })
  await within(plan).findByRole('article', { name: 'Ждёт' })
  expect(within(plan).getByRole('button', { name: 'Ждут · 1' })).toHaveAttribute('aria-pressed', 'true')
  expect(within(plan).queryByRole('article', { name: 'Выложил сам' })).not.toBeInTheDocument()
  await user.click(within(plan).getByRole('button', { name: 'Все · 2' }))
  const done = within(plan).getByRole('article', { name: 'Выложил сам' })
  expect(within(done).queryByRole('button', { name: 'Опубликовать в Instagram' })).not.toBeInTheDocument()
  expect(within(within(plan).getByRole('article', { name: 'Ждёт' })).getByRole('button', { name: 'Опубликовать в Instagram' })).toBeInTheDocument()
})

test('сторис после поста: «✓ в сторис», ошибка с «Повторить сторис», «В сторис» у поста без сторис', async () => {
  const published = { status: 'DONE', instagramMediaId: 'm1' } as const
  let posts = [
    post(1, { ...published, kind: 'POST', title: 'Со сторис', images: ['/content/a.png'], storyMediaId: 's1', storyAt: '2099-06-01T10:00:00Z' }),
    post(2, { ...published, kind: 'POST', title: 'Сторис не вышла', images: ['/content/b.png'],
      storyError: 'Лимит Instagram — слишком много запросов или публикаций за сутки, попробуйте позже', storyErrorAt: '2099-06-01T10:00:00Z' }),
    post(3, { ...published, kind: 'CAROUSEL', title: 'Без сторис', images: ['/content/c-1.png', '/content/c-2.png'], story: false }),
    post(4, { ...published, kind: 'STORIES', title: 'Сама сторис', images: ['/content/s.png'] }),
    post(5, { kind: 'POST', title: 'Ещё в плане', images: ['/content/d.png'] }),
  ]
  const calls: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/content', () => HttpResponse.json(posts)),
    http.get('*/api/platform/content/instagram', () => HttpResponse.json({ enabled: true } satisfies Schemas['InstagramTokensState'])),
    http.post('*/api/platform/content/:id/story', ({ params }) => {
      const id = Number(params.id)
      calls.push(String(id))
      posts = posts.map((p) => (p.id === id ? { ...p, storyMediaId: `s${id}`, storyError: undefined, storyErrorAt: undefined } : p))
      return HttpResponse.json(posts.find((p) => p.id === id))
    }),
  )
  const user = await openTab()
  await user.click(await screen.findByRole('button', { name: /^Все/ }))

  const done = await screen.findByRole('article', { name: 'Со сторис' })
  expect(done).toHaveTextContent('✓ в сторис')
  expect(within(done).queryByRole('button', { name: /в сторис|повторить сторис/i })).not.toBeInTheDocument()

  const failed = screen.getByRole('article', { name: 'Сторис не вышла' })
  expect(within(failed).getByRole('alert')).toHaveTextContent('Сторис: ошибка')
  expect(within(failed).getByRole('alert')).toHaveTextContent('Лимит Instagram')
  // Сама сторис и пост, ещё не опубликованный в Instagram, — без кнопок сторис
  expect(within(screen.getByRole('article', { name: 'Сама сторис' })).queryByRole('button', { name: /в сторис|повторить сторис/i })).not.toBeInTheDocument()
  expect(within(screen.getByRole('article', { name: 'Ещё в плане' })).queryByRole('button', { name: /в сторис|повторить сторис/i })).not.toBeInTheDocument()

  await user.click(within(failed).getByRole('button', { name: 'Повторить сторис' }))
  expect(await within(failed).findByText('✓ в сторис')).toBeInTheDocument()
  expect(within(failed).queryByRole('alert')).not.toBeInTheDocument()

  // Галочку сняли — сторис не было: выложить вручную
  const none = screen.getByRole('article', { name: 'Без сторис' })
  await user.click(within(none).getByRole('button', { name: 'В сторис' }))
  expect(await within(none).findByText('✓ в сторис')).toBeInTheDocument()
  expect(calls).toEqual(['2', '3'])
})

test('«Повторить сторис» снова не вышла — причина под постом, кнопка остаётся', async () => {
  let posts = [post(1, { status: 'DONE', instagramMediaId: 'm1', kind: 'POST', title: 'Пост', images: ['/content/a.png'], storyError: 'старая' })]
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/content', () => HttpResponse.json(posts)),
    http.get('*/api/platform/content/instagram', () => HttpResponse.json({ enabled: true } satisfies Schemas['InstagramTokensState'])),
    http.post('*/api/platform/content/:id/story', () => {
      posts = posts.map((p) => ({ ...p, storyError: 'Токен Instagram истёк или отозван' }))
      return HttpResponse.json({ status: 409, title: 'Conflict', code: 'instagram-story-failed', detail: 'Токен Instagram истёк или отозван' }, { status: 409 })
    }),
  )
  const user = await openTab()
  await user.click(await screen.findByRole('button', { name: /^Все/ }))
  const card = await screen.findByRole('article', { name: 'Пост' })
  await user.click(within(card).getByRole('button', { name: 'Повторить сторис' }))
  expect(await within(card).findByText(/Сторис: ошибка: Токен Instagram истёк/)).toBeInTheDocument()
  // Одна причина — из поста, без повтора текстом ответа
  expect(within(card).getAllByRole('alert')).toHaveLength(1)
  expect(within(card).getByRole('button', { name: 'Повторить сторис' })).toBeEnabled()
})

test('«Также в сторис» в форме — по умолчанию выключена, поставленная уходит на сервер; у сторис галочки нет', async () => {
  let sent: Schemas['ContentPostsDraft'] | null = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/content', () => HttpResponse.json([])),
    http.post('*/api/platform/content', async ({ request }) => {
      sent = (await request.json()) as Schemas['ContentPostsDraft']
      return HttpResponse.json(post(5, { title: sent.title }), { status: 201 })
    }),
  )
  const user = await openTab()
  await user.click(await screen.findByRole('button', { name: '＋ Добавить пост' }))
  const form = screen.getByRole('form', { name: 'Новый пост' })
  const story = within(form).getByRole('checkbox', { name: /Также в сторис \(без ссылки на пост\)/ })
  expect(story).not.toBeChecked()
  await choose(within(form).getByRole('combobox', { name: 'Тип' }), 'Сторис')
  expect(within(form).queryByRole('checkbox', { name: /Также в сторис/ })).not.toBeInTheDocument()
  await choose(within(form).getByRole('combobox', { name: 'Тип' }), 'Пост')
  await user.click(within(form).getByRole('checkbox', { name: /Также в сторис/ }))
  await user.type(within(form).getByRole('textbox', { name: 'Название' }), 'Со сторис')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  await waitForSlow(() => expect(sent).not.toBeNull())
  expect(sent).toMatchObject({ kind: 'POST', title: 'Со сторис', story: true })
})

test('«Сторис — автоматически»: выключена по умолчанию, включение — только своим полем', async () => {
  const sent: Schemas['ContentSettingsUpdate'][] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/content', () => HttpResponse.json([])),
    http.put('*/api/platform/content/settings', async ({ request }) => {
      const body = await request.json() as Schemas['ContentSettingsUpdate']
      sent.push(body)
      return HttpResponse.json({ reelsAuto: false, storiesAuto: body.storiesAuto ?? false } satisfies Schemas['ContentSettingsSettings'])
    }),
  )
  const user = await openTab()
  const toggle = await screen.findByRole('checkbox', { name: 'Сторис — автоматически' })
  expect(toggle).not.toBeChecked()
  expect(screen.getByText('опубликованное — и в сторис')).toBeInTheDocument()
  await user.click(toggle)
  expect(await screen.findByRole('checkbox', { name: 'Сторис — автоматически' })).toBeChecked()
  expect(sent).toEqual([{ storiesAuto: true }])
  expect(screen.getByRole('checkbox', { name: 'Рилсы — автоматически' })).not.toBeChecked()
})

test('опубликованный пост со ссылкой — «⋯ → В сторис со ссылкой на пост» открывает пост через openLink, с подсказкой', async () => {
  const link = 'https://www.instagram.com/p/T1/'
  const posts = [
    post(1, { status: 'DONE', instagramMediaId: 'm1', instagramUrl: link, kind: 'POST', title: 'Со ссылкой', images: ['/content/a.png'] }),
    post(2, { status: 'DONE', instagramMediaId: 'm2', kind: 'POST', title: 'Без ссылки', images: ['/content/b.png'] }),
    post(3, { status: 'DONE', instagramMediaId: 'm3', instagramUrl: 'https://www.instagram.com/stories/x/', kind: 'STORIES', title: 'Сама сторис', images: ['/content/s.png'] }),
  ]
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/content', () => HttpResponse.json(posts)),
    http.get('*/api/platform/content/instagram', () => HttpResponse.json({ enabled: true } satisfies Schemas['InstagramTokensState'])),
  )
  const opened = vi.spyOn(window, 'open').mockReturnValue(null)
  const user = await openTab()
  await user.click(await screen.findByRole('button', { name: /^Все/ }))

  const card = await screen.findByRole('article', { name: 'Со ссылкой' })
  expect(card).toHaveTextContent('Чтобы сторис вела в пост: откройте пост, нажмите ➤ под ним → «Добавить в историю»')
  await pick(user, card, 'В сторис со ссылкой на пост ↗')
  // Вне Telegram openLink — новое окно; в Telegram — Telegram.WebApp.openLink (браузер или приложение Instagram)
  expect(opened).toHaveBeenCalledWith(link, '_blank', 'noopener')

  // Нет ссылки от Instagram или пост сам сторис — пункта и подсказки нет
  for (const name of ['Без ссылки', 'Сама сторис']) {
    const other = screen.getByRole('article', { name })
    await user.click(within(other).getByRole('button', { name: /^Ещё: / }))
    expect(within(other).queryByRole('menuitem', { name: /В сторис со ссылкой/ })).not.toBeInTheDocument()
    expect(other).not.toHaveTextContent('Добавить в историю')
  }
  // Сторис-пост со ссылкой — главное «Открыть в Instagram ↗»
  expect(within(screen.getByRole('article', { name: 'Сама сторис' })).getByRole('link', { name: 'Открыть в Instagram ↗' }))
    .toHaveAttribute('href', 'https://www.instagram.com/stories/x/')
  opened.mockRestore()
})

test('медиа удалено после публикации: вместо картинок и видео — главная — «Открыть в Instagram ↗», без публикации и сторис', async () => {
  const link = 'https://www.instagram.com/p/T9/'
  const removedAt = '2026-11-10T00:00:00Z'
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/content/instagram', () => HttpResponse.json({ enabled: true } satisfies Schemas['InstagramTokensState'])),
    http.get('*/api/platform/content', () => HttpResponse.json([
      post(1, { status: 'DONE', instagramMediaId: 'm1', instagramUrl: link, kind: 'CAROUSEL', title: 'Старая карусель', caption: 'Текст поста', images: ['/content/a.png'], mediaRemovedAt: removedAt }),
      post(2, { status: 'DONE', instagramMediaId: 'm2', instagramUrl: link + 'r', kind: 'REELS', title: 'Старый рилс', video: 'r/r.mp4', mediaRemovedAt: removedAt }),
      post(3, { status: 'DONE', kind: 'POST', title: 'Выложил руками', images: ['/content/b.png'], mediaRemovedAt: removedAt }),
      post(4, { status: 'DONE', instagramMediaId: 'm4', instagramUrl: link + 'n', kind: 'POST', title: 'Свежий', images: ['/content/c.png'] }),
    ])),
  )
  const user = await openTab()
  await user.click(await screen.findByRole('button', { name: /^Все/ }))

  const carousel = await screen.findByRole('article', { name: 'Старая карусель' })
  expect(carousel).toHaveTextContent('Медиа удалено с сервера после публикации')
  expect(within(carousel).getByRole('link', { name: 'Открыть в Instagram ↗' })).toHaveAttribute('href', link)
  expect(within(carousel).queryByRole('img')).not.toBeInTheDocument()
  expect(carousel).toHaveTextContent('Текст поста')
  expect(within(carousel).queryByRole('button', { name: /В сторис/ })).not.toBeInTheDocument()

  const reel = screen.getByRole('article', { name: 'Старый рилс' })
  expect(within(reel).getByRole('link', { name: 'Открыть в Instagram ↗' })).toHaveAttribute('href', link + 'r')
  expect(reel).not.toHaveTextContent('Видео рилса нет на сервере')
  expect(reel.querySelector('video')).toBeNull()

  // Выложено руками, ссылки от Instagram нет — просто «оно в Instagram»
  const byHand = screen.getByRole('article', { name: 'Выложил руками' })
  expect(byHand).toHaveTextContent('Медиа удалено с сервера после публикации — оно в Instagram')
  expect(within(byHand).queryByRole('img')).not.toBeInTheDocument()

  // Свежий опубликованный — с картинкой, как раньше
  const fresh = screen.getByRole('article', { name: 'Свежий' })
  expect(within(fresh).getByRole('img')).toHaveAttribute('src', '/content/c.png')
  expect(fresh).not.toHaveTextContent('Медиа удалено')
})

test('карточка поста — одна главная кнопка по состоянию, остальное — в «⋯»', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/content/instagram', () => HttpResponse.json({ enabled: true } satisfies Schemas['InstagramTokensState'])),
    http.get('*/api/platform/content', () => HttpResponse.json([
      post(1, { kind: 'POST', title: 'Готов к публикации', images: ['/content/a.png'] }),
      post(2, { status: 'DONE', instagramMediaId: 'm2', instagramUrl: 'https://www.instagram.com/p/A2/', kind: 'POST', title: 'Выложен', images: ['/content/b.png'] }),
      post(3, { status: 'DONE', instagramMediaId: 'm3', instagramUrl: 'https://www.instagram.com/p/A3/', kind: 'POST', title: 'И в сторис', images: ['/content/c.png'], storyMediaId: 's3' }),
      post(4, { kind: 'REELS', title: 'Рилс без видео' }),
      post(5, { status: 'SKIPPED', kind: 'POST', title: 'Пропущенный' }),
    ])),
  )
  const user = await openTab()
  await user.click(await screen.findByRole('button', { name: /^Все/ }))
  const main = (name: string) => mainActions(screen.getByRole('article', { name }))
  await screen.findByRole('article', { name: 'Готов к публикации' })
  expect(main('Готов к публикации')).toEqual(['Опубликовать в Instagram'])
  expect(main('Выложен')).toEqual(['В сторис'])
  expect(main('И в сторис')).toEqual(['Открыть в Instagram ↗'])
  // Instagram подключён, но публиковать нечего — отметить руками
  expect(main('Рилс без видео')).toEqual(['Опубликовал'])
  // Пропущенный — тихая «Вернуть в план», без залитой
  expect(main('Пропущенный')).toEqual([])
  expect(within(screen.getByRole('article', { name: 'Пропущенный' })).getByRole('button', { name: 'Вернуть в план' })).toBeInTheDocument()

  // Семи кнопок больше нет: у поста в плане — одна кнопка и «⋯»
  const card = screen.getByRole('article', { name: 'Готов к публикации' })
  expect(within(card.querySelector('.content-actions') as HTMLElement).getAllByRole('button').map((b) => b.textContent))
    .toEqual(['Опубликовать в Instagram', '⋯'])
  await user.click(within(card).getByRole('button', { name: 'Ещё: Готов к публикации' }))
  expect(within(card).getAllByRole('menuitem').map((i) => i.textContent))
    .toEqual(['Опубликовал', 'На завтра', 'Пропустить', 'Прислать в бот', 'Изменить', 'Удалить'])
})
