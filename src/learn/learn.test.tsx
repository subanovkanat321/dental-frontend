import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import type { ClinicPage } from '../site/web'
import { LearnSite } from '../site/LearnSite'
import { appointment, me, openItem, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'
import { readDeepLink } from '../lib/deepLink'
import { lessonUrl, topicForService } from './catalog'
import { placeCallouts } from './callouts'
import type { Art, Img3D, Video3D } from './media'
import { Presentation } from './Presentation'
import { SHOTS } from './shots.gen'
import { TOPIC_LIST, topicBySlug, type Topic } from './topics'

type Appointment = Schemas['AppointmentView']

/** Прайс вымышленной клиники: в презентациях цен нет — ни из CRM, ни на странице /learn. */
const PRICES: Schemas['ServiceTypeView'][] = [
  { id: 1, name: 'Лечение кариеса (пломба)', durationMinutes: 60, priceSom: 2500, active: true },
  { id: 2, name: 'Лечение каналов', durationMinutes: 90, priceSom: 6000, active: true },
  { id: 3, name: 'Удаление зуба', durationMinutes: 30, priceSom: 1500, active: true },
  { id: 4, name: 'Имплант', durationMinutes: 60, priceSom: 35000, active: true },
  { id: 5, name: 'Консультация по имплантации', durationMinutes: 30, priceSom: 500, active: true },
  { id: 6, name: 'Пломба (старая цена)', durationMinutes: 60, priceSom: 900, active: false },
]

afterEach(() => {
  window.history.replaceState(null, '', '/')
  localStorage.clear()
})

test('тема подбирается по услуге приёма; ссылка — без данных пациента', () => {
  expect(topicForService('Лечение кариеса')).toBe('caries')
  expect(topicForService('Пломба светоотверждаемая')).toBe('filling')
  expect(topicForService('Лечение каналов (1 канал)')).toBe('canals')
  expect(topicForService('Удаление зуба мудрости')).toBe('extraction')
  expect(topicForService('Профессиональная гигиена Air Flow')).toBe('hygiene')
  expect(topicForService('Коронка из циркония')).toBe('crown')
  expect(topicForService('Установка импланта')).toBe('implant')
  expect(topicForService('Отбеливание ZOOM')).toBe('whitening')
  expect(topicForService('Лечение пародонтита')).toBe('gums')
  // Узкое раньше общего: детская пломба — «Детские зубы», а не «Пломба»
  expect(topicForService('Детская пломба')).toBe('kids')
  expect(topicForService('Консультация')).toBeNull()
  expect(topicForService(null)).toBeNull()
  expect(lessonUrl('https://tish.kg', 'caries', 'abc123', 'ky')).toBe('https://tish.kg/learn/caries?c=abc123&lang=ky')
  expect(lessonUrl('', 'implant', null)).toBe('/learn/implant')
})

test('у каждой темы 4–5 слайдов: что это → … → что делать после; оба языка; ни цен, ни «Цены ожидания»', () => {
  expect(TOPIC_LIST).toHaveLength(10)
  for (const t of TOPIC_LIST) {
    expect(t.slides.length).toBeGreaterThanOrEqual(4)
    expect(t.slides.length).toBeLessThanOrEqual(5)
    expect(t.slides[0]!.kind).toBe('what')
    for (const s of t.slides) {
      expect(s.title.ru && s.title.ky).toBeTruthy()
    }
    // Все слайды по-русски и по-кыргызски: ни сомов, ни цен, ни маскота
    for (const lang of ['ru', 'ky'] as const) {
      const { unmount } = render(<Presentation topic={t} lang={lang} />)
      for (let i = 0; i < t.slides.length; i++) {
        const text = document.querySelector('.lsn-stage')!.textContent!
        expect(text).not.toMatch(/\d\s?сом|сомдон|Цена ожидания|Күтүүнүн баасы|Тишка/i)
        fireEvent.keyDown(window, { key: 'ArrowRight' })
      }
      expect(screen.getByText(lang === 'ru' ? 'Это общая информация. Ваш план лечения — у вашего врача.' : 'Бул жалпы маалымат. Сиздин дарылоо планыңыз — дарыгериңизде.')).toBeInTheDocument()
      unmount()
    }
  }
})

test('листание: кнопки, стрелки, Home/End, свайп; Esc закрывает; язык переключается', async () => {
  const onClose = vi.fn()
  const onLang = vi.fn()
  const { rerender } = render(<Presentation topic={topicBySlug('caries')!} lang="ru" onLang={onLang} onClose={onClose} />)
  expect(screen.getByRole('heading', { name: 'Кариес — это полость (дырка) в зубе' })).toBeInTheDocument()
  expect(screen.getByText('1 / 5')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Назад' })).toBeDisabled()

  await userEvent.click(screen.getByRole('button', { name: 'Дальше' }))
  expect(screen.getByRole('heading', { name: 'Почему лучше не откладывать' })).toBeInTheDocument()
  expect(screen.getByText(/Чем раньше начать, тем проще лечение/)).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  expect(screen.getByRole('heading', { name: 'Как проходит лечение' })).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'ArrowLeft' })
  expect(screen.getByText('2 / 5')).toBeInTheDocument()

  // Свайп влево — следующий слайд; вертикальное движение — нет
  const stage = document.querySelector('.lsn-stage')!
  fireEvent.pointerDown(stage, { clientX: 300, clientY: 100 })
  fireEvent.pointerUp(stage, { clientX: 150, clientY: 110 })
  expect(screen.getByText('3 / 5')).toBeInTheDocument()
  fireEvent.pointerDown(stage, { clientX: 300, clientY: 100 })
  fireEvent.pointerUp(stage, { clientX: 260, clientY: 300 })
  expect(screen.getByText('3 / 5')).toBeInTheDocument()

  fireEvent.keyDown(window, { key: 'End' })
  expect(screen.getByText('5 / 5')).toBeInTheDocument()
  expect(screen.getByText('Это общая информация. Ваш план лечения — у вашего врача.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Дальше' })).toBeDisabled()
  fireEvent.keyDown(window, { key: 'Home' })
  expect(screen.getByText('1 / 5')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'KG' }))
  expect(onLang).toHaveBeenCalledWith('ky')
  rerender(<Presentation topic={topicBySlug('caries')!} lang="ky" onLang={onLang} onClose={onClose} />)
  expect(screen.getByRole('heading', { name: 'Кариес — бул тиштеги көңдөй (тешик)' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Алга' })).toBeInTheDocument()

  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onClose).toHaveBeenCalled()
})

test('фото в темах — только со свободной лицензией, автором и ссылкой на источник', () => {
  const photos = TOPIC_LIST.flatMap((t) => t.slides.flatMap((s) => (s.photo ? [s.photo] : [])))
  expect(photos.length).toBeGreaterThanOrEqual(5)
  for (const p of photos) {
    expect(p.credit.license).toMatch(/^(CC0|Public domain|CC BY(-SA)? \d\.\d)$/)
    expect(p.credit.author).toBeTruthy()
    expect(p.credit.url).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/)
    expect(p.alt.ru && p.alt.ky).toBeTruthy()
  }
})

test('фото к слайду: вместо рисунка, с подписью «автор, лицензия, источник» и ссылкой; без фото — рисунок', () => {
  const caries = topicBySlug('caries')!
  const [what, ...rest] = caries.slides
  const withPhoto: Topic = { ...caries, slides: [{ ...what!, photo: {
    src: '/photos/caries.jpg', alt: { ru: 'Кариес на снимке', ky: 'Сүрөттөгү кариес' },
    credit: { author: 'A. Author', license: 'CC BY-SA 4.0', source: 'Wikimedia Commons', url: 'https://commons.wikimedia.org/wiki/File:Example.jpg' },
  } }, ...rest] }
  const { unmount } = render(<Presentation topic={withPhoto} lang="ru" />)
  const slide = screen.getByRole('heading', { name: 'Кариес — это полость (дырка) в зубе' }).closest('section')!
  expect(within(slide).getByRole('img', { name: 'Кариес на снимке' })).toHaveAttribute('src', '/photos/caries.jpg')
  expect(within(slide).getByRole('link', { name: 'Фото: A. Author, CC BY-SA 4.0, Wikimedia Commons' }))
    .toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:Example.jpg')
  expect(within(slide).queryByRole('img', { name: 'Зуб с кариесом в разрезе' })).toBeNull()
  unmount()

  render(<Presentation topic={caries} lang="ky" />)
  const plain = screen.getByRole('heading', { name: 'Кариес — бул тиштеги көңдөй (тешик)' }).closest('section')!
  expect(within(plain).getByRole('img', { name: 'Тиш кесилишинде: кариес эмалдан өтүп, дентинге жетти' })).toBeInTheDocument()
  expect(within(plain).queryByText(/Сүрөт:/)).toBeNull()
})

/** Все кадры и ролики 3D из тем (слайды, карточки стадий, обложки). */
function allMedia(): (Img3D | Video3D)[] {
  const arts: (Art | undefined)[] = TOPIC_LIST.flatMap((t) => [t.cover, ...t.slides.flatMap((s) => [s.kind === 'stages' ? undefined : s.art, ...(s.kind === 'what' ? [] : s.points.map((p) => p.art))])])
  return arts.filter((a): a is Img3D | Video3D => a != null && typeof a !== 'function')
}

test('3D-кадры и ролики: файлы лежат в public/content/learn, у каждого — запасной SVG, подписи — на точках кадра', () => {
  const media = allMedia()
  expect(media.filter((m) => 'img' in m).length).toBeGreaterThanOrEqual(15)
  expect(new Set(media.flatMap((m) => ('video' in m ? [m.video] : [])))).toEqual(new Set(['filling-clip', 'canals-clip', 'crown-clip', 'implant-clip']))
  const dir = resolve(import.meta.dirname, '../../public/content/learn')
  for (const m of media) {
    expect(m.alt.ru && m.alt.ky).toBeTruthy()
    expect(typeof m.svg).toBe('function')
    const files = 'img' in m ? [`${m.img}-640.webp`, `${m.img}-1280.webp`] : [`${m.video}.webm`, `${m.video}.mp4`, `${m.video}-poster.webp`]
    for (const f of files) expect(existsSync(resolve(dir, f)), f).toBe(true)
    if ('img' in m) {
      const at = SHOTS[m.img].at as Record<string, unknown>
      for (const l of m.labels ?? []) expect(at[{ root: 'cementum', canals: 'canal' }[l as string] ?? l], `${m.img}: ${l}`).toBeDefined()
    }
  }
})

test('слайд с 3D-кадром: <img> 640/1280 с подписью на ru и ky, выноски частей поверх; файл не загрузился — SVG', () => {
  const { unmount } = render(<Presentation topic={topicBySlug('canals')!} lang="ky" />)
  let slide = screen.getByRole('heading', { name: 'Пульпит — тиштин нервинин сезгениши' }).closest('section')!
  const ky = within(slide).getByRole('img', { name: 'Тиш кесилишинде: кариес пульпага жетти, нерв сезгенген' })
  expect(ky).toHaveAttribute('src', '/content/learn/caries-4-640.webp')
  expect(ky.getAttribute('srcset')).toContain('/content/learn/caries-4-1280.webp 1280w')
  expect(ky).toHaveAttribute('loading', 'lazy')
  expect([...slide.querySelectorAll('.lsn-callout')].map((c) => c.textContent).sort()).toEqual(['Каналдар', 'Кариес', 'Пульпа (нерв)', 'Тамыр', 'Эмаль'])
  unmount()

  render(<Presentation topic={topicBySlug('caries')!} lang="ru" />)
  slide = screen.getByRole('heading', { name: 'Кариес — это полость (дырка) в зубе' }).closest('section')!
  const ru = within(slide).getByRole('img', { name: 'Зуб в разрезе: кариес прошёл эмаль и дошёл до дентина' })
  expect(ru).toHaveAttribute('src', '/content/learn/caries-3-640.webp')
  expect([...slide.querySelectorAll('.lsn-callout')].map((c) => c.textContent).sort()).toEqual(['Дентин', 'Кариес', 'Пульпа (нерв)', 'Эмаль'])
  // Нет файла (или сеть) — прежний рисунок
  fireEvent.error(ru)
  expect(within(slide).getByRole('img', { name: 'Зуб с кариесом в разрезе' })).toBeInTheDocument()
  expect(within(slide).queryByText('Пульпа (нерв)')).toBeInTheDocument()
  expect(slide.querySelector('img')).toBeNull()

  // Стадии — 3D крупно в карточках
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  const cards = document.querySelectorAll('.lsn-card img')
  expect([...cards].map((i) => i.getAttribute('src'))).toEqual([1, 2, 3, 4].map((n) => `/content/learn/caries-${n}-close-640.webp`))
})

test('слайд с роликом: <video> без звука, по кругу, с постером; ролик не загрузился — SVG; «меньше движения» — только постер', () => {
  const { unmount } = render(<Presentation topic={topicBySlug('caries')!} lang="ru" />)
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  let slide = screen.getByRole('heading', { name: 'Как проходит лечение' }).closest('section')!
  const video = slide.querySelector('video')!
  expect(video).toHaveAttribute('poster', '/content/learn/filling-clip-poster.webp')
  expect(video).toHaveAttribute('autoplay')
  expect(video).toHaveAttribute('loop')
  expect(video).toHaveAttribute('playsinline')
  expect(video).toHaveAttribute('preload', 'metadata')
  expect(video.muted).toBe(true)
  expect(video).toHaveAccessibleName('Как ставят пломбу: полость заполняют слоями и отверждают лампой')
  const sources = [...video.querySelectorAll('source')]
  expect(sources.map((s) => s.getAttribute('src'))).toEqual(['/content/learn/filling-clip.webm', '/content/learn/filling-clip.mp4'])
  fireEvent.error(sources[1]!)
  expect(within(slide).getByRole('img', { name: 'Зуб с пломбой' })).toBeInTheDocument()
  expect(slide.querySelector('video')).toBeNull()
  unmount()

  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)', addEventListener() {}, removeEventListener() {} }))
  try {
    render(<Presentation topic={topicBySlug('implant')!} lang="ky" />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    slide = screen.getByRole('heading', { name: 'Дарылоо кантип өтөт' }).closest('section')!
    expect(slide.querySelector('video')).toBeNull()
    expect(within(slide).getByRole('img', { name: 'Имплант кантип коюлат: винтти сөөккө буроп, үстүнө таяныч жана коронка коюшат' }))
      .toHaveAttribute('src', '/content/learn/implant-clip-poster.webp')
  } finally {
    vi.unstubAllGlobals()
  }
})

test('выноски: колонка ближнего края, близкие по высоте раздвигаются и не уходят за край', () => {
  const placed = placeCallouts([
    { key: 'enamel', x: 0.7, y: 0.30 }, { key: 'dentin', x: 0.6, y: 0.32 }, { key: 'pulp', x: 0.55, y: 0.33 },
    { key: 'gum', x: 0.2, y: 0.97 }, { key: 'bone', x: 0.1, y: 0.96 },
  ])
  for (const side of ['l', 'r'] as const) {
    const ys = placed.filter((p) => p.side === side).map((p) => p.ly).sort((a, b) => a - b)
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(0.085 - 1e-9)
    for (const y of ys) expect(y).toBeLessThanOrEqual(0.95 + 1e-9)
  }
  expect(placed.find((p) => p.key === 'gum')!.side).toBe('l')
  expect(placed.find((p) => p.key === 'enamel')!.side).toBe('r')
})

/** Карточка приёма у врача; сервер презентаций: язык пациента. Отправку из CRM не зовём — проверяем. */
function backend(a: Appointment, target: Schemas['LessonsTarget'] | 403) {
  const sent: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, clinic: { ...me.clinic, code: 'abc123' } })),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? [a] : [])),
    http.get('*/api/patients/:id/lessons', () => (target === 403
      ? HttpResponse.json({ status: 403, title: 'Forbidden', detail: 'Медкарту видят врачи пациента' }, { status: 403 })
      : HttpResponse.json(target))),
    http.post('*/api/patients/:id/lessons/:topic/send', ({ params }) => {
      sent.push(`${params.id}:${params.topic}`)
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return sent
}

async function openCard(name: RegExp) {
  await userEvent.click(await screen.findByRole('button', { name }))
  return screen.getByRole('complementary', { name: 'Карточка приёма' })
}

test('карточка приёма: 📖 в шапке — тема по услуге, на языке пациента; только показ, без отправки', async () => {
  const sent = backend(appointment(31, 1, '10:00', 'Нурлан Т.', { serviceName: 'Лечение каналов' }), { telegram: true, lang: 'KY' })
  renderApp()
  const panel = await openCard(/Нурлан Т\./)
  // В ленте карточки презентации нет — только значок в шапке
  expect(within(panel).queryByRole('group', { name: 'Показать пациенту' })).toBeNull()
  await userEvent.click(within(panel).getByRole('button', { name: 'Показать пациенту' }))
  const line = within(panel).getByRole('group', { name: 'Показать пациенту' })
  expect(within(line).getByRole('combobox', { name: 'Тема презентации' })).toHaveTextContent('Пульпит и лечение каналов')
  await userEvent.click(within(line).getByRole('button', { name: 'Показать' }))
  const dialog = await screen.findByRole('dialog', { name: 'Пульпит жана каналдарды дарылоо' })
  expect(within(dialog).getByRole('heading', { name: 'Пульпит — тиштин нервинин сезгениши' })).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'End' })
  // Цен в презентации нет
  expect(within(dialog).queryByText(/сом/)).toBeNull()
  // Отправлять из CRM нечего: отчёт о приёме и так уходит пациенту
  expect(within(dialog).queryByRole('button', { name: /Отправить|Скопировать|WhatsApp|Telegram/ })).toBeNull()
  expect(sent).toEqual([])
  // Имени пациента в презентации нет
  expect(within(dialog).queryByText(/Нурлан/)).toBeNull()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Жабуу' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('другая тема из списка: услуга не подсказала — «Показать» ждёт выбора; ✕ — закрыть строку', async () => {
  backend(appointment(32, 1, '11:00', 'Айжан К.', { serviceName: 'Консультация' }), { telegram: true, lang: 'RU' })
  renderApp()
  const panel = await openCard(/Айжан К\./)
  await userEvent.click(within(panel).getByRole('button', { name: 'Показать пациенту' }))
  const line = within(panel).getByRole('group', { name: 'Показать пациенту' })
  expect(within(line).getByRole('button', { name: 'Показать' })).toBeDisabled()
  await choose(within(line).getByRole('combobox', { name: 'Тема презентации' }), 'Имплант')
  await userEvent.click(within(line).getByRole('button', { name: 'Показать' }))
  expect(await screen.findByRole('dialog', { name: 'Имплант' })).toBeInTheDocument()
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Закрыть' }))
  await userEvent.click(within(line).getByRole('button', { name: 'Закрыть выбор темы' }))
  expect(within(panel).queryByRole('group', { name: 'Показать пациенту' })).toBeNull()
})

test('без доступа к медкарте (403) — презентация по-русски', async () => {
  backend(appointment(33, 1, '12:00', 'Бакыт С.', { serviceName: 'Удаление зуба' }), 403)
  renderApp()
  const panel = await openCard(/Бакыт С\./)
  await userEvent.click(within(panel).getByRole('button', { name: 'Показать пациенту' }))
  await userEvent.click(within(panel).getByRole('button', { name: 'Показать' }))
  expect(await screen.findByRole('dialog', { name: 'Удаление зуба и зуб мудрости' })).toBeInTheDocument()
})

test('раздел «Для пациента» — сразу после «Пациентов» у врача, ассистента, регистратуры и админа; у команды Tish — нет', async () => {
  const roles: Schemas['BookingViewsMe'][] = [
    me,
    { ...me, admin: false },
    { ...me, admin: false, assistantOf: [1], doctorId: undefined },
    { ...me, admin: false, reception: true, doctorId: undefined },
  ]
  for (const who of roles) {
    server.use(http.get('*/api/patient/me', () => HttpResponse.json(who)), http.get('*/api/appointments', () => HttpResponse.json([])))
    const { unmount } = renderApp()
    const nav = await screen.findByRole('navigation', { name: 'Разделы' })
    const names = within(nav).getAllByRole('button').filter((b) => b.dataset.section).map((b) => b.textContent?.trim())
    expect(names.indexOf('Для пациента')).toBe(names.indexOf('Пациенты') + 1)
    // Старой кнопки «3D-атлас» под меню больше нет
    expect(screen.queryByRole('button', { name: '3D-атлас' })).toBeNull()
    unmount()
  }
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ doctor: false, platform: true, owner: true, fullName: 'Команда' })))
  const { unmount } = renderApp()
  const nav = await screen.findByRole('navigation', { name: 'Разделы' })
  expect(within(nav).queryByRole('button', { name: 'Для пациента' })).toBeNull()
  unmount()
})

test('«Для пациента»: 3D-атлас во весь экран и закрыть; все темы обложками — «Показать» открывает презентацию', async () => {
  backend(appointment(34, 1, '12:00', 'Тест'), 403)
  renderApp()
  const nav = await screen.findByRole('navigation', { name: 'Разделы' })
  await userEvent.click(within(nav).getByRole('button', { name: 'Для пациента' }))
  expect(await screen.findByRole('heading', { name: 'Для пациента' })).toBeInTheDocument()
  expect(window.location.hash).toBe('#/learn')
  expect(document.querySelectorAll('.learn-tile')).toHaveLength(TOPIC_LIST.length)

  await userEvent.click(screen.getByRole('button', { name: /3D-атлас/ }))
  // В тестах WebGL нет — атлас показывает схему; закрыли — снова раздел
  await userEvent.click(await screen.findByRole('button', { name: 'Закрыть' }))
  expect(document.querySelector('.atlas-page')).toBeNull()

  await userEvent.click(screen.getByRole('button', { name: /Коронка/ }))
  expect(await screen.findByRole('dialog', { name: 'Коронка' })).toBeInTheDocument()
})

test('старый адрес «Настройки → Показать пациенту» (#/settings/learn) и ?screen=learn ведут в раздел «Для пациента»', async () => {
  backend(appointment(34, 1, '12:00', 'Тест'), 403)
  openItem('learn')
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Для пациента' })).toBeInTheDocument()
  expect(window.location.hash).toBe('#/learn')
  expect(readDeepLink('?screen=learn')).toEqual({ page: 'learn' })
})

test('пункт «Настроек» «Для пациента» — ссылка на раздел (на телефоне его нет в нижнем меню)', async () => {
  backend(appointment(34, 1, '12:00', 'Тест'), 403)
  window.location.hash = '/settings'
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Для пациента.*3D-атлас и презентации/ }))
  expect(await screen.findByRole('heading', { name: 'Для пациента' })).toBeInTheDocument()
})

test('страница /learn/<тема> без входа: язык из ссылки, название клиники по коду, «Записаться», без цен', async () => {
  window.history.replaceState(null, '', '/learn/caries?c=abc123&lang=ky')
  let asked = ''
  server.use(http.get('*/web/clinic', ({ request }) => {
    asked = new URL(request.url).search
    return HttpResponse.json({
      name: 'Улыбка', doctors: [], services: PRICES.filter((s) => s.active).map((s) => ({ name: s.name!, durationMinutes: 30, priceSom: s.priceSom })),
      bookingUrl: '/c/abc123#book',
    } satisfies ClinicPage)
  }))
  render(<LearnSite />)
  expect(screen.getByRole('heading', { name: 'Кариес — бул тиштеги көңдөй (тешик)' })).toBeInTheDocument()
  expect(await screen.findByText(/Улыбка/)).toBeInTheDocument()
  expect(asked).toBe('?code=abc123')
  fireEvent.keyDown(window, { key: 'End' })
  // Прайс клиники пришёл, но в презентации его нет
  expect(screen.queryByText(/сом/)).toBeNull()
  expect(screen.getByRole('link', { name: '📅 Жазылуу' })).toHaveAttribute('href', '/c/abc123#book')
  expect(screen.getByRole('link', { name: '📚 Бардык темалар' })).toHaveAttribute('href', '/learn?c=abc123&lang=ky')
})

test('/learn — список тем; ссылки сохраняют код клиники', () => {
  window.history.replaceState(null, '', '/learn?c=abc123')
  render(<LearnSite />)
  expect(screen.getByRole('heading', { name: 'Коротко о лечении зубов' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Имплант/ })).toHaveAttribute('href', '/learn/implant?c=abc123')
  expect(screen.getAllByRole('link')).toHaveLength(10)
})
