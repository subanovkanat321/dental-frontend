import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, findSub, querySub } from '../test/fixtures'
import { server } from '../test/server'
import { durationText, groupMaterials, materialTitle, posterOf, sizeText } from './materials'

beforeEach(() => {
  window.location.hash = '/platform'
  server.use(
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })),
    http.get('*/api/platform/clinics', () => HttpResponse.json([])),
    http.get('*/api/platform/applications', () => HttpResponse.json([])),
    http.get('*/api/platform/agreements/statuses', () => HttpResponse.json({})),
    http.get('*/api/platform/pay-requests', () => HttpResponse.json([])),
    http.get('*/web/materials/howto', () => HttpResponse.json([{ id: 'zapis', title: 'Записать пациента', video: '/web/materials/howto/zapis.mp4', section: 'Расписание', lead: '«＋ Новая запись»' }] satisfies Schemas['MaterialsHowToVideo'][])),
  )
})
afterEach(() => {
  window.location.hash = ''
})

const owner = { ...me, owner: true, platform: true }
const STALE = 'Кадры кассы, персонала и графика — до 13 ноября.'

function file(path: string, kind: string, extra: Partial<Schemas['MaterialsMaterial']> = {}): Schemas['MaterialsMaterial'] {
  const parts = path.split('/')
  const link = `/web/materials/file?path=${encodeURIComponent(path)}&exp=1&sig=x`
  return {
    path, name: parts.at(-1)!, section: parts[0]!, folder: parts.slice(1, -1).join('/'), kind, size: 17_350_336,
    modified: '2026-11-05T06:00:00Z', url: link, downloadUrl: `${link}&download=true`, ...extra,
  }
}

const listing = {
  configured: true,
  files: [
    file('guide/Tish-instrukciya.pdf', 'pdf'),
    file('howto/zapis.mp4', 'video', { seconds: 22, shareUrl: '/web/materials/howto/zapis.mp4', groupUrl: 'https://t.me/c/123/42' }),
    file('howto/zapis.webp', 'image'),
    file('instagram/01-privet.png', 'image', { size: 435_236 }),
    file('presentation/Tish-dlya-klinik.pdf', 'pdf', { stale: 'Снимки кассы — до 13 ноября.' }),
    file('presentation/Tish-dlya-klinik.pptx', 'pptx', { stale: 'Снимки кассы — до 13 ноября.' }),
    // Рилс опубликован, файл с сервера уже удалён — только ссылка на пост
    { ...file('reels/01-chistish-nepravilno/01-chistish-nepravilno.mp4', 'video', { postUrl: 'https://www.instagram.com/reel/abc/' }), size: 0, url: undefined, downloadUrl: undefined, modified: undefined },
    file('reels/02-chto-dumaet-stomatolog/02-chto-dumaet-stomatolog.mp4', 'video', { seconds: 18 }),
    file('reels/02-chto-dumaet-stomatolog/02-chto-dumaet-stomatolog-bez-muzyki.mp4', 'video', { seconds: 18 }),
    file('video/kak-zapisatsya.mp4', 'video', { seconds: 44, stale: 'Снят 2–3 ноября.' }),
    file('video/kak-zapisatsya-cover.png', 'image'),
    file('video/promo-v5/tish-promo-v5-4x5.mp4', 'video'),
    file('video/promo-v6/cover-4x5.png', 'image'),
    file('video/promo-v6/tish-promo-v6-4x5.mp4', 'video', { seconds: 64, stale: STALE, shareUrl: '/web/materials/public/promo.mp4' }),
  ],
} satisfies Schemas['MaterialsListing']

test('группы по назначению, названия, обложки и длительность', () => {
  const groups = groupMaterials(listing.files)
  expect(groups.map((g) => g.group.title)).toEqual(['Рекламный ролик', 'Презентация', 'Инструкция для клиник', 'Ролики «Как сделать»',
    'Рилсы про зубы', 'Картинки для Instagram', 'Старые ролики для Instagram', 'Прежние версии рекламного ролика'])
  // Обложки — превью роликов, отдельной строкой не идут
  expect(groups.find((g) => g.group.id === 'promo')!.files.map((f) => f.name)).toEqual(['tish-promo-v6-4x5.mp4'])
  expect(groups.find((g) => g.group.id === 'howto')!.files.map((f) => f.name)).toEqual(['zapis.mp4'])
  expect(posterOf(listing.files[13]!, listing.files)?.name).toBe('cover-4x5.png')
  expect(posterOf(listing.files[9]!, listing.files)?.name).toBe('kak-zapisatsya-cover.png')
  // Рилс «без музыки» — внутри карточки основного
  expect(groups.find((g) => g.group.id === 'reels')!.files.map((f) => f.name)).toEqual(['01-chistish-nepravilno.mp4', '02-chto-dumaet-stomatolog.mp4'])
  expect(materialTitle(listing.files[1]!, { zapis: 'Записать пациента' })).toBe('Записать пациента')
  expect(materialTitle(listing.files[6]!)).toBe('Ты чистишь зубы неправильно')
  expect(materialTitle(file('reels/02-chto-dumaet-stomatolog/02-chto-dumaet-stomatolog-bez-muzyki.mp4', 'video'))).toBe('Что думает стоматолог — без музыки')
  expect(materialTitle(listing.files[13]!)).toBe('Ролик для ленты (4:5)')
  expect(durationText(64)).toBe('1:04')
  expect(durationText(null)).toBeNull()
  expect(sizeText(17_350_336)).toBe('16,5 МБ')
  expect(sizeText(3000)).toBe('3 КБ')
})

test('владелец: группы с подписью «для чего», «устарел», опубликованное — ссылкой на пост', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/materials', () => HttpResponse.json(listing)),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Материалы'))

  const promo = await screen.findByRole('region', { name: 'Рекламный ролик' })
  expect(within(promo).getByText(/Клиникам при продаже/)).toBeInTheDocument()
  expect(within(promo).getByText('устарел')).toBeInTheDocument()
  expect(within(promo).getByText(STALE)).toBeInTheDocument()
  expect(within(promo).getByText(/1:04 · 16,5 МБ/)).toBeInTheDocument()
  // Превью — обложка; плеер — по нажатию
  expect(within(promo).queryByLabelText('Ролик для ленты (4:5)')).not.toBeInTheDocument()
  await user.click(within(promo).getByRole('button', { name: 'Смотреть: Ролик для ленты (4:5)' }))
  const player = within(promo).getByLabelText('Ролик для ленты (4:5)')
  expect(player.tagName).toBe('VIDEO')
  expect(player).toHaveAttribute('src', expect.stringContaining('promo-v6%2Ftish-promo-v6-4x5.mp4'))
  expect(within(promo).getByRole('link', { name: 'Скачать: Ролик для ленты (4:5)' })).toHaveAttribute('href', expect.stringMatching(/&download=true$/))

  // Сводка «устарели» вверху
  const note = screen.getByRole('note', { name: 'Устарели' })
  expect(note).toHaveTextContent('Рекламный ролик')
  expect(note).toHaveTextContent('Презентация')
  expect(note).toHaveTextContent('Старые ролики для Instagram')

  // «Как сделать»: название с сервера, ссылка на сообщение в группе, «Поделиться» — постоянной ссылкой
  const howto = screen.getByRole('region', { name: 'Ролики «Как сделать»' })
  expect(within(howto).getByText(/Врачам и сотрудникам/)).toBeInTheDocument()
  expect(await within(howto).findByText('Записать пациента')).toBeInTheDocument()
  expect(within(howto).getByRole('link', { name: 'В группе Tish: Записать пациента' })).toHaveAttribute('href', 'https://t.me/c/123/42')
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  await user.click(within(howto).getByRole('button', { name: 'Поделиться: Записать пациента' }))
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/web/materials/howto/zapis.mp4`)
  expect(await within(howto).findByText('Ссылка скопирована')).toBeInTheDocument()

  // Опубликованный рилс без файла: «Открыть в Instagram ↗» вместо «Открыть / Скачать»
  const reels = screen.getByRole('region', { name: 'Рилсы про зубы' })
  expect(within(reels).getByRole('link', { name: 'Открыть в Instagram: Ты чистишь зубы неправильно' })).toHaveAttribute('href', 'https://www.instagram.com/reel/abc/')
  expect(within(reels).queryByRole('link', { name: 'Скачать: Ты чистишь зубы неправильно' })).not.toBeInTheDocument()
  expect(within(reels).getByText(/файла на сервере нет/)).toBeInTheDocument()
  expect(within(reels).getByRole('link', { name: 'Скачать без музыки: Что думает стоматолог' })).toHaveAttribute('href', expect.stringContaining('bez-muzyki.mp4'))
  expect(within(reels).queryByText('Что думает стоматолог — без музыки')).not.toBeInTheDocument()

  const deck = screen.getByRole('region', { name: 'Презентация' })
  expect(within(deck).getByText(/Показать клинике на встрече/)).toBeInTheDocument()
  expect(within(deck).getByRole('link', { name: 'Открыть: Презентация · PDF' })).toHaveAttribute('href', expect.stringContaining('path=presentation%2FTish-dlya-klinik.pdf'))
  expect(within(deck).getByRole('link', { name: 'Скачать: Презентация · PowerPoint (править)' })).toHaveAttribute('download', 'Tish-dlya-klinik.pptx')

  const guide = screen.getByRole('region', { name: 'Инструкция для клиник' })
  expect(within(guide).getByRole('link', { name: 'tish.kg/guide?print=1' })).toHaveAttribute('href', '/guide?print=1')
  expect(within(guide).queryByText('устарел')).not.toBeInTheDocument()

  expect(screen.getByRole('region', { name: 'Прежние версии рекламного ролика' })).toHaveTextContent('не отправляйте клиникам')

  const links = screen.getByRole('region', { name: 'Ссылки' })
  expect(within(links).getByRole('link', { name: 'Открыть: Сайт-визитка для клиник' })).toHaveAttribute('href', 'https://tish.kg/about')
  expect(within(links).getByRole('link', { name: 'Открыть: Instagram @tish.app.kg' })).toHaveAttribute('href', 'https://www.instagram.com/tish.app.kg/')
})

test('сохранить ссылку на пост: после публикации карточка открывает Instagram', async () => {
  let sent: Schemas['MaterialsControllerLinkRequest'] | null = null
  const insta = file('instagram/01-privet.png', 'image')
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/materials', () => HttpResponse.json({ configured: true, files: [insta] })),
    http.put('*/api/platform/materials/link', async ({ request }) => {
      sent = await request.json() as Schemas['MaterialsControllerLinkRequest']
      return HttpResponse.json({ configured: true, files: [{ ...insta, postUrl: sent.url }] } satisfies Schemas['MaterialsListing'])
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Материалы'))
  const block = await screen.findByRole('region', { name: 'Картинки для Instagram' })
  await user.click(within(block).getByRole('button', { name: 'Ссылка на публикацию: 01-privet' }))
  await user.type(within(block).getByRole('textbox', { name: /Ссылка на пост/ }), 'https://www.instagram.com/p/AbC/')
  await user.click(within(block).getByRole('button', { name: 'Сохранить' }))
  expect(await within(block).findByRole('link', { name: 'Открыть в Instagram: 01-privet' })).toHaveAttribute('href', 'https://www.instagram.com/p/AbC/')
  expect(sent).toEqual({ path: 'instagram/01-privet.png', url: 'https://www.instagram.com/p/AbC/' })
})

test('каталог не подключён — понятная подсказка', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/materials', () => HttpResponse.json({ configured: false, files: [] } satisfies Schemas['MaterialsListing'])),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Материалы'))
  expect(await screen.findByText(/Каталог материалов не подключён/)).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Рекламный ролик' })).not.toBeInTheDocument()
  // Ссылки — и без каталога
  expect(screen.getByRole('region', { name: 'Ссылки' })).toBeInTheDocument()
})

test('ошибка сервера — текст ошибки', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/materials', () => HttpResponse.json({ status: 500, detail: 'Сбой' }, { status: 500 })),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Материалы'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить материалы')
})

test('менеджер платформы вкладку «Материалы» не видит', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, owner: false, platform: true })))
  renderApp()
  expect(await findSub('Клиники')).toBeInTheDocument()
  expect(querySub('Материалы')).not.toBeInTheDocument()
})
