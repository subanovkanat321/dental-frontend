import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { folderTitle, sizeText, videoLabel } from './materials'

beforeEach(() => {
  window.location.hash = '/platform'
  server.use(
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })),
    http.get('*/api/platform/clinics', () => HttpResponse.json([])),
    http.get('*/api/platform/applications', () => HttpResponse.json([])),
    http.get('*/api/platform/agreements/statuses', () => HttpResponse.json({})),
    http.get('*/api/platform/pay-requests', () => HttpResponse.json([])),
  )
})
afterEach(() => {
  window.location.hash = ''
})

const owner = { ...me, owner: true, platform: true }

function file(path: string, kind: string, size = 17_350_336): Schemas['MaterialsMaterial'] {
  const parts = path.split('/')
  const link = `/web/materials/file?path=${encodeURIComponent(path)}&exp=1&sig=x`
  return {
    path, name: parts.at(-1), section: parts[0], folder: parts.slice(1, -1).join('/'), kind, size,
    modified: '2026-11-05T06:00:00Z', url: link, downloadUrl: `${link}&download=true`,
  }
}

const listing = {
  configured: true,
  files: [
    file('instagram/01-privet.png', 'image', 435_236),
    file('presentation/Tish-dlya-klinik.pdf', 'pdf', 2_400_000),
    file('guide/Tish-instrukciya.pdf', 'pdf', 13_000_000),
    file('presentation/Tish-dlya-klinik.pptx', 'pptx', 5_100_000),
    file('video/promo-v3/promo-v3-16x9.mp4', 'video'),
    file('video/promo-v4/promo-v4-16x9.mp4', 'video'),
    file('video/promo-v4/promo-v4-tatyna-9x16-nosubs.mp4', 'video'),
    file('video/promo-v4/promo-v4.srt', 'subtitles', 3000),
  ],
} satisfies Schemas['MaterialsListing']

test('подписи роликов и папок — по имени файла', () => {
  expect(videoLabel('promo-v4-16x9.mp4', 'promo-v4')).toBe('Ролик — голос Каната, для компьютера (16:9), с субтитрами')
  expect(videoLabel('promo-v4-tatyna-9x16-nosubs.mp4', 'promo-v4')).toBe('Ролик — голос Татыны, для телефона (9:16), без субтитров')
  expect(videoLabel('promo-v2-vertical.mp4', 'promo-v2')).toBe('Ролик — для телефона (9:16)')
  expect(videoLabel('short-vertical.mp4', 'promo-v2')).toBe('Короткий ролик — для телефона (9:16)')
  expect(videoLabel('kak-zapisatsya.mp4', '')).toBe('Как записаться')
  expect(videoLabel('card-0.mp4', 'promo-v2/clips')).toBe('card-0')
  expect(folderTitle('promo-v4')).toBe('Промо-ролик v4')
  expect(folderTitle('promo-v2/clips')).toBe('Промо v2 · клипы-исходники')
  expect(folderTitle('')).toBe('Инструкции для клиник и пациентов')
  expect(sizeText(17_350_336)).toBe('16,5 МБ')
  expect(sizeText(3000)).toBe('3 КБ')
})

test('владелец: «Материалы» — новые ролики с плеером, старые свёрнуты, презентация и Instagram с кнопками', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/materials', () => HttpResponse.json(listing)),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('tab', { name: 'Материалы' }))

  const videos = await screen.findByRole('region', { name: 'Ролики' })
  expect(within(videos).getByRole('heading', { name: 'Промо-ролик v4' })).toBeInTheDocument()
  const player = within(videos).getByLabelText('Ролик — голос Каната, для компьютера (16:9), с субтитрами')
  expect(player.tagName).toBe('VIDEO')
  expect(player).toHaveAttribute('preload', 'metadata')
  expect(player).toHaveAttribute('src', '/web/materials/file?path=video%2Fpromo-v4%2Fpromo-v4-16x9.mp4&exp=1&sig=x')
  expect(within(videos).getByLabelText('Ролик — голос Татыны, для телефона (9:16), без субтитров')).toBeInTheDocument()
  expect(within(videos).getByRole('link', { name: 'Скачать: Ролик — голос Каната, для компьютера (16:9), с субтитрами' }))
    .toHaveAttribute('href', expect.stringMatching(/\/web\/materials\/file\?path=video%2Fpromo-v4%2Fpromo-v4-16x9\.mp4.*&download=true$/))
  expect(within(videos).getByText('Субтитры · promo-v4.srt')).toBeInTheDocument()

  // Прежняя версия — свёрнута: плеер появляется, только когда её раскрыли
  expect(within(videos).queryByLabelText('Ролик — для компьютера (16:9), с субтитрами')).not.toBeInTheDocument()
  await user.click(within(videos).getByText('Промо-ролик v3'))
  expect(await within(videos).findByLabelText('Ролик — для компьютера (16:9), с субтитрами')).toBeInTheDocument()

  const deck = screen.getByRole('region', { name: 'Презентация' })
  expect(within(deck).getByRole('link', { name: 'Открыть: Презентация · PDF' }))
    .toHaveAttribute('href', expect.stringContaining('path=presentation%2FTish-dlya-klinik.pdf'))
  expect(within(deck).getByRole('link', { name: 'Скачать: Презентация · PowerPoint' })).toHaveAttribute('download', 'Tish-dlya-klinik.pptx')
  expect(within(deck).getByText(/2,3 МБ/)).toBeInTheDocument()

  const insta = screen.getByRole('region', { name: 'Instagram' })
  expect(within(insta).getByRole('img', { name: 'Картинка 01-privet.png' })).toHaveAttribute('src', expect.stringContaining('instagram%2F01-privet.png'))
  expect(within(insta).getByRole('link', { name: 'Открыть: 01-privet.png' })).toBeInTheDocument()

  const links = screen.getByRole('region', { name: 'Ссылки' })
  expect(within(links).getByRole('link', { name: 'Открыть: Сайт-визитка для клиник' })).toHaveAttribute('href', 'https://tish.kg/about')
  expect(within(links).getByRole('link', { name: 'Открыть: Instagram @tish.app.kg' })).toHaveAttribute('href', 'https://www.instagram.com/tish.app.kg/')
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  await user.click(within(links).getByRole('button', { name: 'Скопировать ссылку: Сайт-визитка для клиник' }))
  expect(writeText).toHaveBeenCalledWith('https://tish.kg/about')
  expect(await within(links).findByText('Скопировано')).toBeInTheDocument()
})

test('каталог не подключён — понятная подсказка', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/materials', () => HttpResponse.json({ configured: false, files: [] } satisfies Schemas['MaterialsListing'])),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('tab', { name: 'Материалы' }))
  expect(await screen.findByText(/Каталог материалов не подключён/)).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Ролики' })).not.toBeInTheDocument()
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
  await user.click(await screen.findByRole('tab', { name: 'Материалы' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить материалы')
})

test('менеджер платформы вкладку «Материалы» не видит', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, owner: false, platform: true })))
  renderApp()
  expect(await screen.findByRole('tab', { name: 'Клиники' })).toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: 'Материалы' })).not.toBeInTheDocument()
})

test('PDF-инструкция для клиник — свой блок со ссылкой на печатную версию руководства', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/materials', () => HttpResponse.json(listing)),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('tab', { name: 'Материалы' }))
  const block = await screen.findByRole('region', { name: 'Инструкция для клиник' })
  expect(within(block).getByText('Tish-instrukciya.pdf')).toBeInTheDocument()
  expect(within(block).getByRole('link', { name: 'tish.kg/guide?print=1' })).toHaveAttribute('href', '/guide?print=1')
})
