import { QueryClientProvider } from '@tanstack/react-query'
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { server } from '../test/server'
import { PatientFiles } from './PatientFiles'

/**
 * «Снимки и фото»: загрузка. Телефон — «Камера», «Галерея», «Файл»; компьютер — «Выбрать файлы» и перетаскивание.
 * Пациент вымышленный, «фото» — байты-заглушки: сжатие (`resizePhoto`) подменено.
 */
vi.mock('./thumb', () => ({ resizePhoto: (file: Blob) => Promise.resolve(file) }))

function touchScreen(touch: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: touch && query.includes('coarse'), media: query, addEventListener() {}, removeEventListener() {}, onchange: null,
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
}
afterEach(() => vi.unstubAllGlobals())

function backend() {
  const sent: { kind: FormDataEntryValue | null; name: string }[] = []
  server.use(
    http.get('*/api/patients/2/files', () => HttpResponse.json([] satisfies Schemas['PatientFilesView'][])),
    http.post('*/api/patients/2/files', async ({ request }) => {
      const form = await request.formData()
      sent.push({ kind: form.get('kind'), name: (form.get('file') as File).name })
      return HttpResponse.json({ id: 99, kind: 'XRAY', canDelete: true, sizeBytes: 3 } satisfies Schemas['PatientFilesView'], { status: 201 })
    }),
    http.get('*/api/clinic/post-ai', () => HttpResponse.json({ available: false, on: false })),
    http.get('*/api/patients/2/publication-consent', () => HttpResponse.json({} satisfies Schemas['PublicationConsentsView'])),
  )
  return sent
}

function renderFiles() {
  render(
    <QueryClientProvider client={createQueryClient({ queries: { retry: false } })}>
      <PatientFiles patientId={2} readOnly={false} />
    </QueryClientProvider>,
  )
  return screen.getByRole('region', { name: 'Снимки и фото' })
}

const photo = (name = 'snimok.jpg', type = 'image/jpeg') => new File([new Uint8Array([1, 2, 3])], name, { type })

test('телефон: три кнопки — «Камера» сразу камерой, «Галерея» и «Файл» — несколько фото; каждая загружает', async () => {
  touchScreen(true)
  const sent = backend()
  const block = renderFiles()

  const camera = within(block).getByLabelText('Сфотографировать снимок')
  expect(camera).toHaveAttribute('accept', 'image/*')
  expect(camera).toHaveAttribute('capture', 'environment')
  expect(camera).not.toHaveAttribute('multiple')
  const gallery = within(block).getByLabelText('Фото из галереи')
  expect(gallery).toHaveAttribute('accept', 'image/*')
  expect(gallery).not.toHaveAttribute('capture')
  expect(gallery).toHaveAttribute('multiple')
  const file = within(block).getByLabelText('Файлы снимков')
  // Сервер берёт только картинки — PDF в «Файле» не предлагаем
  expect(file.getAttribute('accept')).toContain('image/jpeg')
  expect(file.getAttribute('accept')).not.toContain('pdf')
  expect(file).not.toHaveAttribute('capture')
  expect(file).toHaveAttribute('multiple')
  expect(within(block).getByText('📷 Камера')).toBeInTheDocument()
  expect(within(block).getByText('🖼 Галерея')).toBeInTheDocument()
  expect(within(block).getByText('📎 Файл')).toBeInTheDocument()

  await userEvent.upload(camera, photo('kamera.jpg'))
  await waitFor(() => expect(sent).toHaveLength(1))
  await userEvent.upload(gallery, [photo('a.jpg'), photo('b.png', 'image/png')])
  await waitFor(() => expect(sent).toHaveLength(3))
  await userEvent.upload(file, photo('rentgen.png', 'image/png'))
  await waitFor(() => expect(sent).toHaveLength(4))
  expect(sent.every((s) => s.kind === 'XRAY')).toBe(true)
  expect(await within(block).findByRole('status')).toHaveTextContent('Загружено: 1')
})

test('компьютер: без «Камеры» — одна кнопка «Выбрать файлы» и перетаскивание на блок', async () => {
  touchScreen(false)
  const sent = backend()
  const block = renderFiles()

  expect(within(block).queryByLabelText('Сфотографировать снимок')).not.toBeInTheDocument()
  expect(within(block).queryByLabelText('Фото из галереи')).not.toBeInTheDocument()
  expect(within(block).getByText('📎 Выбрать файлы')).toBeInTheDocument()
  expect(within(block).getByText('или перетащите снимки сюда')).toBeInTheDocument()

  await userEvent.upload(within(block).getByLabelText('Файлы снимков'), photo('s-kompyutera.jpg'))
  await waitFor(() => expect(sent).toHaveLength(1))

  // Перетащили два снимка и PDF: PDF сервер не примет — уходят только картинки
  const files = [photo('pano.jpg'), photo('kt.png', 'image/png'), new File(['%PDF'], 'zakl.pdf', { type: 'application/pdf' })]
  const dataTransfer = { types: ['Files'], files, dropEffect: 'none' }
  const over = createEvent.dragOver(block)
  Object.defineProperty(over, 'dataTransfer', { value: dataTransfer })
  fireEvent(block, over)
  expect(over.defaultPrevented).toBe(true)
  expect(block).toHaveClass('drop-over')
  fireEvent.drop(block, { dataTransfer })
  expect(block).not.toHaveClass('drop-over')
  await waitFor(() => expect(sent).toHaveLength(3))
  expect(sent.slice(1).map((s) => s.kind)).toEqual(['XRAY', 'XRAY'])
  expect(await within(block).findByRole('status')).toHaveTextContent('Загружено: 2')

  // Одни PDF — ничего не уходит, подсказка
  fireEvent.drop(block, { dataTransfer: { types: ['Files'], files: [files[2]] } })
  expect(await within(block).findByRole('status')).toHaveTextContent('Нужна картинка')
  expect(sent).toHaveLength(3)
})
