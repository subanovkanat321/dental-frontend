import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, openMedicalTab } from '../test/fixtures'
import { server } from '../test/server'
import { boxFrom, clampCrop, FIT, fitSmiles, frames, placement } from './beforeAfterDraw'
import { buildPost, durationBetween, hashtags } from './postText'

/** Вымышленный пациент и два «фото» — байты-заглушки, картинку подменяет createImageBitmap. */
const FILES: Schemas['PatientFilesView'][] = [
  { id: 8, kind: 'PHOTO', caption: 'После', takenOn: '2026-10-30', canDelete: true },
  { id: 7, kind: 'PHOTO', caption: 'До', takenOn: '2026-10-01', canDelete: true },
]

function backend(consent: Schemas['PublicationConsentsView'] = {}, files = FILES, postAi = false) {
  let current = consent
  const sent: unknown[] = []
  server.use(
    http.get('*/api/clinic/post-ai', () => HttpResponse.json({ available: true, on: postAi })),
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
    http.put('*/api/patients/2/files/:id/post-text', async ({ request, params }) => {
      sent.push({ postText: Number(params.id), text: ((await request.json()) as { text: string }).text })
      return HttpResponse.json({ id: Number(params.id) })
    }),
    http.post('*/api/patients/2/files', async ({ request }) => {
      const form = await request.formData()
      sent.push({ saved: form.get('caption'), kind: form.get('kind'), hasText: Boolean(form.get('postText')) })
      return HttpResponse.json({ id: 99, kind: 'OTHER', caption: form.get('caption') }, { status: 201 })
    }),
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
  await openMedicalTab()
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
  // Копия — в «Снимки и фото» пациента: вышли из приложения и вернулись — собирать заново не нужно
  await waitFor(() => expect(sent).toContainEqual({ saved: 'До / после · Instagram', kind: 'OTHER', hasText: true }))
  await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('сохранено в «Снимки и фото»'))
  // Та же картинка второй раз не сохраняется
  await userEvent.click(within(dialog).getByRole('button', { name: 'Скачать PNG' }))
  expect(sent.filter((x) => typeof x === 'object' && x !== null && 'saved' in x)).toHaveLength(1)

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
  // Поправленный текст — и у сохранённой картинки (её id вернул сервер при сохранении)
  await waitFor(() => expect(sent).toContainEqual({ postText: 99, text: expect.stringMatching(/Ждём вас!$/) }))

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

test('без «ИИ для постов» кнопок ИИ нет — шаблоны как раньше; подпись «ИИ не меняет фото»', async () => {
  fakeCanvas()
  backend({ scope: 'WITH_FACE', givenAt: '2026-11-03T05:00:00Z' })
  await openMedical()
  expect(await screen.findByText(/ИИ не меняет фото — только подбирает кадр и пишет текст/)).toBeInTheDocument()
  await userEvent.click(await screen.findByRole('button', { name: 'Собрать картинку «до / после»' }))
  const dialog = await screen.findByRole('dialog', { name: 'До / после' })
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Скачать PNG' })).toBeEnabled())
  expect(within(dialog).queryByRole('button', { name: /Написать с ИИ/ })).not.toBeInTheDocument()
  expect(within(dialog).queryByRole('button', { name: /Подогнать кадр/ })).not.toBeInTheDocument()
  expect(within(dialog).getByLabelText<HTMLTextAreaElement>('Текст поста').value).toContain('результат до и после')
})

test('ИИ: «Написать с ИИ» ставит текст в поле, «Другой вариант» шлёт прошлый; ошибка — понятным текстом', async () => {
  fakeCanvas()
  const sent = backend({ scope: 'WITH_FACE', givenAt: '2026-11-03T05:00:00Z' }, FILES, true)
  const bodies: Schemas['BeforeAfterAiTextRequest'][] = []
  let fail = false
  server.use(http.post('*/api/patients/2/before-after/ai-text', async ({ request }) => {
    const body = (await request.json()) as Schemas['BeforeAfterAiTextRequest']
    bodies.push(body)
    if (fail) {
      return HttpResponse.json({ status: 409, code: 'ai-unavailable', detail: 'ИИ не написал текст — возьмите шаблон или попробуйте ещё раз' },
        { status: 409, headers: { 'Content-Type': 'application/problem+json' } })
    }
    return HttpResponse.json({ text: `Вариант ${bodies.length} от ИИ\n\n#доипосле` } satisfies Schemas['BeforeAfterAiPostText'])
  }))
  await openMedical()
  await userEvent.click(await screen.findByRole('button', { name: 'Собрать картинку «до / после»' }))
  const dialog = await screen.findByRole('dialog', { name: 'До / после' })
  const post = within(dialog).getByRole('region', { name: 'Текст для поста' })
  // Без процедуры ИИ писать не о чем
  expect(await within(post).findByRole('button', { name: '✨ Написать с ИИ' })).toBeDisabled()
  await userEvent.type(within(dialog).getByLabelText('Процедура'), 'Отбеливание')
  await userEvent.click(within(post).getByRole('button', { name: 'Кыргызча' }))
  await userEvent.click(within(post).getByRole('button', { name: 'С эмодзи' }))
  await userEvent.click(within(post).getByRole('button', { name: '✨ Написать с ИИ' }))
  const text = within(post).getByLabelText<HTMLTextAreaElement>('Текст поста')
  await waitFor(() => expect(text.value).toBe('Вариант 1 от ИИ\n\n#доипосле'))
  expect(bodies[0]).toMatchObject({ procedure: 'Отбеливание', duration: '4 недели', style: 'EMOJI', lang: 'KY', bookingUrl: expect.stringMatching(/\/c\/test$/) })
  expect(bodies[0]!.previous).toBeUndefined()
  // Ни имени, ни телефона пациента в запросе
  expect(JSON.stringify(bodies[0])).not.toMatch(/Вымышленная П|996700333444/)
  expect(within(post).getByText(/Текст написал ИИ — проверьте/)).toBeInTheDocument()

  await userEvent.click(within(post).getByRole('button', { name: '✨ Другой вариант' }))
  await waitFor(() => expect(text.value).toBe('Вариант 2 от ИИ\n\n#доипосле'))
  expect(bodies[1]!.previous).toBe('Вариант 1 от ИИ\n\n#доипосле')

  fail = true
  await userEvent.click(within(post).getByRole('button', { name: '✨ Другой вариант' }))
  expect(await within(post).findByRole('alert')).toHaveTextContent('ИИ не написал текст — возьмите шаблон')
  // Текст в поле не пропал
  expect(text.value).toBe('Вариант 2 от ИИ\n\n#доипосле')
  expect(sent).toContainEqual({ file: 7 })
})

test('ИИ: «Подогнать кадр» шлёт номера фото и меняет кадр; не вышло — понятный текст', async () => {
  const { ctx } = fakeCanvas()
  backend({ scope: 'NO_FACE', givenAt: '2026-11-03T05:00:00Z' }, FILES, true)
  const asked: Schemas['BeforeAfterAiFrameRequest'][] = []
  let ok = true
  server.use(http.post('*/api/patients/2/before-after/ai-frame', async ({ request }) => {
    asked.push((await request.json()) as Schemas['BeforeAfterAiFrameRequest'])
    if (!ok) {
      return HttpResponse.json({ status: 409, code: 'ai-unavailable', detail: 'Не удалось подогнать кадр — подвиньте его вручную' },
        { status: 409, headers: { 'Content-Type': 'application/problem+json' } })
    }
    return HttpResponse.json({ before: { x: 0.4, y: 0.6, w: 0.2, h: 0.1 }, after: { x: 0.3, y: 0.5, w: 0.3, h: 0.15 } } satisfies Schemas['BeforeAfterAiFrames'])
  }))
  await openMedical()
  await userEvent.click(await screen.findByRole('button', { name: 'Собрать картинку «до / после»' }))
  const dialog = await screen.findByRole('dialog', { name: 'До / после' })
  await waitFor(() => expect(within(dialog).getByRole('button', { name: '✨ Подогнать кадр' })).toBeEnabled())
  const zoomBefore = within(dialog).getByRole('slider', { name: 'Масштаб фото до' })
  expect(zoomBefore).toHaveValue('1')
  ;(ctx.drawImage as ReturnType<typeof vi.fn>).mockClear()
  await userEvent.click(within(dialog).getByRole('button', { name: '✨ Подогнать кадр' }))
  await waitFor(() => expect(Number((zoomBefore as HTMLInputElement).value)).toBeGreaterThan(1))
  expect(asked).toEqual([{ beforeFileId: 7, afterFileId: 8 }])
  // Улыбка «до» меньше — её увеличили сильнее
  const zoomAfter = within(dialog).getByRole('slider', { name: 'Масштаб фото после' })
  expect(Number((zoomBefore as HTMLInputElement).value)).toBeGreaterThan(Number((zoomAfter as HTMLInputElement).value))
  expect(within(dialog).getByRole('status')).toHaveTextContent('Кадр подогнан')
  expect(ctx.drawImage).toHaveBeenCalled()

  ok = false
  await userEvent.click(within(dialog).getByRole('button', { name: '✨ Подогнать кадр' }))
  await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('Не удалось подогнать кадр — подвиньте его вручную'))
})

test('подгонка: улыбки разного размера — одного размера и в центре рамки', () => {
  const f = frames({ format: 'post', layout: 'side', procedure: '' })
  const before = { frame: f.before, image: { width: 800, height: 600 }, smile: { x: 0.4, y: 0.45, w: 0.2, h: 0.1 } }
  const after = { frame: f.after, image: { width: 600, height: 800 }, smile: { x: 0.3, y: 0.5, w: 0.4, h: 0.12 } }
  const [cb, ca] = fitSmiles([before, after])
  const width = (s: typeof before, c: typeof cb) => s.smile.w * placement(s.frame, s.image, c).w
  expect(width(before, cb)).toBeCloseTo(width(after, ca), 0)
  expect(width(before, cb) / f.before.w).toBeCloseTo(0.7, 1)
  // Центр улыбки — в центре рамки
  const center = (s: typeof before, c: typeof cb) => {
    const p = placement(s.frame, s.image, c)
    return [p.x + (s.smile.x + s.smile.w / 2) * p.w - s.frame.x, p.y + (s.smile.y + s.smile.h / 2) * p.h - s.frame.y]
  }
  expect(center(before, cb)[0]).toBeCloseTo(f.before.w / 2, 0)
  expect(center(after, ca)[1]).toBeCloseTo(f.after.h / 2, 0)
  // Улыбка во весь снимок — масштаб 1, не меньше
  const [whole] = fitSmiles([{ ...before, smile: { x: 0, y: 0, w: 1, h: 1 } }, after])
  expect(whole.zoom).toBe(1)
})

test('готовая «до / после» в «Снимках и фото»: шаг 3 отмечен, исходными фото она не считается', async () => {
  const made: Schemas['PatientFilesView'] = { id: 9, kind: 'OTHER', caption: 'До / после · Instagram', takenOn: '2026-11-04', canDelete: true,
    postText: 'Отбеливание — до и после. #бишкек' }
  backend({ scope: 'WITH_FACE', givenAt: '2026-11-03T05:00:00Z' }, [FILES[0]!, made])
  await openMedical()
  // Одно настоящее фото + готовая картинка — для новой картинки фото всё ещё мало
  expect(await screen.findByRole('button', { name: 'Собрать картинку «до / после»' })).toHaveAccessibleDescription('Нужно хотя бы два фото: «до» и «после».')
  expect(screen.getByText(/готово: 1 — в «Снимках и фото»/)).toBeInTheDocument()
  // Текст поста сохранён вместе с картинкой — скопировать одной кнопкой
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  await userEvent.click(screen.getByRole('button', { name: '📋 Текст поста' }))
  expect(writeText).toHaveBeenCalledWith('Отбеливание — до и после. #бишкек')
  expect(await screen.findByText('скопирован')).toBeInTheDocument()
})
