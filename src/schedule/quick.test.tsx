import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, meArrivals, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'
import { LONG_MS, swipeClock } from './useRowSwipe'

// Сетка «Все врачи» на компьютере: с 2026-11-25 по умолчанию открывается свой врач — выбор «Все врачи» запомнен
beforeEach(() => { localStorage.setItem('crm.schedule.view.v2', 'all') })

// Меню быстрых действий на записи в расписании (2026-11-20): «⋯» и правая кнопка в сетке, долгое нажатие в списке дня.
// Пациенты вымышленные
type Appointment = Schemas['AppointmentView']
type Me = Schemas['BookingViewsMe']

function backend(list: Appointment[], who: Me = me) {
  const day = [...list]
  const sent: { path: string; body: unknown }[] = []
  const replace = (a: Appointment) => {
    day.splice(day.findIndex((x) => x.id === a.id), 1, a)
    return HttpResponse.json(a)
  }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/appointments', ({ request }) => {
      const doctorId = Number(new URL(request.url).searchParams.get('doctorId'))
      return HttpResponse.json(day.filter((a) => a.doctorId === doctorId))
    }),
    http.get('*/api/appointments/:id', ({ params }) => HttpResponse.json(day.find((a) => a.id === Number(params.id)))),
    http.post('*/api/appointments/:id/:action', async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>
      sent.push({ path: String(params.action), body })
      const a = day.find((x) => x.id === Number(params.id))!
      const now = new Date().toISOString()
      if (params.action === 'status') return replace({ ...a, status: body.status as Appointment['status'], version: a.version + 1 })
      if (params.action === 'arrived') return replace({ ...a, arrivedAt: now, version: a.version + 1 })
      if (params.action === 'in-chair') return replace({ ...a, arrivedAt: a.arrivedAt ?? now, inChairAt: now, version: a.version + 1 })
      return replace(a)
    }),
  )
  return sent
}

/** Блок записи в сетке и её «⋯» — соседняя кнопка сразу за блоком. */
async function moreOf(name: string) {
  const block = await screen.findByRole('button', { name: new RegExp(`, ${name}: `) })
  const more = block.nextElementSibling as HTMLElement
  expect(more).toHaveAccessibleName('Быстрые действия с записью')
  return { block, more }
}

/** Подписи пунктов без мелкой подсказки («Позвонить», а не «Позвонить +996 …») */
const labels = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map((i) => {
  const text = i.querySelector('.menu-text')!
  return (text.querySelector(':scope > span') ?? text).textContent!.trim()
})

describe('компьютер: сетка «Дня»', () => {
  test('«⋯» у записи сегодня (по умолчанию приход не отмечают): следующий шаг «Приём состоялся», «Неявка» — в меню', async () => {
    const sent = backend([appointment(10, 1, '23:30', 'Бакыт М.')])
    renderApp()
    const { more } = await moreOf('Бакыт М.')
    await userEvent.click(more)
    const menu = screen.getByRole('menu', { name: 'Действия: Бакыт М.' })
    expect(labels(menu)).toEqual(['Приём состоялся', 'Позвонить', 'Написать в WhatsApp', 'Напомнить о приёме в WhatsApp', 'Перенести', 'Записать повторно',
      'Открыть карточку пациента', 'Открыть запись', 'Неявка', 'Отменить запись'])
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Приём состоялся' }))
    await waitForSlow(() => expect(sent).toEqual([{ path: 'status', body: { version: 0, status: 'DONE' } }]))
  })

  test('клиника отмечает приход — «⋯» у записи сегодня: следующий шаг «Пришёл» уходит на сервер, меню закрывается', async () => {
    const sent = backend([appointment(10, 1, '23:30', 'Бакыт М.')], meArrivals)
    renderApp()
    const { more } = await moreOf('Бакыт М.')
    await userEvent.click(more)
    const menu = screen.getByRole('menu', { name: 'Действия: Бакыт М.' })
    expect(labels(menu)).toEqual(['Пришёл', 'Позвонить', 'Написать в WhatsApp', 'Напомнить о приёме в WhatsApp', 'Перенести', 'Записать повторно',
      'Открыть карточку пациента', 'Открыть запись', 'Неявка', 'Отменить запись'])
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Пришёл' }))
    await waitForSlow(() => expect(sent).toEqual([{ path: 'arrived', body: { version: 0, arrived: true } }]))
    expect(screen.queryByRole('menu', { name: /Действия:/ })).not.toBeInTheDocument()
    // Карточку для этого не открывали
    expect(screen.queryByRole('complementary', { name: 'Карточка приёма' })).not.toBeInTheDocument()
  })

  test('клиника отмечает приход — правая кнопка: пришёл → «Начать приём» (в кресле); в кресле → «Приём состоялся»', async () => {
    const arrivedAt = new Date().toISOString()
    const sent = backend([
      appointment(10, 1, '23:00', 'Бакыт М.', { arrivedAt }),
      appointment(11, 2, '23:00', 'Айпери К.', { arrivedAt, inChairAt: arrivedAt }),
    ], meArrivals)
    renderApp()
    fireEvent.contextMenu((await moreOf('Бакыт М.')).block, { clientX: 300, clientY: 200 })
    await userEvent.click(within(screen.getByRole('menu', { name: 'Действия: Бакыт М.' })).getByRole('menuitem', { name: 'Начать приём' }))
    await waitForSlow(() => expect(sent).toEqual([{ path: 'in-chair', body: { version: 0, inChair: true } }]))
    fireEvent.contextMenu((await moreOf('Айпери К.')).block, { clientX: 500, clientY: 200 })
    await userEvent.click(within(screen.getByRole('menu', { name: 'Действия: Айпери К.' })).getByRole('menuitem', { name: 'Приём состоялся' }))
    await waitForSlow(() => expect(sent.at(-1)).toEqual({ path: 'status', body: { version: 0, status: 'DONE' } }))
  })

  test('состоявшийся без оплаты: «Принять оплату» первым — открывает карточку с оплатой', async () => {
    backend([appointment(10, 1, '00:00', 'Бакыт М.', { status: 'DONE', servicePriceSom: 2500 })])
    renderApp()
    await userEvent.click((await moreOf('Бакыт М.')).more)
    const menu = screen.getByRole('menu', { name: 'Действия: Бакыт М.' })
    expect(labels(menu)[0]).toBe('Принять оплату')
    expect(labels(menu)).not.toContain('Перенести')
    expect(labels(menu)).not.toContain('Отменить запись')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Принять оплату' }))
    const card = await screen.findByRole('complementary', { name: 'Карточка приёма' })
    expect(within(card).getByRole('button', { name: /Принять оплату/ })).toBeInTheDocument()
  })

  test('«Перенести» открывает карточку сразу с формой переноса', async () => {
    backend([appointment(10, 1, '23:30', 'Бакыт М.')])
    renderApp()
    await userEvent.click((await moreOf('Бакыт М.')).more)
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Перенести' }))
    const card = await screen.findByRole('complementary', { name: 'Карточка приёма' })
    // Форма переноса уже открыта — вместо кнопки «Перенести или передать врачу»
    expect(within(card).queryByRole('button', { name: 'Перенести или передать врачу' })).not.toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Перенести' })).toHaveAttribute('type', 'submit')
  })

  test('«Записать повторно» — новая запись на этого пациента', async () => {
    backend([appointment(10, 1, '23:30', 'Бакыт М.')])
    renderApp()
    await userEvent.click((await moreOf('Бакыт М.')).more)
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Записать повторно' }))
    const form = await screen.findByRole('complementary', { name: 'Новая запись' })
    expect(form).toHaveTextContent('Бакыт М.')
  })

  test('«Отменить запись» — с причиной (то же окно, что в карточке)', async () => {
    const sent = backend([appointment(10, 1, '23:30', 'Бакыт М.', { version: 2 })])
    renderApp()
    await userEvent.click((await moreOf('Бакыт М.')).more)
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Отменить запись' }))
    const dialog = await screen.findByRole('dialog', { name: 'Причина отмены' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отменить запись' }))
    await waitForSlow(() => expect(sent).toEqual([{ path: 'status', body: { version: 2, status: 'CANCELLED' } }]))
  })

  test('приём коллеги (врач без прав на чужое расписание): только связаться и открыть', async () => {
    const sent = backend([appointment(10, 2, '23:30', 'Бакыт М.')], { ...me, admin: false })
    renderApp()
    await userEvent.click((await moreOf('Бакыт М.')).more)
    const menu = screen.getByRole('menu', { name: 'Действия: Бакыт М.' })
    expect(labels(menu)).toEqual(['Позвонить', 'Записать повторно', 'Открыть карточку пациента', 'Открыть запись'])
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Открыть запись' }))
    expect(await screen.findByRole('complementary', { name: 'Карточка приёма' })).toBeInTheDocument()
    expect(sent).toEqual([])
  })

  test('ошибка сервера остаётся плашкой, пока её не закрыли', async () => {
    backend([appointment(10, 1, '23:30', 'Бакыт М.')], meArrivals)
    server.use(http.post('*/api/appointments/:id/arrived', () => HttpResponse.json({ status: 409, code: 'stale', detail: 'Запись изменили с другого устройства — проверьте и повторите' }, { status: 409 })))
    renderApp()
    await userEvent.click((await moreOf('Бакыт М.')).more)
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Пришёл' }))
    const alert = await screen.findByText('Запись изменили с другого устройства — проверьте и повторите')
    await userEvent.click(within(alert.closest('[role=alert]') as HTMLElement).getByRole('button', { name: 'Понятно' }))
    expect(screen.queryByText(/Запись изменили/)).not.toBeInTheDocument()
  })
})

describe('телефон: список дня', () => {
  let clock = 0
  beforeEach(() => {
    clock = 0
    vi.spyOn(swipeClock, 'now').mockImplementation(() => clock)
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width') || query.includes('coarse'),
      media: query, addEventListener() {}, removeEventListener() {}, onchange: null,
      addListener() {}, removeListener() {}, dispatchEvent: () => false,
    }))
    vi.stubGlobal('innerWidth', 390)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const rowOf = async (name: string) => (await screen.findByRole('button', { name: new RegExp(`, ${name}: `) })).closest('li')!
  const at = (x: number, y: number) => [{ identifier: 1, clientX: x, clientY: y }]
  /** Палец лежит дольше порога долгого нажатия (настоящие таймеры — подменён только Date) */
  const hold = () => act(() => new Promise((resolve) => setTimeout(resolve, LONG_MS + 60)))

  test('долгое нажатие — нижний лист с действиями; клик после него карточку не открывает', async () => {
    backend([appointment(10, 1, '23:30', 'Бакыт М.')])
    renderApp()
    const row = await rowOf('Бакыт М.')
    fireEvent.touchStart(row, { touches: at(150, 300), changedTouches: at(150, 300) })
    await hold()
    fireEvent.touchEnd(row, { touches: [], changedTouches: at(150, 300) })
    fireEvent.click(within(row).getByRole('button', { name: /Бакыт М\.:/ }))
    const menu = screen.getByRole('menu', { name: 'Действия: Бакыт М.' })
    expect(menu).toHaveClass('sheet')
    expect(within(menu).getByRole('menuitem', { name: 'Приём состоялся' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Карточка приёма' })).not.toBeInTheDocument()
  })

  test('свайп по-прежнему работает: палец поехал — долгого нажатия нет, «Приём состоялся» свайпом влево', async () => {
    const sent = backend([appointment(10, 1, '00:00', 'Бакыт М.')])
    renderApp()
    const row = await rowOf('Бакыт М.')
    fireEvent.touchStart(row, { touches: at(300, 300), changedTouches: at(300, 300) })
    for (const dx of [-20, -100, -200]) {
      clock += 150
      fireEvent.touchMove(row, { touches: at(300 + dx, 300), changedTouches: at(300 + dx, 300) })
    }
    await hold()
    clock += 75
    fireEvent.touchEnd(row, { touches: [], changedTouches: at(100, 300) })
    expect(screen.queryByRole('menu', { name: /Действия:/ })).not.toBeInTheDocument()
    expect(await within(row).findByRole('status')).toHaveTextContent('Отмечено: приём состоялся')
    expect(sent).toEqual([{ path: 'status', body: { version: 0, status: 'DONE' } }])
  })
})
