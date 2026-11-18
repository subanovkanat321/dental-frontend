import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { server } from '../test/server'
import { PayPage } from './PayPage'
import { payToken } from './payToken'

const TOKEN = 'c'.repeat(43)

afterEach(() => {
  window.history.replaceState(null, '', '/')
  localStorage.clear()
})

test('токен — только из /pay/<43 знака>', () => {
  expect(payToken(`/pay/${TOKEN}`)).toBe(TOKEN)
  expect(payToken('/pay/short')).toBeNull()
  expect(payToken(`/r/${TOKEN}`)).toBeNull()
})

test('/pay/<токен>: QR, клиника, врач и реквизиты — без пациента и суммы', async () => {
  window.history.replaceState(null, '', `/pay/${TOKEN}`)
  server.use(http.get(`*/web/pay/${TOKEN}`, () => HttpResponse.json({
    clinicName: 'Стоматология «Тест»', doctorName: 'Айгерим Садыкова', details: 'MBANK 0555 123 456 (Айгерим С.)',
  } satisfies Schemas['PayRequisitesPage'])))
  render(<PayPage />)
  expect(await screen.findByRole('heading', { name: 'QR для оплаты' })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'QR для оплаты' })).toHaveAttribute('src', `/web/pay/${TOKEN}/qr`)
  expect(screen.getByText('Стоматология «Тест»')).toBeInTheDocument()
  expect(screen.getByText('Врач: Айгерим Садыкова')).toBeInTheDocument()
  expect(screen.getByText('MBANK 0555 123 456 (Айгерим С.)')).toBeInTheDocument()
  expect(document.body).not.toHaveTextContent(/сом/)
})

test('QR заменили — ссылка не открывается: попросить новый', async () => {
  window.history.replaceState(null, '', `/pay/${TOKEN}`)
  server.use(http.get(`*/web/pay/${TOKEN}`, () => HttpResponse.json({ status: 404 }, { status: 404 })))
  render(<PayPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('QR не найден или клиника его заменила')
})
