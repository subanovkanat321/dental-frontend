import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { server } from '../test/server'
import { DocPreview } from './DocPreview'
import { planImage } from './planImage'
import { SheetSend } from './SheetSend'

// Рисование листа (html-to-image + canvas) в jsdom не работает — подменяем готовой «картинкой»
const draw = vi.hoisted(() => vi.fn(async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })))
vi.mock('./sheetImage', () => ({ sheetPng: draw }))

const nav = navigator as unknown as { share?: unknown; canShare?: unknown }

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:sheet')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  delete nav.share
  delete nav.canShare
  delete (window as { Telegram?: unknown }).Telegram
  draw.mockClear()
})

/** Лист — вымышленный пациент. */
function renderSend(props: Partial<Parameters<typeof SheetSend>[0]> = {}) {
  const sheet = document.createElement('article')
  sheet.className = 'print-sheet'
  sheet.textContent = 'План лечения · Айбек Тестовый'
  document.body.appendChild(sheet)
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <SheetSend label="план лечения" image={planImage(7)} sheet={() => sheet} telegram={false} phone="996700000111" onClose={onClose} {...props} />
    </QueryClientProvider>,
  )
  return { sheet, onClose }
}

test('рисует лист и отправляет картинку в бот: multipart PNG на …/plan/send-image', async () => {
  let got: File | null = null
  server.use(http.post('*/api/patients/7/plan/send-image', async ({ request }) => {
    got = (await request.formData()).get('image') as File
    return new HttpResponse(null, { status: 204 })
  }))
  const { sheet } = renderSend({ telegram: true })
  expect(await screen.findByRole('img', { name: 'Лист картинкой: план лечения' })).toHaveAttribute('src', 'blob:sheet')
  expect(draw).toHaveBeenCalledWith(sheet)

  await userEvent.click(screen.getByRole('button', { name: 'В Telegram-бот' }))
  expect(await screen.findByText('Отправлено в Telegram — пациенту пришло фото листа')).toBeInTheDocument()
  expect(got).not.toBeNull()
  expect(got!.type).toBe('image/png')
  expect(got!.size).toBe(4)
})

test('бот не доставил (409) — текст ошибки, «Скачать картинку» остаётся', async () => {
  server.use(http.post('*/api/patients/7/plan/send-image', () => HttpResponse.json(
    { status: 409, code: 'not-delivered', detail: 'Не доставлено: пациент мог удалить чат с ботом. Отправьте в WhatsApp' }, { status: 409 })))
  renderSend({ telegram: true })
  await userEvent.click(await screen.findByRole('button', { name: 'В Telegram-бот' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Не доставлено')
  expect(screen.getByRole('button', { name: '⬇ Скачать картинку' })).toBeInTheDocument()
})

test('телефон умеет «Поделиться» файлом — системное окно с PNG (WhatsApp выбирают там)', async () => {
  const share = vi.fn(async () => {})
  nav.canShare = vi.fn(() => true)
  nav.share = share
  renderSend()
  await userEvent.click(await screen.findByRole('button', { name: 'Поделиться — WhatsApp и др.' }))
  expect(share).toHaveBeenCalledTimes(1)
  const [data] = share.mock.calls[0] as unknown as [{ files: File[] }]
  expect(data.files[0]!.name).toBe('plan-lecheniya.png')
  expect(data.files[0]!.type).toBe('image/png')
  expect(await screen.findByText('Готово — картинка отправлена')).toBeInTheDocument()
  // Пациент не в боте — кнопки бота нет
  expect(screen.queryByRole('button', { name: 'В Telegram-бот' })).not.toBeInTheDocument()
})

test('«Поделиться» закрыли — не ошибка', async () => {
  nav.canShare = vi.fn(() => true)
  nav.share = vi.fn(async () => { throw new DOMException('cancel', 'AbortError') })
  renderSend()
  await userEvent.click(await screen.findByRole('button', { name: 'Поделиться — WhatsApp и др.' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('компьютер без «Поделиться» — «Скачать картинку» и подсказка прикрепить в WhatsApp и про PDF', async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  renderSend()
  const download = await screen.findByRole('button', { name: '⬇ Скачать картинку' })
  expect(screen.queryByRole('button', { name: /Поделиться/ })).not.toBeInTheDocument()
  expect(screen.getByText(/скачайте её и прикрепите в чате пациента/)).toHaveTextContent('«🖨 Печать» → «Сохранить как PDF»')
  await userEvent.click(download)
  expect(click).toHaveBeenCalledTimes(1)
  expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('plan-lecheniya.png')
  expect(screen.getByRole('status')).toHaveTextContent('Картинка скачана')
  expect(screen.getByRole('button', { name: 'Открыть чат WhatsApp' })).toBeInTheDocument()
  click.mockRestore()
})

test('Telegram (Mini App) без «Поделиться»: скачать нельзя — бот и подсказка открыть Tish в браузере', async () => {
  ;(window as { Telegram?: unknown }).Telegram = { WebApp: { initData: 'query_id=1', HapticFeedback: { notificationOccurred() {} } } }
  renderSend({ telegram: true })
  expect(await screen.findByRole('button', { name: 'В Telegram-бот' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '⬇ Скачать картинку' })).not.toBeInTheDocument()
  expect(screen.getByText(/из Tish в браузере телефона или на компьютере/)).toBeInTheDocument()
})

test('не нарисовалось — понятная ошибка', async () => {
  draw.mockRejectedValueOnce(new Error('canvas'))
  renderSend()
  expect(await screen.findByRole('alert')).toHaveTextContent('Не получилось нарисовать лист')
})

test('DocPreview: «📷 Отправить листом» с вкладки «Сообщение» переключает на лист и рисует именно его', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DocPreview label="квитанция" text="🧾 Квитанция" telegram={false} phone="996700000111"
        paper={{ render: () => <p>Оплачено: 3 000 сом</p>, image: { fileName: 'kvitanciya.png' } }}
        onTelegram={() => {}} onWhatsapp={() => {}} onPrint={() => {}} />
    </QueryClientProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Отправить листом: квитанция' }))
  expect(screen.getByRole('button', { name: '📄 Лист' })).toHaveAttribute('aria-pressed', 'true')
  expect(await screen.findByRole('img', { name: 'Лист картинкой: квитанция' })).toBeInTheDocument()
  await waitFor(() => expect(draw).toHaveBeenCalledTimes(1))
  const drawn = (draw.mock.calls[0] as unknown as [HTMLElement])[0]
  expect(drawn).toHaveClass('print-sheet')
  expect(drawn).toHaveTextContent('Оплачено: 3 000 сом')
  // У квитанции бота-картинки нет — только скачать
  expect(screen.queryByRole('button', { name: 'В Telegram-бот' })).not.toBeInTheDocument()
})
