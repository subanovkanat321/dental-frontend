import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import type { HowToVideo } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { server } from '../test/server'
import { HowToPage } from './HowToPage'
import { duration, groupVideos } from './howto'
import { HELP_ITEMS } from './items'

const VIDEOS: HowToVideo[] = [
  { id: 'zapis', title: 'Записать пациента', video: '/web/materials/howto/zapis.mp4', poster: '/web/materials/howto/zapis.webp', section: 'Расписание', lead: '«＋ Новая запись»: пациент, услуга, время', seconds: 22 },
  { id: 'perenos', title: 'Перенести приём', video: '/web/materials/howto/perenos.mp4', poster: '/web/materials/howto/perenos.webp', section: 'Расписание', lead: 'Другой день или врач', seconds: 21 },
  { id: 'kassa', title: 'Касса: принять оплату', video: '/web/materials/howto/kassa.mp4', section: 'Касса', lead: '«Приём состоялся» → сумма' },
]

afterEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

function renderPage(onBack = vi.fn()) {
  const client = createQueryClient({ queries: { retry: false } })
  return render(<QueryClientProvider client={client}><HowToPage onBack={onBack} /></QueryClientProvider>)
}

test('«Помощь» — пункт «Видео: как сделать» для всех ролей', () => {
  const item = HELP_ITEMS.find((i) => i.key === 'videos')!
  expect(item.title).toBe('Видео: как сделать')
  expect(item.show({ admin: false, reception: false, doctors: [] } as never)).toBe(true)
})

test('группы по разделам в порядке списка; длительность «0:22»', () => {
  expect(groupVideos(VIDEOS).map(([name, list]) => [name, list.map((v) => v.id)])).toEqual([['Расписание', ['zapis', 'perenos']], ['Касса', ['kassa']]])
  expect(duration(22)).toBe('0:22')
  expect(duration(75)).toBe('1:15')
  expect(duration(null)).toBeNull()
})

test('карточки по разделам: обложка, название, длительность; просмотрщик — «Следующее видео», ✕ закрывает', async () => {
  server.use(http.get('*/web/materials/howto', () => HttpResponse.json(VIDEOS)))
  const { container } = renderPage()
  const schedule = await screen.findByRole('region', { name: 'Расписание' })
  expect(within(schedule).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Записать пациента, 0:22', 'Перенести приём, 0:21'])
  expect(schedule.querySelector('img')).toHaveAttribute('src', '/web/materials/howto/zapis.webp')
  expect(within(screen.getByRole('region', { name: 'Касса' })).getByRole('button', { name: 'Касса: принять оплату' })).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  await userEvent.click(within(schedule).getByRole('button', { name: /Записать пациента/ }))
  const player = screen.getByRole('dialog', { name: 'Записать пациента' })
  const video = player.querySelector('video')!
  expect(video).toHaveAttribute('src', '/web/materials/howto/zapis.mp4')
  expect(video).toHaveAttribute('poster', '/web/materials/howto/zapis.webp')
  expect(video).toHaveAttribute('playsinline')

  // Следующее — по порядку, через границу раздела
  await userEvent.click(within(player).getByRole('button', { name: /Следующее видео › Перенести приём/ }))
  expect(screen.getByRole('dialog', { name: 'Перенести приём' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Следующее видео › Касса/ }))
  expect(container.querySelector('video')).toHaveAttribute('src', '/web/materials/howto/kassa.mp4')
  expect(container.querySelector('video')).not.toHaveAttribute('poster')
  expect(screen.getByText('Это последнее видео — вы посмотрели всё')).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('досмотрели — «✓ Просмотрено» на карточке и после перезахода (localStorage)', async () => {
  server.use(http.get('*/web/materials/howto', () => HttpResponse.json(VIDEOS)))
  const { unmount } = renderPage()
  await userEvent.click(await screen.findByRole('button', { name: /Записать пациента/ }))
  screen.getByRole('dialog').querySelector('video')!.dispatchEvent(new Event('ended'))
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть видео' }))
  expect(screen.getByRole('button', { name: 'Записать пациента, 0:22, просмотрено' })).toHaveTextContent('✓ Просмотрено')
  expect(screen.getByText(/Просмотрено: 1 из 3/)).toBeInTheDocument()
  unmount()
  renderPage()
  expect(await screen.findByRole('button', { name: 'Записать пациента, 0:22, просмотрено' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Перенести приём, 0:21' })).toBeInTheDocument()
})

test('поиск и фильтр по разделу', async () => {
  server.use(http.get('*/web/materials/howto', () => HttpResponse.json(VIDEOS)))
  renderPage()
  await screen.findByRole('region', { name: 'Расписание' })
  await userEvent.type(screen.getByRole('searchbox', { name: 'Поиск видео' }), 'сумма')
  expect(screen.queryByRole('region', { name: 'Расписание' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Касса: принять оплату' })).toBeInTheDocument()
  await userEvent.type(screen.getByRole('searchbox', { name: 'Поиск видео' }), 'нет такого')
  expect(screen.getByRole('status')).toHaveTextContent('Ничего не нашли')
  await userEvent.clear(screen.getByRole('searchbox', { name: 'Поиск видео' }))
  await userEvent.click(within(screen.getByRole('group', { name: 'Раздел' })).getByRole('button', { name: 'Касса' }))
  expect(screen.queryByRole('region', { name: 'Расписание' })).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Касса' })).toBeInTheDocument()
  // Раздел выбран — без заголовка группы: он уже на таблетке
  expect(within(screen.getByRole('region', { name: 'Касса' })).queryByRole('heading')).not.toBeInTheDocument()
})

test('ссылка из руководства #/help/videos/kassa — сразу этот ролик; закрыли — адрес без ролика', async () => {
  window.history.replaceState(null, '', '/#/help/videos/kassa')
  server.use(http.get('*/web/materials/howto', () => HttpResponse.json(VIDEOS)))
  renderPage()
  expect(await screen.findByRole('dialog', { name: 'Касса: принять оплату' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть видео' }))
  expect(window.location.hash).toBe('#/help/videos')
})

test('видео ещё нет — так и пишем; сервер не ответил — ошибка', async () => {
  const { unmount } = renderPage()
  expect(await screen.findByText('Видео пока нет')).toBeInTheDocument()
  unmount()
  server.use(http.get('*/web/materials/howto', () => new HttpResponse(null, { status: 500 })))
  renderPage()
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить список видео')
})

test('каждая группа — свой блок: заголовок на всю ширину и своя сетка карточек', async () => {
  server.use(http.get('*/web/materials/howto', () => HttpResponse.json(VIDEOS)))
  const { container } = renderPage()
  await screen.findByRole('region', { name: 'Расписание' })
  const groups = [...container.querySelectorAll('.howto-groups > section')]
  expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Расписание', 'Касса'])
  for (const g of groups) {
    // Заголовок — первым, затем своя сетка только с карточками этой группы
    expect(g.firstElementChild?.tagName).toBe('H2')
    expect(g.querySelectorAll(':scope > ul.howto-grid')).toHaveLength(1)
  }
  expect(within(groups[0] as HTMLElement).getAllByRole('listitem')).toHaveLength(2)
  expect(within(groups[1] as HTMLElement).getAllByRole('listitem')).toHaveLength(1)
  // Абзац сверху — одной строкой
  expect(screen.getByText(/^Ролики по 20–40 секунд/)).toHaveClass('howto-intro')
})
