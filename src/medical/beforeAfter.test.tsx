import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { boxFrom, clampCrop, FIT, frames, placement } from './beforeAfterDraw'
import { buildPost, durationBetween, hashtags } from './postText'

/** Вымышленный пациент и два «фото» — байты-заглушки, картинку подменяет createImageBitmap. */
const FILES: Schemas['PatientFilesView'][] = [
  { id: 8, kind: 'PHOTO', caption: 'После', takenOn: '2026-10-30', canDelete: true },
  { id: 7, kind: 'PHOTO', caption: 'До', takenOn: '2026-10-01', canDelete: true },
]

function backend(consent: Schemas['PublicationConsentsView'] = {}, files = FILES) {
  let current = consent
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({
      ...me, services: [{ id: 3, name: 'Отбеливание', durationMinutes: 60 }],
      clinic: { ...me.clinic, code: 'test', address: 'Бишкек, ул. Вымышленная, 1', phones: ['996555000000'] },
    })),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/patients/recent', () => HttpResponse.json([{ id: 2, fullName: 'Вымышленная П.', phone: '996700333444' }])),
    http.get('*/api/appointments/by-patient/2', () => HttpResponse.json({
      patient: { id: 2, fullName: 'Вымышленная П.', phone: '996700333444' }, done: 1, noShow: 0, cancelled: 0, upcoming: [], past: [],
    })),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/patients/2/teeth', () => HttpResponse.json([])),
    http.get('*/api/patients/2/plan', () => HttpResponse.json([])),
    http.get('*/api/patients/2/files', () => HttpResponse.json(files)),
    http.get('*/api/patients/2/files/:id', ({ params }) => {
      sent.push({ file: Number(params.id) })
      return new HttpResponse(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } })
    }),
    http.get('*/api/patients/2/publication-consent', () => HttpResponse.json(current)),
    http.put('*/api/patients/2/publication-consent', async ({ request }) => {
      const body = (await request.json()) as Schemas['PublicationConsentsRequest']
      sent.push({ consent: body.scope })
      current = { scope: body.scope, givenAt: '2026-11-03T05:00:00Z', givenBy: 'Айгерим Садыкова' }
      return HttpResponse.json(current)
    }),
    http.delete('*/api/patients/2/publication-consent', () => {
      sent.push({ consent: null })
      current = {}
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return sent
}

/** В jsdom нет настоящего холста: подменяем контекст — тест проверяет, что рисование вызвано. */
function fakeCanvas() {
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key === 'measureText') return () => ({ width: 100 })
      if (!(key in target)) target[key] = vi.fn()
      return target[key]
    },
    set(target, key, value) {
      target[key] = value
      return true
    },
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as unknown as CanvasRenderingContext2D)
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['png'], { type: 'image/png' })))
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 800, height: 600, close() {} })))
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
  return { ctx, toBlob }
}

beforeEach(() => {
  window.location.hash = '/patients'
})
afterEach(() => {
  window.location.hash = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function openMedical() {
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Вымышленная П.' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Медкарта и снимки' }))
  expect(await screen.findByRole('heading', { name: 'Медкарта · Вымышленная П.' })).toBeInTheDocument()
}

test('без согласия «До / после» выключена с объяснением; галочка ставит согласие «без лица», снимается обратно', async () => {
  const sent = backend()
  await openMedical()
  const button = await screen.findByRole('button', { name: 'Собрать картинку «до / после»' })
  expect(button).toBeDisabled()
  expect(button).toHaveAccessibleDescription('Сначала отметьте согласие пациента на публикацию.')

  const box = screen.getByRole('checkbox', { name: /согласен\(на\) на публикацию фото/ })
  await userEvent.click(box)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Собрать картинку «до / после»' })).toBeEnabled())
  expect(sent).toContainEqual({ consent: 'NO_FACE' })
  expect(screen.getByText(/Отметил\(а\) Айгерим Садыкова/)).toBeInTheDocument()

  await userEvent.click(within(screen.getByRole('group', { name: 'Что можно публиковать' })).getByRole('button', { name: 'С лицом' }))
  expect(sent).toContainEqual({ consent: 'WITH_FACE' })

  await userEvent.click(screen.getByRole('checkbox', { name: /согласен\(на\) на публикацию фото/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Собрать картинку «до / после»' })).toBeDisabled())
  expect(sent).toContainEqual({ consent: null })
})

test('одно фото — кнопка выключена: нужно два', async () => {
  backend({ scope: 'WITH_FACE', givenAt: '2026-11-03T05:00:00Z' }, [FILES[0]!])
  await openMedical()
  expect(await screen.findByRole('button', { name: 'Собрать картинку «до / после»' })).toHaveAccessibleDescription('Нужно хотя бы два фото: «до» и «после».')
})

test('конструктор: два фото загружены целиком, холст рисуется, процедура из услуг, «Скачать PNG» без имени пациента', async () => {
  const { ctx, toBlob } = fakeCanvas()
  const sent = backend({ scope: 'NO_FACE', givenAt: '2026-11-03T05:00:00Z', givenBy: 'Айгерим Садыкова' })
  await openMedical()
  await userEvent.click(await screen.findByRole('button', { name: 'Собрать картинку «до / после»' }))
  const dialog = await screen.findByRole('dialog', { name: 'До / после' })
  // Согласие только без лица — напоминание и режим «Скрыть глаза» сразу
  expect(within(dialog).getByRole('note')).toHaveTextContent(/только без лица/)
  expect(within(dialog).getByRole('button', { name: 'Скрыть глаза' })).toHaveAttribute('aria-pressed', 'true')
  // «До» — раннее фото, «после» — позднее
  expect(within(within(dialog).getByRole('group', { name: 'Фото до' })).getByRole('button', { name: /^До/ })).toHaveAttribute('aria-pressed', 'true')
  expect(within(within(dialog).getByRole('group', { name: 'Фото после' })).getByRole('button', { name: /^После/ })).toHaveAttribute('aria-pressed', 'true')

  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Скачать PNG' })).toBeEnabled())
  expect(sent).toContainEqual({ file: 7 })
  expect(sent).toContainEqual({ file: 8 })
  expect(ctx.drawImage).toHaveBeenCalled()
  expect(ctx.fillText).toHaveBeenCalledWith('ДО', expect.any(Number), expect.any(Number))
  expect(ctx.fillText).toHaveBeenCalledWith('ПОСЛЕ', expect.any(Number), expect.any(Number))
  expect(ctx.fillText).toHaveBeenCalledWith('Стоматология «Тест»', expect.any(Number), expect.any(Number))
  expect(ctx.fillText).toHaveBeenCalledWith('сделано в Tish', expect.any(Number), expect.any(Number))

  await userEvent.click(within(dialog).getByRole('combobox', { name: 'Процедура из услуг' }))
  await userEvent.click(await screen.findByRole('option', { name: 'Отбеливание' }))
  expect(within(dialog).getByLabelText('Процедура')).toHaveValue('Отбеливание')
  await waitFor(() => expect(ctx.fillText).toHaveBeenCalledWith('Отбеливание', expect.any(Number), expect.any(Number)))

  // Без подписи Tish — её больше не рисуют
  ;(ctx.fillText as ReturnType<typeof vi.fn>).mockClear()
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Подпись «сделано в Tish»' }))
  await waitFor(() => expect(ctx.fillText).toHaveBeenCalledWith('ДО', expect.any(Number), expect.any(Number)))
  expect(ctx.fillText).not.toHaveBeenCalledWith('сделано в Tish', expect.any(Number), expect.any(Number))

  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  await userEvent.click(within(dialog).getByRole('button', { name: 'Скачать PNG' }))
  expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png')
  expect(click).toHaveBeenCalled()
  const a = click.mock.contexts[0] as HTMLAnchorElement
  expect(a.download).toMatch(/^do-posle-\d{4}-\d{2}-\d{2}\.png$/)
  expect(within(dialog).getByRole('status')).toHaveTextContent('Картинка скачана')

  // Текст для поста: услуга, срок по датам фото, клиника с адресом и телефоном, ссылка на запись, хэштеги — без пациента
  const post = within(dialog).getByRole('region', { name: 'Текст для поста' })
  const text = within(post).getByLabelText<HTMLTextAreaElement>('Текст поста')
  expect(within(post).getByLabelText('Сколько заняло')).toHaveValue('4 недели')
  expect(text.value).toContain('Отбеливание — результат до и после.')
  expect(text.value).toContain('Сколько заняло: 4 недели.')
  expect(text.value).toContain('Адрес: Бишкек, ул. Вымышленная, 1')
  expect(text.value).toContain('Телефон: +996 555')
  expect(text.value).toContain('/c/test')
  expect(text.value).toContain('#стоматологБишкек #бишкек')
  expect(text.value).not.toMatch(/Вымышленная П|996700333444/)
  await userEvent.click(within(post).getByRole('button', { name: 'С эмодзи' }))
  expect(text.value).toContain('✨ Отбеливание — до и после')
  // Правка руками остаётся и уходит в буфер как есть
  await userEvent.type(text, ' Ждём вас!')
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  await userEvent.click(within(post).getByRole('button', { name: 'Скопировать текст' }))
  expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^✨ Отбеливание[\s\S]*Ждём вас!$/))
  expect(within(post).getByRole('status')).toHaveTextContent('Текст скопирован')

  await userEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }))
  expect(screen.queryByRole('dialog', { name: 'До / после' })).not.toBeInTheDocument()
})

test('геометрия: фото закрывает рамку, кадр не уезжает за край, прямоугольник из двух углов', () => {
  const f = frames({ format: 'post', layout: 'side', procedure: '' })
  expect(f.before.x + f.before.w).toBeLessThan(f.after.x)
  const img = { width: 800, height: 600 }
  const p = placement(f.before, img, FIT)
  expect(p.w).toBeGreaterThanOrEqual(f.before.w)
  expect(p.h).toBeGreaterThanOrEqual(f.before.h - 0.001)
  // Сдвинули далеко вправо — центр остановился у края, пустой полосы нет
  const c = clampCrop(f.before, img, { zoom: 1, cx: 5, cy: 0.5 })
  const q = placement(f.before, img, c)
  expect(q.x + q.w).toBeCloseTo(f.before.x + f.before.w)
  const b = boxFrom({ u: 0.6, v: 0.4 }, { u: 0.2, v: 1.3 })
  expect([b.x, b.y, b.w, b.h].map((n) => Math.round(n * 100) / 100)).toEqual([0.2, 0.4, 0.4, 0.6])
})

test('текст поста: три варианта, польза и хэштеги по услуге, без адреса — без пустых строк', () => {
  const input = { procedure: 'Реставрация 2 зубов', duration: '2 визита', doctor: 'Айгерим Садыкова', clinic: 'Стоматология «Тест»' }
  const short = buildPost('short', input)
  expect(short).toContain('Реставрация 2 зубов: до и после.')
  expect(short).toContain('Записаться — по телефону или в директ.')
  expect(short).not.toMatch(/\n{3,}/)
  expect(buildPost('full', input)).toContain('Работу выполнил(а) врач Айгерим Садыкова.')
  expect(buildPost('full', input)).not.toContain('Адрес:')
  expect(buildPost('emoji', input)).toContain('⏱ 2 визита')
  const tags = hashtags('Реставрация 2 зубов')
  expect(tags.length).toBeGreaterThanOrEqual(5)
  expect(tags.length).toBeLessThanOrEqual(8)
  expect(tags).toEqual(expect.arrayContaining(['#стоматологБишкек', '#бишкек', '#реставрациязубов']))
  expect(durationBetween('2026-10-01', '2026-10-01')).toBe('1 визит')
  expect(durationBetween('2026-10-01', '2026-10-04')).toBe('3 дня')
  expect(durationBetween('2026-01-01', '2026-06-01')).toBe('5 месяцев')
  expect(durationBetween(null, '2026-06-01')).toBe('')
})
