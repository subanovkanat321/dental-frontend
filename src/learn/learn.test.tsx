import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import type { ClinicPage } from '../site/web'
import { LearnSite } from '../site/LearnSite'
import { appointment, me, openItem, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'
import { lessonUrl, topicForService } from './catalog'
import { Presentation } from './Presentation'
import { fromSom, priceOf, stepPrice } from './prices'
import { TOPIC_LIST, topicBySlug } from './topics'

type Appointment = Schemas['AppointmentView']

/** Прайс вымышленной клиники: консультация по имплантации — не цена импланта. */
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

test('цена «от»: самая низкая процедура, без консультаций и выключенных услуг; шаг без цены — null', () => {
  expect(priceOf(PRICES, 'implant')).toBe(35000)
  expect(priceOf(PRICES, 'filling')).toBe(2500)
  expect(stepPrice(PRICES, [['extraction'], ['implant']])).toBe(36500)
  expect(stepPrice(PRICES, [['inlay', 'canals']])).toBe(6000)
  expect(stepPrice(PRICES, [['bone'], ['implant']])).toBeNull()
  expect(stepPrice(PRICES, [])).toBeNull()
  expect(fromSom(36500, 'ru')).toBe('от 36 500 сом')
  expect(fromSom(2500, 'ky')).toBe('2 500 сомдон баштап')
})

test('у каждой темы 4–6 слайдов, оба языка заполнены, последний слайд — с оговоркой', () => {
  expect(TOPIC_LIST).toHaveLength(10)
  for (const t of TOPIC_LIST) {
    expect(t.slides.length).toBeGreaterThanOrEqual(4)
    expect(t.slides.length).toBeLessThanOrEqual(6)
    for (const s of t.slides) {
      expect(s.title.ru && s.title.ky).toBeTruthy()
    }
  }
})

test('листание: кнопки, стрелки, Home/End, свайп; Esc закрывает; язык переключается', async () => {
  const onClose = vi.fn()
  const onLang = vi.fn()
  const { rerender } = render(<Presentation topic={topicBySlug('caries')!} lang="ru" onLang={onLang} onClose={onClose} />)
  expect(screen.getByRole('heading', { name: 'Кариес — это дырочка в зубе' })).toBeInTheDocument()
  expect(screen.getByText('1 / 6')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Назад' })).toBeDisabled()

  await userEvent.click(screen.getByRole('button', { name: 'Дальше' }))
  expect(screen.getByRole('heading', { name: 'Что будет, если не лечить' })).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  expect(screen.getByRole('heading', { name: 'Как лечим' })).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'ArrowLeft' })
  expect(screen.getByText('2 / 6')).toBeInTheDocument()

  // Свайп влево — следующий слайд; вертикальное движение — нет
  const stage = document.querySelector('.lsn-stage')!
  fireEvent.pointerDown(stage, { clientX: 300, clientY: 100 })
  fireEvent.pointerUp(stage, { clientX: 150, clientY: 110 })
  expect(screen.getByText('3 / 6')).toBeInTheDocument()
  fireEvent.pointerDown(stage, { clientX: 300, clientY: 100 })
  fireEvent.pointerUp(stage, { clientX: 260, clientY: 300 })
  expect(screen.getByText('3 / 6')).toBeInTheDocument()

  fireEvent.keyDown(window, { key: 'End' })
  expect(screen.getByText('6 / 6')).toBeInTheDocument()
  expect(screen.getByText('Это общая информация. Ваш план лечения — у вашего врача.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Дальше' })).toBeDisabled()
  fireEvent.keyDown(window, { key: 'Home' })
  expect(screen.getByText('1 / 6')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'KG' }))
  expect(onLang).toHaveBeenCalledWith('ky')
  rerender(<Presentation topic={topicBySlug('caries')!} lang="ky" onLang={onLang} onClose={onClose} />)
  expect(screen.getByRole('heading', { name: 'Кариес — бул тиштеги тешик' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Алга' })).toBeInTheDocument()

  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onClose).toHaveBeenCalled()
})

test('«Цена ожидания»: с ценами клиники — «от», чего нет в прайсе — «дороже»; без прайса — без чисел', () => {
  const { unmount } = render(<Presentation topic={topicBySlug('implant')!} lang="ru" services={PRICES} />)
  fireEvent.keyDown(window, { key: 'End' })
  const slide = screen.getByRole('heading', { name: 'Цена ожидания' }).closest('section')!
  expect(within(slide).getByText('от 35 000 сом')).toBeInTheDocument()
  // Наращивания кости в прайсе нет — шаг без числа
  expect(within(slide).getAllByText('дороже и дольше')).toHaveLength(2)
  expect(within(slide).queryByText(/500 сом/)).toBeNull()
  unmount()

  render(<Presentation topic={topicBySlug('caries')!} lang="ky" services={[]} />)
  fireEvent.keyDown(window, { key: 'End' })
  const empty = screen.getByRole('heading', { name: 'Күтүүнүн баасы' }).closest('section')!
  expect(within(empty).queryByText(/сом/)).toBeNull()
  expect(within(empty).getByText('Ар бир кийинки кадам — кымбатыраак жана узагыраак')).toBeInTheDocument()
})

/** Карточка приёма у врача; сервер презентаций: язык пациента. Отправку из CRM не зовём — проверяем. */
function backend(a: Appointment, target: Schemas['LessonsTarget'] | 403) {
  const sent: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, clinic: { ...me.clinic, code: 'abc123' } })),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? [a] : [])),
    http.get('*/api/service-types', () => HttpResponse.json(PRICES)),
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
  // Цены клиники — на кыргызском
  expect(within(dialog).getByText('6 000 сомдон баштап')).toBeInTheDocument()
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

test('«Настройки → Показать пациенту»: все темы обложками, открывается презентация', async () => {
  backend(appointment(34, 1, '12:00', 'Тест'), 403)
  openItem('learn')
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Показать пациенту' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Коронка/ }))
  expect(await screen.findByRole('dialog', { name: 'Коронка' })).toBeInTheDocument()
})

test('страница /learn/<тема> без входа: язык из ссылки, цены по коду клиники, «Записаться»', async () => {
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
  expect(screen.getByRole('heading', { name: 'Кариес — бул тиштеги тешик' })).toBeInTheDocument()
  expect(await screen.findByText(/Улыбка/)).toBeInTheDocument()
  expect(asked).toBe('?code=abc123')
  fireEvent.keyDown(window, { key: 'End' })
  expect(screen.getByText('2 500 сомдон баштап')).toBeInTheDocument()
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
