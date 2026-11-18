import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { server } from '../test/server'
import { ReviewPage } from './ReviewPage'
import { reviewToken } from './reviewToken'

type Page = Schemas['ReviewLinksPage']

const TOKEN = 'b'.repeat(43)
const START = '2026-11-16T05:00:00Z' // 11:00 по Бишкеку
const BASE: Page = { clinicName: 'Стоматология «Тест»', doctorName: 'Айгерим Садыкова', startAt: START, canComment: false, commented: false }

afterEach(() => {
  window.history.replaceState(null, '', '/')
  localStorage.clear()
})

function backend(after: (rating: number) => Page) {
  const calls: unknown[] = []
  let page: Page = BASE
  server.use(
    http.get(`*/web/review/${TOKEN}`, () => HttpResponse.json(page)),
    http.post(`*/web/review/${TOKEN}`, async ({ request }) => {
      const body = await request.json() as { rating: number }
      calls.push(body)
      page = after(body.rating)
      return HttpResponse.json(page)
    }),
    http.post(`*/web/review/${TOKEN}/comment`, async ({ request }) => {
      calls.push(await request.json())
      page = { ...page, canComment: false, commented: true }
      return HttpResponse.json(page)
    }),
  )
  return calls
}

test('секрет — только из /r/<43 знака>', () => {
  expect(reviewToken(`/r/${TOKEN}`)).toBe(TOKEN)
  expect(reviewToken('/r/short')).toBeNull()
  expect(reviewToken(`/x/${TOKEN}`)).toBeNull()
})

test('5 ⭐ — спасибо и большая кнопка «Оставить отзыв в 2ГИС» и «Google»; имени пациента нет', async () => {
  window.history.replaceState(null, '', `/r/${TOKEN}`)
  const calls = backend((rating) => ({ ...BASE, rating, mapUrl: 'https://2gis.kg/bishkek/firm/1', googleUrl: 'https://g.page/r/test/review' }))
  const user = userEvent.setup()
  render(<ReviewPage />)
  expect(await screen.findByRole('heading', { name: 'Как прошёл приём?' })).toBeInTheDocument()
  expect(screen.getByText('Стоматология «Тест»')).toBeInTheDocument()
  expect(screen.getByText(/врач Айгерим Садыкова/)).toBeInTheDocument()
  expect(screen.getByText(/11:00/)).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '5 из 5' }))
  expect(calls).toEqual([{ rating: 5 }])
  expect(await screen.findByRole('heading', { name: 'Спасибо за оценку!' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '⭐ Оставить отзыв в 2ГИС' })).toHaveAttribute('href', 'https://2gis.kg/bishkek/firm/1')
  expect(screen.getByRole('link', { name: 'Отзыв в Google' })).toHaveAttribute('href', 'https://g.page/r/test/review')
  expect(screen.queryByLabelText('Что было не так?')).not.toBeInTheDocument()
})

test('4 ⭐ — тоже кнопки 2ГИС и Google', async () => {
  window.history.replaceState(null, '', `/r/${TOKEN}`)
  backend((rating) => ({ ...BASE, rating, mapUrl: 'https://2gis.kg/bishkek/firm/1', googleUrl: 'https://g.page/r/test/review' }))
  const user = userEvent.setup()
  render(<ReviewPage />)
  await user.click(await screen.findByRole('button', { name: '4 из 5' }))
  expect(await screen.findByRole('link', { name: '⭐ Оставить отзыв в 2ГИС' })).toHaveAttribute('href', 'https://2gis.kg/bishkek/firm/1')
  expect(screen.getByRole('link', { name: 'Отзыв в Google' })).toBeInTheDocument()
  expect(screen.queryByLabelText('Что было не так?')).not.toBeInTheDocument()
})

test('2 ⭐ — сначала «Что было не так?», ниже спокойно «можно также» 2ГИС и Google (без review gating)', async () => {
  window.history.replaceState(null, '', `/r/${TOKEN}`)
  const calls = backend((rating) => ({ ...BASE, rating, canComment: true, mapUrl: 'https://2gis.kg/bishkek/firm/1', googleUrl: 'https://g.page/r/test/review' }))
  const user = userEvent.setup()
  render(<ReviewPage />)
  await user.click(await screen.findByRole('button', { name: '2 из 5' }))

  const field = await screen.findByLabelText('Что было не так?')
  const also = screen.getByText(/можно также оставить отзыв о клинике/)
  const gis = screen.getByRole('link', { name: 'в 2ГИС' })
  expect(gis).toHaveAttribute('href', 'https://2gis.kg/bishkek/firm/1')
  expect(screen.getByRole('link', { name: 'в Google' })).toHaveAttribute('href', 'https://g.page/r/test/review')
  // Основной путь — написать клинике: поле выше ссылок, больших кнопок «⭐ Оставить отзыв» нет
  expect(field.compareDocumentPosition(also) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.queryByRole('link', { name: '⭐ Оставить отзыв в 2ГИС' })).not.toBeInTheDocument()

  // Написал руководителю — ссылки остаются
  await user.type(field, 'Долго ждала')
  await user.click(screen.getByRole('button', { name: 'Отправить' }))
  expect(calls).toEqual([{ rating: 2 }, { text: 'Долго ждала' }])
  expect(await screen.findByText(/Передали врачу/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'в 2ГИС' })).toBeInTheDocument()
})

test('2 ⭐ без ссылок в «О клинике» — «Что было не так?» уходит клинике; кыргызский', async () => {
  window.history.replaceState(null, '', `/r/${TOKEN}`)
  const calls = backend((rating) => ({ ...BASE, rating, canComment: true }))
  const user = userEvent.setup()
  render(<ReviewPage />)
  await user.click(await screen.findByRole('button', { name: 'Кыргызча' }))
  expect(screen.getByRole('heading', { name: 'Кабыл алуу кандай өттү?' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Русский' }))

  await user.click(screen.getByRole('button', { name: '2 из 5' }))
  expect(await screen.findByText(/Нам жаль, что что-то не понравилось/)).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /2ГИС/ })).not.toBeInTheDocument()
  await user.type(screen.getByLabelText('Что было не так?'), 'Долго ждала в коридоре')
  await user.click(screen.getByRole('button', { name: 'Отправить' }))
  expect(calls).toEqual([{ rating: 2 }, { text: 'Долго ждала в коридоре' }])
  expect(await screen.findByText(/Передали врачу/)).toBeInTheDocument()
  expect(localStorage.getItem('clinic.lang')).toBe('ru')
})

test('ссылка устарела или чужая — «позвоните в клинику»', async () => {
  window.history.replaceState(null, '', `/r/${TOKEN}`)
  server.use(http.get(`*/web/review/${TOKEN}`, () => HttpResponse.json({ detail: 'нет' }, { status: 404 })))
  render(<ReviewPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Ссылка не найдена или устарела')
})
