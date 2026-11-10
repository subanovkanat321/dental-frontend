import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { slotInstant } from '../lib/time'
import { AVATARS, colorOf } from '../lib/avatars'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { DOCTOR_ORDER_KEY, orderDoctors } from './doctorOrder'

/** Вымышленная клиника на троих; входит третий врач — Эрмек. */
const three: Schemas['BookingViewsMe'] = {
  ...me, doctorId: 3, fullName: 'Эрмек',
  doctors: [
    { id: 1, fullName: 'Айгерим Садыкова', active: true },
    { id: 2, fullName: 'Дастан Т.', active: true },
    { id: 3, fullName: 'Эрмек Н.', active: true },
  ],
}

function screenSize(phone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes(phone ? 'max-width' : 'min-width'), media: query, addEventListener() {}, removeEventListener() {}, onchange: null,
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

function backend(who: Schemas['BookingViewsMe'] = three) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    // У Айгерим (первая в клинике) — один вымышленный приём: у него полоска её цвета
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(
      new URL(request.url).searchParams.get('doctorId') === '1' ? [appointment(10, 1, '10:00', 'Бакыт М.')] : [])),
    http.get('*/api/appointments/counts', () => HttpResponse.json([])),
    // У каждого свободное окно: пустой день телефон показывает Тишкой, без колонок
    http.get('*/api/slots', ({ request }) => {
      const date = new URL(request.url).searchParams.get('date')!
      return HttpResponse.json({ workingDay: true, workStart: '09:00:00', workEnd: '18:00:00', breaks: [],
        free: [{ start: slotInstant(date, 23 * 60), end: slotInstant(date, 23 * 60 + 30) }] })
    }),
  )
}

/** Колонки «Все врачи» на телефоне — слева направо. */
const phoneColumns = () => [...document.querySelectorAll('section.doctor-day')].map((s) => s.getAttribute('aria-label'))
/** Колонки сетки дня на компьютере — слева направо. */
const gridColumns = () => [...document.querySelectorAll('.grid-col')].map((c) => c.getAttribute('aria-label'))

async function allDoctorsOnPhone() {
  await userEvent.click(await screen.findByRole('button', { name: /^Чьё расписание: Эрмек Н\. \(я\)/ }))
  await userEvent.click(within(screen.getByRole('listbox', { name: 'Чьё расписание' })).getByRole('option', { name: /Все врачи/ }))
  await screen.findByRole('region', { name: 'Эрмек Н.' })
}

test('телефон: третий врач входит — его колонка первая, в выборе врача он тоже первый', async () => {
  screenSize(true)
  backend()
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /^Чьё расписание: Эрмек Н\. \(я\)/ }))
  const options = within(screen.getByRole('listbox', { name: 'Чьё расписание' })).getAllByRole('option')
  expect(options.map((o) => o.querySelector('strong')?.textContent)).toEqual(['Эрмек Н. (я)', 'Айгерим Садыкова', 'Дастан Т.', 'Все врачи'])
  await userEvent.click(options[3]!)
  await screen.findByRole('region', { name: 'Эрмек Н.' })
  expect(phoneColumns()).toEqual(['Эрмек Н.', 'Айгерим Садыкова', 'Дастан Т.'])
  // Ничего не сохранили руками — в localStorage порядка нет
  expect(localStorage.getItem(DOCTOR_ORDER_KEY)).toBeNull()
})

test('телефон: «Врачи в расписании…» — ↑ ↓ и «Сохранить»: колонки в новом порядке, на устройстве только id', async () => {
  screenSize(true)
  backend()
  renderApp()
  await allDoctorsOnPhone()
  await userEvent.click(screen.getByRole('button', { name: /^Чьё расписание: Все врачи/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Врачи в расписании…' }))
  const dialog = screen.getByRole('dialog', { name: 'Врачи в расписании' })
  const names = () => within(dialog).getAllByRole('listitem').map((li) => li.querySelector('.doctor-order-name')?.textContent)
  expect(names()).toEqual(['Эрмек Н. (я)', 'Айгерим Садыкова', 'Дастан Т.'])
  expect(within(dialog).getByRole('button', { name: 'Выше: Эрмек Н.' })).toBeDisabled()
  expect(within(dialog).getByRole('button', { name: 'Ниже: Дастан Т.' })).toBeDisabled()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Выше: Дастан Т.' }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Выше: Дастан Т.' }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Ниже: Эрмек Н.' }))
  expect(names()).toEqual(['Дастан Т.', 'Айгерим Садыкова', 'Эрмек Н. (я)'])
  await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }))
  expect(screen.queryByRole('dialog', { name: 'Врачи в расписании' })).not.toBeInTheDocument()
  expect(phoneColumns()).toEqual(['Дастан Т.', 'Айгерим Садыкова', 'Эрмек Н.'])
  expect(JSON.parse(localStorage.getItem(DOCTOR_ORDER_KEY)!)).toEqual([2, 1, 3])
})

test('сохранённый порядок применяется при входе; «Отмена» ничего не меняет', async () => {
  screenSize(true)
  localStorage.setItem(DOCTOR_ORDER_KEY, JSON.stringify([2, 3, 1]))
  backend()
  renderApp()
  await allDoctorsOnPhone()
  expect(phoneColumns()).toEqual(['Дастан Т.', 'Эрмек Н.', 'Айгерим Садыкова'])
  await userEvent.click(screen.getByRole('button', { name: /^Чьё расписание: Все врачи/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Врачи в расписании…' }))
  const dialog = screen.getByRole('dialog', { name: 'Врачи в расписании' })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Выше: Эрмек Н.' }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
  expect(phoneColumns()).toEqual(['Дастан Т.', 'Эрмек Н.', 'Айгерим Садыкова'])
  expect(localStorage.getItem(DOCTOR_ORDER_KEY)).toBe('[2,3,1]')
})

test('новый врач, которого нет в сохранённом порядке, — в конце; удалённый из порядка пропускается', async () => {
  screenSize(true)
  // 9 — врача больше нет в клинике; 3 (Эрмек) в порядке нет — он «новый»
  localStorage.setItem(DOCTOR_ORDER_KEY, JSON.stringify([9, 2, 1]))
  backend()
  renderApp()
  await allDoctorsOnPhone()
  expect(phoneColumns()).toEqual(['Дастан Т.', 'Айгерим Садыкова', 'Эрмек Н.'])
})

test('«Как было» сбрасывает свой порядок: снова свой врач первым', async () => {
  screenSize(true)
  localStorage.setItem(DOCTOR_ORDER_KEY, JSON.stringify([1, 2, 3]))
  backend()
  renderApp()
  await allDoctorsOnPhone()
  expect(phoneColumns()).toEqual(['Айгерим Садыкова', 'Дастан Т.', 'Эрмек Н.'])
  await userEvent.click(screen.getByRole('button', { name: /^Чьё расписание: Все врачи/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Врачи в расписании…' }))
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Врачи в расписании' })).getByRole('button', { name: 'Как было' }))
  expect(screen.queryByRole('dialog', { name: 'Врачи в расписании' })).not.toBeInTheDocument()
  expect(phoneColumns()).toEqual(['Эрмек Н.', 'Айгерим Садыкова', 'Дастан Т.'])
  expect(localStorage.getItem(DOCTOR_ORDER_KEY)).toBeNull()
})

test('компьютер: сетка дня и чипы — в том же порядке; порядок меняется кнопкой ⇅ у чипов', async () => {
  screenSize(false)
  backend()
  renderApp()
  await screen.findByRole('group', { name: 'Эрмек Н.' })
  expect(gridColumns()).toEqual(['Эрмек Н.', 'Айгерим Садыкова', 'Дастан Т.'])
  const chips = screen.getByRole('group', { name: 'Чьё расписание' })
  expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['👥Все врачи', 'ЭНЭрмек Н. (я)', 'АСАйгерим Садыкова', 'ДТДастан Т.', '⇅'])
  // Цвет врача — по списку клиники, а не по месту: Айгерим (первая в клинике) — второй, но со своим цветом
  const aigerimColor = (within(chips).getByRole('button', { name: /Айгерим/ }).querySelector('.avatar') as HTMLElement).style.background

  await userEvent.click(within(chips).getByRole('button', { name: 'Врачи в расписании…' }))
  const dialog = screen.getByRole('dialog', { name: 'Врачи в расписании' })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Выше: Дастан Т.' }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }))
  expect(gridColumns()).toEqual(['Эрмек Н.', 'Дастан Т.', 'Айгерим Садыкова'])
  expect((within(chips).getByRole('button', { name: /Айгерим/ }).querySelector('.avatar') as HTMLElement).style.background).toBe(aigerimColor)
})

test('компьютер: сохранённый порядок — и в сетке дня', async () => {
  screenSize(false)
  localStorage.setItem(DOCTOR_ORDER_KEY, JSON.stringify([2, 1, 3]))
  backend()
  renderApp()
  await screen.findByRole('group', { name: 'Эрмек Н.' })
  expect(gridColumns()).toEqual(['Дастан Т.', 'Айгерим Садыкова', 'Эрмек Н.'])
})

test('orderDoctors: без своего врача и без порядка — как в клинике; мусор в localStorage не ломает', () => {
  const list = [{ id: 1 }, { id: 2 }, { id: 3 }]
  expect(orderDoctors(list, null, null).map((d) => d.id)).toEqual([1, 2, 3])
  expect(orderDoctors(list, null, 7).map((d) => d.id)).toEqual([1, 2, 3])
  expect(orderDoctors(list, null, 2).map((d) => d.id)).toEqual([2, 1, 3])
  expect(orderDoctors(list, [3], 2).map((d) => d.id)).toEqual([3, 1, 2])
})

test('битый порядок в localStorage — как без порядка', async () => {
  screenSize(false)
  localStorage.setItem(DOCTOR_ORDER_KEY, '{"oops"')
  backend()
  renderApp()
  await screen.findByRole('group', { name: 'Эрмек Н.' })
  expect(gridColumns()).toEqual(['Эрмек Н.', 'Айгерим Садыкова', 'Дастан Т.'])
})

test('colorOf: цвет по месту врача в списке клиники, неизвестный врач — первый цвет', () => {
  const list = [{ id: 5 }, { id: 7 }]
  expect(colorOf(list, 7)).toBe(AVATARS[1])
  expect(colorOf(list, 99)).toBe(AVATARS[0])
})

test('телефон: у врача свой цвет — кружок в шапке колонки и полоска у его записи; после смены порядка цвет тот же', async () => {
  screenSize(true)
  backend()
  renderApp()
  // Один врач: полоска цвета врача и в одиночном виде
  await userEvent.click(await screen.findByRole('button', { name: /^Чьё расписание: Эрмек Н\. \(я\)/ }))
  await userEvent.click(within(screen.getByRole('listbox', { name: 'Чьё расписание' })).getByRole('option', { name: /Айгерим Садыкова/ }))
  const single = (await screen.findByRole('button', { name: /10:00–10:30, Бакыт М\./ })).closest('li')!
  expect(single).toHaveClass('doc')
  expect(single.style.getPropertyValue('--doc')).toBe(AVATARS[0])

  await userEvent.click(screen.getByRole('button', { name: /^Чьё расписание: Айгерим Садыкова/ }))
  await userEvent.click(within(screen.getByRole('listbox', { name: 'Чьё расписание' })).getByRole('option', { name: /Все врачи/ }))
  const avatar = (name: string) => screen.getByRole('region', { name }).querySelector('.doctor-day-head .avatar') as HTMLElement
  const row = () => within(screen.getByRole('region', { name: 'Айгерим Садыкова' })).getByRole('button', { name: /10:00–10:30, Бакыт М\./ }).closest('li')!
  await screen.findByRole('region', { name: 'Эрмек Н.' })
  // Цвета — по списку клиники (Айгерим, Дастан, Эрмек), хотя Эрмек стоит первым
  const before = { aigerim: avatar('Айгерим Садыкова').style.background, ermek: avatar('Эрмек Н.').style.background }
  expect(before.aigerim).not.toBe(before.ermek)
  expect(row().style.getPropertyValue('--doc')).toBe(AVATARS[0])
  // Статус — по-прежнему классом s-… (заливка и слово); какой именно — зависит от времени дня
  expect(row().className).toMatch(/\bs-[a-z]+\b/)

  await userEvent.click(screen.getByRole('button', { name: /^Чьё расписание: Все врачи/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Врачи в расписании…' }))
  const dialog = screen.getByRole('dialog', { name: 'Врачи в расписании' })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Ниже: Эрмек Н.' }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Ниже: Эрмек Н.' }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }))
  expect(phoneColumns()).toEqual(['Айгерим Садыкова', 'Дастан Т.', 'Эрмек Н.'])
  expect(avatar('Айгерим Садыкова').style.background).toBe(before.aigerim)
  expect(avatar('Эрмек Н.').style.background).toBe(before.ermek)
  expect(row().style.getPropertyValue('--doc')).toBe(AVATARS[0])
})
