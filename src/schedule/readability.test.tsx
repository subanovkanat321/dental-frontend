import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { AVATARS } from '../lib/avatars'
import { slotInstant, todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow, warmSchedule } from '../test/wait'
import { GROUP_COLORS, isShaky, PAINT_KEY } from './paint'

// Сетка «Все врачи» на компьютере: с 2026-11-25 по умолчанию открывается свой врач — выбор «Все врачи» запомнен
beforeEach(() => { localStorage.setItem('crm.schedule.view.v2', 'all') })

/**
 * Шаг 6А — читаемость расписания: штриховка непрочных записей, полоска цвета врача в «Все врачи», «чем красить
 * запись», мини-календарь врача. Пациенты вымышленные.
 */

beforeAll(warmSchedule, 60_000)

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

/** У Айгерим (врач 1) — заявка, «записан, не подтвердил» и «подтвердил»; у Дастана (врач 2) — приём на терапию. */
function backend() {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => {
      const doctor = new URL(request.url).searchParams.get('doctorId')
      return HttpResponse.json(doctor === '1' ? [
        appointment(11, 1, '15:00', 'Заявка Тестова', { status: 'REQUESTED', serviceName: 'Пломба' }),
        appointment(12, 1, '16:00', 'Неподтвердил Тестов'),
        appointment(13, 1, '17:00', 'Придёт Тестова', { reply: 'CONFIRMED' }),
      ] : doctor === '2' ? [appointment(21, 2, '15:00', 'Терапия Тестов', { reply: 'CONFIRMED', serviceName: 'Пломба' })] : [])
    }),
    http.get('*/api/appointments/counts', () => HttpResponse.json([])),
  )
}

const block = (name: string) => screen.findByRole('button', { name: new RegExp(`, ${name}: `) })

describe('isShaky — какая запись непрочная', () => {
  const now = new Date(`${todayIn()}T12:00:00+06:00`)
  test('заявка и «записан» без подтверждения — непрочные; подтвердил, пришёл, в кресле — нет', () => {
    expect(isShaky(appointment(1, 1, '15:00', 'А', { status: 'REQUESTED' }), now)).toBe(true)
    expect(isShaky(appointment(1, 1, '15:00', 'А'), now)).toBe(true)
    expect(isShaky(appointment(1, 1, '15:00', 'А', { reply: 'NO_ANSWER' }), now)).toBe(true)
    expect(isShaky(appointment(1, 1, '15:00', 'А', { reply: 'RESCHEDULE' }), now)).toBe(true)
    expect(isShaky(appointment(1, 1, '15:00', 'А', { reply: 'CONFIRMED' }), now)).toBe(false)
    expect(isShaky(appointment(1, 1, '15:00', 'А', { arrivedAt: now.toISOString() }), now)).toBe(false)
    expect(isShaky(appointment(1, 1, '15:00', 'А', { inChairAt: now.toISOString() }), now)).toBe(false)
  })
  test('прошедшая неотмеченная, состоялся, неявка — не «непрочная запись»', () => {
    expect(isShaky(appointment(1, 1, '09:00', 'А'), now)).toBe(false)
    expect(isShaky(appointment(1, 1, '15:00', 'А', { status: 'DONE' }), now)).toBe(false)
    expect(isShaky(appointment(1, 1, '15:00', 'А', { status: 'NO_SHOW' }), now)).toBe(false)
  })
})

test('компьютер, «Все врачи»: непрочные — штриховкой (класс shaky), полоска — цвет врача (--doc у колонки)', async () => {
  screenSize(false)
  backend()
  renderApp()
  const request = await block('Заявка Тестова')
  expect(request).toHaveClass('appt', 's-request', 'shaky')
  expect(await block('Неподтвердил Тестов')).toHaveClass('shaky')
  expect(await block('Придёт Тестова')).not.toHaveClass('shaky')
  // Несколько врачей колонками — сетка multi: полоска слева у записи цветом врача (CSS берёт --doc колонки)
  const grid = document.querySelector('.grid')!
  expect(grid).toHaveClass('multi')
  const col = (name: string) => screen.getByRole('group', { name }) as HTMLElement
  expect(col('Айгерим Садыкова').style.getPropertyValue('--doc')).toBe(AVATARS[0])
  expect(col('Дастан Т.').style.getPropertyValue('--doc')).toBe(AVATARS[1])
  // По умолчанию красим по статусу — без своей заливки
  expect(request).not.toHaveClass('painted')
})

test('компьютер, один врач: сетка без multi — полоска слева снова цвет статуса', async () => {
  screenSize(false)
  localStorage.setItem('crm.schedule.view.v2', '1')
  backend()
  renderApp()
  await block('Заявка Тестова')
  expect(document.querySelector('.grid')).not.toHaveClass('multi')
})

test('телефон, список дня: непрочные строки — со штриховкой, у строки — полоска цвета врача', async () => {
  screenSize(true)
  backend()
  renderApp()
  const row = (await block('Заявка Тестова')).closest('li')!
  expect(row).toHaveClass('row', 's-request', 'shaky', 'doc')
  expect(row.style.getPropertyValue('--doc')).toBe(AVATARS[0])
  expect((await block('Неподтвердил Тестов')).closest('li')).toHaveClass('shaky')
  expect((await block('Придёт Тестова')).closest('li')).not.toHaveClass('shaky')
})

test('«Красить запись»: Врач — заливка цветом врача, Услуга — цветом раздела прайса; выбор на устройстве', async () => {
  screenSize(false)
  backend()
  server.use(http.get('*/api/service-types', () => HttpResponse.json([
    { id: 1, name: 'Пломба', durationMinutes: 30, active: true, group: 'THERAPY' },
  ] satisfies Schemas['ServiceTypeView'][])))
  renderApp()
  await block('Заявка Тестова')
  const paint = screen.getByRole('group', { name: 'Чем красить запись' })
  expect(within(paint).getByRole('button', { name: 'Статус' })).toHaveAttribute('aria-pressed', 'true')

  await userEvent.click(within(paint).getByRole('button', { name: 'Врач' }))
  expect(localStorage.getItem(PAINT_KEY)).toBe('doctor')
  const aigerim = await block('Заявка Тестова')
  expect(aigerim).toHaveClass('painted', 'shaky')
  expect(aigerim.style.getPropertyValue('--paint')).toBe(AVATARS[0])
  expect((await block('Терапия Тестов')).style.getPropertyValue('--paint')).toBe(AVATARS[1])

  await userEvent.click(within(paint).getByRole('button', { name: 'Услуга' }))
  await waitForSlow(async () => expect((await block('Терапия Тестов')).style.getPropertyValue('--paint')).toBe(GROUP_COLORS.THERAPY))
  // Услуга без раздела в прайсе (или без услуги) — серым «Другое»
  expect((await block('Неподтвердил Тестов')).style.getPropertyValue('--paint')).toBe(GROUP_COLORS.OTHER)

  await userEvent.click(within(paint).getByRole('button', { name: 'Статус' }))
  expect(localStorage.getItem(PAINT_KEY)).toBeNull()
  expect(await block('Заявка Тестова')).not.toHaveClass('painted')
})

test('«Красить запись» запомнен на устройстве — телефон красит строки по врачу', async () => {
  screenSize(true)
  localStorage.setItem(PAINT_KEY, 'doctor')
  backend()
  renderApp()
  const row = (await block('Заявка Тестова')).closest('li')!
  expect(row).toHaveClass('painted')
  expect(row.style.getPropertyValue('--paint')).toBe(AVATARS[0])
})

describe('мини-календарь врача', () => {
  /** Месяц Айгерим: 11-е — сегодня, свободно 2 ч 30 мин; 12-е — всё занято; 13-е — отпуск; раньше — прошлое */
  function month() {
    server.use(http.get('*/api/slots/month', ({ request }) => {
      const m = new URL(request.url).searchParams.get('month')!
      const days: Schemas['SlotServiceFreeDay'][] = []
      for (let d = 1; d <= 30; d++) {
        const date = `${m}-${String(d).padStart(2, '0')}`
        days.push(d < 11 ? { date, state: 'PAST', freeMinutes: 0 }
          : d === 12 ? { date, state: 'FULL', freeMinutes: 0 }
            : d === 13 ? { date, state: 'OFF', freeMinutes: 0, note: 'Отпуск' }
              : { date, state: 'FREE', freeMinutes: d === 11 ? 150 : 480 })
      }
      return HttpResponse.json(days)
    }))
  }

  test('компьютер: нажали на шапку колонки — месяц, рабочие дни, отпуск, сколько свободно; день — открывается', async () => {
    screenSize(false)
    backend()
    month()
    renderApp()
    await block('Заявка Тестова')
    const head = screen.getByTitle('Календарь врача: Айгерим Садыкова')
    await userEvent.click(head)
    const cal = screen.getByRole('dialog', { name: 'Календарь врача: Айгерим Садыкова' })
    expect(await within(cal).findByRole('button', { name: /11 ноября.*работает, свободно 2 ч 30 мин/ })).toHaveClass('k-work', 'today', 'selected')
    expect(within(cal).getByRole('button', { name: /12 ноября.*свободного времени нет/ })).toHaveClass('k-full')
    expect(within(cal).getByRole('button', { name: /13 ноября.*отпуск/ })).toHaveClass('k-off')
    // Прошлое — по недельному графику (по умолчанию в тестах врач работает каждый день)
    expect(within(cal).getByRole('button', { name: /10 ноября.*работал/ })).toHaveClass('k-past-work')
    expect(within(cal).getByText('Дней со свободным временем: 18')).toBeInTheDocument()

    await userEvent.click(within(cal).getByRole('button', { name: /18 ноября/ }))
    expect(screen.queryByRole('dialog', { name: /Календарь врача/ })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Среда, 18 ноября/ })).toBeInTheDocument()
  })

  test('«Только Айгерим» — прежнее действие шапки: одна колонка; Esc закрывает календарь', async () => {
    screenSize(false)
    backend()
    month()
    renderApp()
    await block('Заявка Тестова')
    await userEvent.click(screen.getByTitle('Календарь врача: Дастан Т.'))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /Календарь врача/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByTitle('Календарь врача: Айгерим Садыкова'))
    await userEvent.click(within(screen.getByRole('dialog', { name: /Календарь врача/ })).getByRole('button', { name: 'Только Айгерим' }))
    expect([...document.querySelectorAll('.grid-col')].map((c) => c.getAttribute('aria-label'))).toEqual(['Айгерим Садыкова'])
  })

  test('телефон: 📅 у выбора врача — лист с месяцем', async () => {
    screenSize(true)
    backend()
    month()
    renderApp()
    await block('Заявка Тестова')
    await userEvent.click(screen.getByRole('button', { name: 'Календарь врача: Айгерим Садыкова' }))
    const cal = screen.getByRole('dialog', { name: 'Календарь врача: Айгерим Садыкова' })
    expect(cal).toHaveClass('sheet')
    expect(await within(cal).findByRole('button', { name: /13 ноября.*отпуск/ })).toBeInTheDocument()
    // В одиночном виде «Только …» не нужно
    expect(within(cal).queryByRole('button', { name: /^Только/ })).not.toBeInTheDocument()
  })
})

test('свободное окно не помечено как непрочная запись (штриховка только у записей)', async () => {
  screenSize(false)
  backend()
  server.use(http.get('*/api/slots', ({ request }) => {
    const date = new URL(request.url).searchParams.get('date')!
    return HttpResponse.json({ workingDay: true, workStart: '09:00:00', workEnd: '18:00:00', breaks: [], starts: [],
      free: [{ start: slotInstant(date, 13 * 60), end: slotInstant(date, 14 * 60) }] })
  }))
  renderApp()
  await block('Заявка Тестова')
  expect(document.querySelectorAll('.grid-free.shaky')).toHaveLength(0)
})
