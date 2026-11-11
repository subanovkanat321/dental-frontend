import { onlineManager } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'

import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { Loading } from './Loading'

/** Без сети: плашка «Нет интернета» над рабочей областью и «ждём связь» вместо вечной «Загрузки…». */
afterEach(() => act(() => onlineManager.setOnline(true)))

test('пропала сеть — плашка «Нет интернета»; вернулась — плашки нет', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
  )
  renderApp()
  await screen.findByRole('navigation', { name: 'Разделы' })
  expect(screen.queryByText(/Нет интернета/)).not.toBeInTheDocument()
  act(() => onlineManager.setOnline(false))
  expect(screen.getByText(/Нет интернета — проверьте связь/)).toBeInTheDocument()
  act(() => onlineManager.setOnline(true))
  expect(screen.queryByText(/Нет интернета/)).not.toBeInTheDocument()
})

test('«Загрузка…» без сети — текст про связь (запросы на паузе ждут её)', () => {
  act(() => onlineManager.setOnline(false))
  render(<Loading delay={0} />)
  expect(screen.getByRole('status')).toHaveTextContent('Нет интернета — ждём связь…')
  act(() => onlineManager.setOnline(true))
  expect(screen.getByRole('status')).toHaveTextContent('Загрузка…')
})
