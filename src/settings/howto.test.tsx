import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { expect, test, vi } from 'vitest'

import type { HowToVideo } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { server } from '../test/server'
import { HowToPage } from './HowToPage'
import { HELP_ITEMS } from './items'

const VIDEOS: HowToVideo[] = [
  { id: 'zapis', title: 'Записать пациента', video: '/web/materials/howto/zapis.mp4', poster: '/web/materials/howto/zapis.webp' },
  { id: 'kassa', title: 'Касса: принять оплату', video: '/web/materials/howto/kassa.mp4', poster: null },
]

function renderPage(onBack = vi.fn()) {
  const client = createQueryClient({ queries: { retry: false } })
  return render(<QueryClientProvider client={client}><HowToPage onBack={onBack} /></QueryClientProvider>)
}

test('«Помощь» — пункт «Видео: как сделать» для всех ролей', () => {
  const item = HELP_ITEMS.find((i) => i.key === 'videos')!
  expect(item.title).toBe('Видео: как сделать')
  expect(item.show({ admin: false, reception: false, doctors: [] } as never)).toBe(true)
})

test('сетка обложек; нажал — плеер на весь экран с нужным роликом, ✕ закрывает', async () => {
  server.use(http.get('*/web/materials/howto', () => HttpResponse.json(VIDEOS)))
  const { container } = renderPage()
  const grid = await screen.findByRole('list', { name: 'Видео-инструкции' })
  const tiles = within(grid).getAllByRole('button')
  expect(tiles.map((b) => b.textContent)).toEqual(['Записать пациента', '🎬Касса: принять оплату'])
  expect(grid.querySelector('img')).toHaveAttribute('src', '/web/materials/howto/zapis.webp')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  await userEvent.click(within(grid).getByRole('button', { name: /Записать пациента/ }))
  const player = screen.getByRole('dialog', { name: 'Записать пациента' })
  const video = player.querySelector('video')!
  expect(video).toHaveAttribute('src', '/web/materials/howto/zapis.mp4')
  expect(video).toHaveAttribute('poster', '/web/materials/howto/zapis.webp')
  expect(video).toHaveAttribute('controls')
  expect(video).toHaveAttribute('playsinline')

  await userEvent.click(within(player).getByRole('button', { name: 'Закрыть видео' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  // Ролик без обложки — без poster
  await userEvent.click(within(grid).getByRole('button', { name: /Касса/ }))
  expect(container.querySelector('video')).toHaveAttribute('src', '/web/materials/howto/kassa.mp4')
  expect(container.querySelector('video')).not.toHaveAttribute('poster')
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('видео ещё нет — так и пишем; сервер не ответил — ошибка', async () => {
  const { unmount } = renderPage()
  expect(await screen.findByText('Видео пока нет.')).toBeInTheDocument()
  unmount()
  server.use(http.get('*/web/materials/howto', () => new HttpResponse(null, { status: 500 })))
  renderPage()
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить список видео')
})
