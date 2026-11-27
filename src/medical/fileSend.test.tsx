import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { server } from '../test/server'
import { PatientFiles } from './PatientFiles'

/**
 * «📤 Отправить пациенту» у снимка (V270 бэкенда): в бот, ссылкой в WhatsApp, QR у кресла; «Отозвать ссылку».
 * Пациент и снимок вымышленные.
 */
const TOKEN = 'k'.repeat(43)
const URL = `https://tish.test/x#${TOKEN}`
const FILE: Schemas['PatientFilesView'] = { id: 7, kind: 'XRAY', caption: '36 до лечения', takenOn: '2026-11-20', sizeBytes: 3, canDelete: true }

function backend({ telegram = true, linkUntil }: { telegram?: boolean; linkUntil?: string } = {}) {
  const calls: string[] = []
  server.use(
    http.get('*/api/patients/2/files', () => HttpResponse.json([{ ...FILE, linkUntil }] satisfies Schemas['PatientFilesView'][])),
    http.get('*/api/patients/2/files/7', () => new HttpResponse(new Uint8Array([1]), { headers: { 'Content-Type': 'image/jpeg' } })),
    http.get('*/api/patients/2/files/send-target', () => HttpResponse.json({ telegram } satisfies Schemas['FileLinksTarget'])),
    http.post('*/api/patients/2/files/7/send', () => {
      calls.push('send')
      return new HttpResponse(null, { status: 204 })
    }),
    http.post('*/api/patients/2/files/7/link', () => {
      calls.push('link')
      return HttpResponse.json({
        url: URL, text: `🩻 Снимок от врача\n\nСнимок от 20.11.2026 — открыть и скачать:\n${URL}`, expiresAt: '2026-12-27T06:00:00Z',
      } satisfies Schemas['FileLinksLink'])
    }),
    http.delete('*/api/patients/2/files/7/link', () => {
      calls.push('revoke')
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('*/api/clinic/post-ai', () => HttpResponse.json({ available: false, on: false })),
    http.get('*/api/patients/2/publication-consent', () => HttpResponse.json({} satisfies Schemas['PublicationConsentsView'])),
  )
  return calls
}

function renderFiles(phone?: string) {
  render(
    <QueryClientProvider client={createQueryClient({ queries: { retry: false } })}>
      <PatientFiles patientId={2} readOnly={false} phone={phone} />
    </QueryClientProvider>,
  )
}

test('пациент в боте: «В Telegram» — снимок уходит картинкой', async () => {
  const calls = backend()
  renderFiles('996700000111')
  await userEvent.click(await screen.findByRole('button', { name: '📤 Отправить пациенту' }))
  const sheet = await screen.findByRole('dialog', { name: 'Отправить снимок пациенту' })
  await userEvent.click(await within(sheet).findByRole('button', { name: /В Telegram/ }))
  expect(await screen.findByRole('status')).toHaveTextContent('Отправлено в Telegram')
  expect(calls).toEqual(['send'])
})

test('без бота: ссылкой в WhatsApp — готовый текст со ссылкой, номер — в адресе wa.me, а не на сервере', async () => {
  const calls = backend({ telegram: false })
  renderFiles('996700000111')
  await userEvent.click(await screen.findByRole('button', { name: '📤 Отправить пациенту' }))
  const sheet = await screen.findByRole('dialog', { name: 'Отправить снимок пациенту' })
  await within(sheet).findByRole('button', { name: /Показать QR/ })
  expect(within(sheet).queryByRole('button', { name: /В Telegram/ })).not.toBeInTheDocument()
  await userEvent.click(within(sheet).getByRole('button', { name: /Ссылкой в WhatsApp/ }))
  const open = await within(sheet).findByRole('link', { name: '💬 Открыть WhatsApp' })
  expect(open.getAttribute('href')).toContain('996700000111')
  expect(decodeURIComponent(open.getAttribute('href') ?? '')).toContain(URL)
  expect(within(sheet).getByText(/Снимок от 20\.11\.2026/)).toBeInTheDocument()
  expect(calls).toEqual(['link'])
})

test('«Показать QR»: крупный код ссылки и срок; без телефона WhatsApp не предлагаем', async () => {
  backend({ telegram: false })
  renderFiles()
  await userEvent.click(await screen.findByRole('button', { name: '📤 Отправить пациенту' }))
  const sheet = await screen.findByRole('dialog', { name: 'Отправить снимок пациенту' })
  await userEvent.click(await within(sheet).findByRole('button', { name: /Показать QR/ }))
  expect(within(sheet).queryByRole('button', { name: /WhatsApp/ })).not.toBeInTheDocument()
  const qr = await within(sheet).findByRole('img', { name: 'QR-код снимка: наведите камеру телефона' })
  expect(qr).toHaveAttribute('data-link', URL)
  expect(within(sheet).getByText('Ссылка действует до 27.12.2026.')).toBeInTheDocument()
})

test('действующая ссылка — «Отозвать ссылку» после подтверждения', async () => {
  const calls = backend({ linkUntil: '2026-12-27T06:00:00Z' })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  renderFiles()
  await userEvent.click(await screen.findByRole('button', { name: 'Отозвать ссылку' }))
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Отозвать ссылку на снимок?'))
  expect(await screen.findByText('Ссылка отозвана — больше не откроется')).toBeInTheDocument()
  expect(calls).toEqual(['revoke'])
})
