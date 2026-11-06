/// <reference types="node" />
import { readFileSync } from 'node:fs'

import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, dayTitle, formatPhone, slotInstant, todayIn } from '../lib/time'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { addMonths, daysInMonth, weekdayOf } from './month/monthModel'

/** Стили — текстом: jsdom не применяет CSS, а штриховку и полоску задаёт именно он. */
const styles = readFileSync('src/styles.css', 'utf8')

type Appointment = Schemas['AppointmentView']

/** Компьютер (min-width совпадает) или телефон (max-width). */
function screenOf(kind: 'desktop' | 'phone') {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes(kind === 'desktop' ? 'min-width' : 'max-width'), media: query, addEventListener() {}, removeEventListener() {},
    onchange: null, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
}
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

const today = todayIn()
const tomorrow = addDays(today, 1)
const nextMonth = addMonths(today.slice(0, 7), 1)

/** Вымышленный приём на 30 минут: {@code minutes} — от полуночи по Бишкеку. */
function visit(id: number, doctorId: number, date: string, minutes: number, name: string, extra: Partial<Appointment> = {}): Appointment {
  const startAt = slotInstant(date, minutes)
  return {
    id, doctorId, startAt, endAt: new Date(new Date(startAt).getTime() + 30 * 60_000).toISOString(), status: 'SCHEDULED',
    reply: 'NONE', version: 1, patient: { id, fullName: name, phone: '996555000111' }, ...extra,
  }
}

/** Первый день месяца с этим днём недели. */
function firstWeekday(month: string, weekday: string): string {
  let d = `${month}-01`
  while (weekdayOf(d) !== weekday) d = addDays(d, 1)
  return d
}

describe('«Месяц»', () => {
  const tuesday = firstWeekday(nextMonth, 'TUESDAY')
  const wednesday = addDays(tuesday, 1)
  const saturday = firstWeekday(nextMonth, 'SATURDAY')

  function backend() {
    const ranges: string[] = []
    const list = [
      visit(1, 1, tuesday, 600, 'Бакыт М.', { status: 'REQUESTED' }),
      visit(2, 1, tuesday, 660, 'Нурлан К.', { reply: 'CONFIRMED' }),
      visit(3, 2, tuesday, 600, 'Асель Б.'),
      visit(4, 2, tuesday, 700, 'Отменили', { status: 'CANCELLED' }),
    ]
    server.use(
      http.get('*/api/patient/me', () => HttpResponse.json(me)),
      http.get('*/api/appointments', () => HttpResponse.json([])),
      http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, workStart: '09:00:00', workEnd: '18:00:00', breaks: [], free: [] } satisfies Schemas['SlotsView'])),
      http.get('*/api/appointments/range', ({ request }) => {
        const q = new URL(request.url).searchParams
        ranges.push(`${q.get('from')}/${q.get('days')}/${q.get('doctorId')}`)
        return HttpResponse.json(q.get('from')!.startsWith(nextMonth) ? list.filter((a) => String(a.doctorId) === q.get('doctorId')) : [])
      }),
      // Оба врача — пн–пт 09–18: суббота и воскресенье нерабочие
      http.get('*/api/doctors/:id/hours', () => HttpResponse.json({ custom: true, days: (['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] as const)
        .map((weekday) => ({ weekday, start: '09:00:00', end: '18:00:00' })) } satisfies Schemas['DoctorHoursView'])),
      // Среда — выходной всей клиники
      http.get('*/api/time-off', () => HttpResponse.json([{ id: 1, firstDay: wednesday, lastDay: wednesday, title: 'Праздник', emoji: '🎉' }] satisfies Schemas['TimeOffView'][])),
    )
    return { ranges }
  }

  test('числа записей по дням (все врачи, один запрос на врача за месяц), выходные — штриховкой, клик — «День»', async () => {
    screenOf('desktop')
    const { ranges } = backend()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Месяц' }))
    await userEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }))

    // Отменённый не считается: 2 у Айгерим + 1 у Дастана; загрузка — 90 минут из 18 рабочих часов двух врачей
    const day = await screen.findByRole('button', { name: new RegExp(`^${dayTitle(tuesday)}, 3 записи, занято 8%`) })
    expect(day).toHaveTextContent('3 записи')
    expect(day.querySelector('.month-dot.k-request')).toHaveTextContent('1')
    expect(day.querySelector('.month-dot.k-ok')).toHaveTextContent('1')
    expect(day.querySelector('.month-load > span')).toHaveStyle({ '--load': '8%' })
    expect(ranges).toEqual(expect.arrayContaining([`${nextMonth}-01/${daysInMonth(nextMonth)}/1`, `${nextMonth}-01/${daysInMonth(nextMonth)}/2`]))
    expect(screen.getByRole('heading', { level: 1 }).closest('.day-title')).toHaveTextContent(/все врачи · записей 3/)

    // Выходные: суббота по графику, среда — праздник клиники (с подписью)
    expect(screen.getByRole('button', { name: new RegExp(`^${dayTitle(saturday)}, нерабочий день`) })).toHaveClass('off')
    const holiday = screen.getByRole('button', { name: new RegExp(`^${dayTitle(wednesday)}, 🎉 Праздник`) })
    expect(holiday).toHaveClass('off')
    expect(holiday).toHaveTextContent('🎉 Праздник')
    expect(day).not.toHaveClass('off')

    await userEvent.click(day)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(dayTitle(tuesday))
    expect(screen.getByRole('button', { name: 'День' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('сегодня выделено; выбранный врач — только его записи', async () => {
    screenOf('desktop')
    backend()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Месяц' }))
    const now = await screen.findByRole('button', { name: new RegExp(`^${dayTitle(today)}`) })
    expect(now).toHaveClass('today')
    expect(now).toHaveAttribute('aria-current', 'date')

    await userEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }))
    await userEvent.click(screen.getByRole('button', { name: /Дастан Т\./ }))
    expect(await screen.findByRole('button', { name: new RegExp(`^${dayTitle(tuesday)}, 1 запись`) })).toBeInTheDocument()
  })

  test('телефон: «День | Месяц» над днём, в ячейке — число записей', async () => {
    screenOf('phone')
    backend()
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Месяц' }))
    expect(screen.queryByRole('button', { name: 'Неделя' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }))
    // На телефоне — свой врач (Айгерим): 2 записи
    const day = await screen.findByRole('button', { name: new RegExp(`^${dayTitle(tuesday)}, 2 записи`) })
    expect(day.querySelector('.month-count')).toHaveTextContent(/^2$/)
    expect(day.closest('.month')).toHaveClass('compact')
  })
})

describe('сетка «Дня»', () => {
  const doctors = [
    { id: 1, fullName: 'Айгерим Садыкова', active: true, photoUrl: '/api/doctors/1/photo', about: 'Ортодонт, брекеты\nСтаж 10 лет' },
    { id: 2, fullName: 'Дастан Т.', active: true },
  ]

  function backend() {
    server.use(
      http.get('*/api/patient/me', () => HttpResponse.json({ ...me, doctors })),
      http.get('*/api/appointments', ({ request }) => {
        const q = new URL(request.url).searchParams
        if (q.get('date') !== tomorrow || q.get('doctorId') !== '1') return HttpResponse.json([])
        return HttpResponse.json([visit(10, 1, tomorrow, 600, 'Бакыт М.', {
          serviceName: 'Чистка', comment: 'Боится уколов', debtSom: 1500, patient: { id: 10, fullName: 'Бакыт М.', phone: '996555000111' },
        })])
      }),
      http.get('*/api/slots', ({ request }) => {
        const q = new URL(request.url).searchParams
        const date = q.get('date')!
        if (q.get('doctorId') === '2') return HttpResponse.json({ workingDay: false, breaks: [], free: [] } satisfies Schemas['SlotsView'])
        return HttpResponse.json({
          workingDay: true, workStart: '10:00:00', workEnd: '17:00:00',
          breaks: [{ start: slotInstant(date, 13 * 60), end: slotInstant(date, 14 * 60), title: 'Обед', emoji: '🍽' }],
          free: [{ start: slotInstant(date, 14 * 60), end: slotInstant(date, 17 * 60) }],
        } satisfies Schemas['SlotsView'])
      }),
    )
  }

  async function openTomorrow() {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Следующий день' }))
    return screen.findByRole('button', { name: /10:00–10:30, Бакыт М\./ })
  }

  test('шапка колонки: круглое фото и специальность — первая строка «Кратко о себе»; без фото — буквы', async () => {
    screenOf('desktop')
    backend()
    await openTomorrow()
    const heads = document.querySelectorAll('.grid-head')
    expect(heads[0]!.querySelector('img.avatar.photo')).toHaveAttribute('src', '/api/doctors/1/photo')
    expect(heads[0]!.querySelector('.grid-head-spec')).toHaveTextContent(/^Ортодонт, брекеты$/)
    expect(heads[0]).not.toHaveTextContent('Стаж')
    expect(heads[1]!.querySelector('img')).toBeNull()
    expect(heads[1]!.querySelector('.avatar')).toHaveTextContent('ДТ')
    expect(heads[1]!.querySelector('.grid-head-spec')).toBeNull()
  })

  test('нерабочее время, перерыв и выходной — штриховкой (--hatch: repeating-linear-gradient)', async () => {
    screenOf('desktop')
    backend()
    await openTomorrow()
    const own = screen.getByRole('group', { name: 'Айгерим Садыкова' })
    // До 10:00 и после 17:00 — нерабочее (сетка 10–17, приём внутри: хвостов нет), перерыв — отдельный блок
    expect(own.querySelector('.grid-break')).toHaveTextContent('🍽 Обед')
    const other = screen.getByRole('group', { name: 'Дастан Т.' })
    expect(other.querySelector('.grid-off')).toHaveTextContent('Выходной')
    // Классы штрихуются одной переменной; сама переменная — диагональные линии
    expect(styles).toMatch(/--hatch: repeating-linear-gradient\(135deg/)
    expect(styles).toMatch(/\.grid-off \{[^}]*background: var\(--hatch\)/)
    expect(styles).toMatch(/\.grid-break \{[^}]*background: var\(--hatch\)/)
  })

  test('полоска слева у приёма — цвет статуса', async () => {
    screenOf('desktop')
    backend()
    const block = await openTomorrow()
    expect(block).toHaveClass('s-quiet')
    expect(block.style.getPropertyValue('--doc')).toBe('')
    expect(styles).toMatch(/\.appt\.s-request \{ --stripe: var\(--req-ink\); \}/)
  })

  test('всплывающая карточка: мышь — через 300 мс, все поля, Esc закрывает; клик открывает карточку справа', async () => {
    screenOf('desktop')
    backend()
    const block = await openTomorrow()
    fireEvent.pointerEnter(block, { pointerType: 'mouse' })
    // Сразу — ещё нет (задержка), потом появляется
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    const tip = await screen.findByRole('tooltip')
    expect(block).toHaveAttribute('aria-describedby', tip.id)
    for (const text of ['Бакыт М.', formatPhone('996555000111'), 'Айгерим Садыкова', 'Не напомнили', 'Чистка', 'Боится уколов', '1 500 сом']) {
      expect(tip).toHaveTextContent(text)
    }
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await userEvent.click(block)
    expect(screen.getByRole('complementary', { name: 'Карточка приёма' })).toHaveTextContent('Бакыт М.')
  })

  test('палец (touch) — без всплывающей карточки', async () => {
    screenOf('desktop')
    backend()
    const block = await openTomorrow()
    fireEvent.pointerEnter(block, { pointerType: 'touch' })
    await act(() => new Promise((r) => setTimeout(r, 450)))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  test('без права на деньги врача — без долга во всплывающей карточке', async () => {
    screenOf('desktop')
    backend()
    server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, doctorId: 2, doctors })))
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Следующий день' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Все врачи' }))
    const own = await screen.findByRole('group', { name: 'Айгерим Садыкова' })
    const block = await within(own).findByRole('button', { name: /Бакыт М\./ })
    fireEvent.pointerEnter(block, { pointerType: 'mouse' })
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('Чистка')
    expect(tip).not.toHaveTextContent('Долг')
  })
})
