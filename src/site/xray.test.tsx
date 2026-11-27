import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { server } from '../test/server'
import { XrayPage } from './XrayPage'
import { xrayToken } from './xrayToken'

/** Снимок по ссылке /x#<секрет> (V270 бэкенда): только картинка, клиника, дата и «Скачать». Данные вымышленные. */
const TOKEN = 'x'.repeat(43)

afterEach(() => {
  window.history.replaceState(null, '', '/')
  localStorage.clear()
})

test('секрет — только из фрагмента #<43 знака>', () => {
  expect(xrayToken(`#${TOKEN}`)).toBe(TOKEN)
  expect(xrayToken('#short')).toBeNull()
  expect(xrayToken('')).toBeNull()
})

test('/x#<секрет>: снимок, клиника, дата и «Скачать» — без имени пациента', async () => {
  window.history.replaceState(null, '', `/x#${TOKEN}`)
  server.use(http.get(`*/web/x/${TOKEN}`, () => HttpResponse.json({
    clinic: 'Стоматология «Тест»', takenOn: '2026-11-20', expiresAt: '2026-12-27T06:00:00Z',
  } satisfies Schemas['FileLinksPage'])))
  render(<XrayPage />)
  expect(await screen.findByRole('heading', { name: 'Снимок от 20.11.2026' })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Снимок от 20.11.2026' })).toHaveAttribute('src', `/web/x/${TOKEN}/image`)
  const download = screen.getByRole('link', { name: '⬇ Скачать' })
  expect(download).toHaveAttribute('href', `/web/x/${TOKEN}/image?download=true`)
  expect(download).toHaveAttribute('download')
  expect(screen.getByText('Стоматология «Тест»')).toBeInTheDocument()
  expect(screen.getByText(/Ссылка действует до 27\.12\.2026/)).toBeInTheDocument()
})

test('истекла или отозвана — «попросите клинику прислать снова»', async () => {
  window.history.replaceState(null, '', `/x#${TOKEN}`)
  server.use(http.get(`*/web/x/${TOKEN}`, () => HttpResponse.json({ status: 404 }, { status: 404 })))
  render(<XrayPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Ссылка устарела — попросите клинику прислать снова')
})

test('не похоже на секрет — сразу «устарела», без запроса', () => {
  window.history.replaceState(null, '', '/x#abc')
  render(<XrayPage />)
  expect(screen.getByRole('alert')).toHaveTextContent('Ссылка устарела')
})
