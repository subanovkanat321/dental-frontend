import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { resolvePlace } from '../help/book'
import { CHAPTERS } from '../site/guide/content'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'
import { TIPS, tipsFor } from './catalog'

/**
 * «Совет дня» и приглашение в группу врачей: карточка над «Расписанием» один раз в день (разрешает сервер), закрывается,
 * «Показать» ведёт в раздел, деньги — только тем, кто их видит, приглашение — только со ссылкой и до «Вступить»,
 * не поверх тура. Сервер в тестах — маленький честный двойник: один показ в день. Данные вымышленные.
 */

type Me = Schemas['BookingViewsMe']
type View = Schemas['StaffTipsTipsView']

const assistant: Me = { ...me, admin: false, reception: false, doctorId: undefined, assistantOf: [1], fullName: 'Асель' }
const reception: Me = { ...me, admin: false, reception: true, doctorId: undefined, fullName: 'Айпери' }

const DESKTOP = { phone: false, telegram: false }

/** Двойник сервера советов: помнит день показа, увиденные, «не показывать», приглашение. */
function fakeTips(who: Me = me, start: Partial<View> = {}, groupUrl?: string) {
  const calls: string[] = []
  let view: View = { today: '2026-11-19', ready: true, shownToday: false, seen: [], off: false, groupShows: 0, groupDone: false, groupDue: false, used: [], ...start }
  const recalc = () => { view = { ...view, ready: !view.off && !view.shownToday, groupDue: view.groupDue && !view.groupDone && !view.shownToday } }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/platform-info', () => HttpResponse.json({ accessLog: false, accessNotify: false, accessRequiresGrant: false, doctorsGroupUrl: groupUrl } satisfies Schemas['PlatformInfoInfo'])),
    http.get('*/api/me/tips', () => HttpResponse.json(view)),
    http.post('*/api/me/tips/shown', async ({ request }) => {
      const { tip } = await request.json() as Schemas['StaffTipsControllerShownRequest']
      calls.push(`shown:${tip}`)
      const granted = view.ready
      if (granted) {
        view = { ...view, shownToday: true, seen: tip === 'group' ? view.seen : [...(view.seen ?? []), tip!], groupShows: view.groupShows + (tip === 'group' ? 1 : 0) }
        recalc()
      }
      return HttpResponse.json({ granted, tips: view } satisfies Schemas['StaffTipsShownView'])
    }),
    http.put('*/api/me/tips/off', async ({ request }) => {
      const { off } = await request.json() as Schemas['StaffTipsControllerOffRequest']
      calls.push(`off:${off}`)
      view = { ...view, off }
      recalc()
      return HttpResponse.json(view)
    }),
    http.post('*/api/me/tips/group-done', () => {
      calls.push('group-done')
      view = { ...view, groupDone: true }
      recalc()
      return HttpResponse.json(view)
    }),
  )
  return { calls, view: () => view }
}

const card = (name: string | RegExp = 'Совет дня') => screen.findByRole('dialog', { name }, { timeout: 5000 })

beforeEach(() => {
  // Плашку «Заполните профиль» уже закрыли — иначе совет ждёт её (свой тест ниже)
  localStorage.setItem('crm.profile-notice.hidden', '1')
})

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

test('совет показывается один раз в день: «Понятно» закрывает, снова открыли приложение — карточки нет', async () => {
  const fake = fakeTips()
  const app = renderApp()
  const c = await card()
  // Руководитель на компьютере, ничего не видел — первый по порядку
  expect(within(c).getByRole('heading')).toHaveTextContent('Перенос перетаскиванием')
  expect(within(c).getByRole('button', { name: 'Подробнее' })).toBeInTheDocument()
  expect(fake.calls).toEqual(['shown:drag'])

  await userEvent.click(within(c).getByRole('button', { name: 'Понятно' }))
  expect(screen.queryByRole('dialog', { name: 'Совет дня' })).not.toBeInTheDocument()

  // Тот же день, другое устройство (новое приложение): сервер говорит «сегодня уже было»
  app.unmount()
  renderApp()
  await screen.findByRole('navigation', { name: 'Разделы' })
  await new Promise((r) => setTimeout(r, 1300))
  expect(screen.queryByRole('dialog', { name: 'Совет дня' })).not.toBeInTheDocument()
  expect(fake.calls).toEqual(['shown:drag'])
})

test('увиденные не повторяются, чем клиника пользуется — позже; «Показать» ведёт в раздел', async () => {
  // Всё до «Заказа» уже видел; склад клиника ведёт — его совет в конце
  const before = TIPS.slice(0, TIPS.findIndex((t) => t.id === 'purchase')).map((t) => t.id).filter((id) => id !== 'stock')
  const fake = fakeTips(me, { seen: before, used: ['stock'] })
  renderApp()
  const c = await card()
  expect(within(c).getByRole('heading')).toHaveTextContent('«Заказ» поставщику в WhatsApp')
  await userEvent.click(within(c).getByRole('button', { name: 'Показать' }))
  expect(window.location.hash).toBe('#/stock/purchase')
  expect(fake.calls).toEqual(['shown:purchase'])
})

test('совета о деньгах нет у того, кто денег не видит', async () => {
  const money = ['debtors', 'from-tish', 'expenses', 'salary', 'earnings', 'debt-text', 'referral', 'import']
  for (const who of [assistant, reception]) {
    const ids = tipsFor(who, DESKTOP, [], []).map((t) => t.id)
    expect(ids.filter((id) => money.includes(id))).toEqual([])
  }
  // Руководитель — видит
  expect(tipsFor(me, DESKTOP, [], []).map((t) => t.id)).toEqual(expect.arrayContaining(['debtors', 'salary', 'from-tish']))
  // Ассистенту: увидел всё до «Должников» — следующим будет не «Должники»
  const upTo = TIPS.slice(0, TIPS.findIndex((t) => t.id === 'debtors') + 1).map((t) => t.id)
  fakeTips(assistant, { seen: upTo })
  renderApp()
  const c = await card()
  expect(within(c).getByRole('heading')).toHaveTextContent('Выходные и перерывы')
  expect(c).not.toHaveTextContent('Должники')
})

test('перетаскивание — только на компьютере, «Установить» — не в Telegram', () => {
  expect(tipsFor(me, { phone: true, telegram: true }, [], []).map((t) => t.id)).not.toEqual(expect.arrayContaining(['drag']))
  expect(tipsFor(me, { phone: true, telegram: true }, [], []).map((t) => t.id)).not.toContain('install')
  expect(tipsFor(me, DESKTOP, [], []).map((t) => t.id)).toEqual(expect.arrayContaining(['drag', 'install']))
})

test('у каждого совета id для сервера, «Подробнее» ведёт в существующий раздел руководства, советов 20–45', () => {
  expect(TIPS.length).toBeGreaterThanOrEqual(20)
  // 2026-11-20: шаг 3 плана Dentist Plus добавил советы (диагноз, приглашение в бот, скидка), шаг 6А — календарь врача и «чем красить» — предел 45
  expect(TIPS.length).toBeLessThanOrEqual(45)
  expect(new Set(TIPS.map((t) => t.id)).size).toBe(TIPS.length)
  for (const t of TIPS) {
    expect(t.id).toMatch(/^[a-z0-9-]{1,40}$/)
    expect(t.id).not.toBe('group')
    if ('guide' in t.action) {
      const [chapter, section] = t.action.guide.split('/')
      expect(resolvePlace([chapter!, section!], CHAPTERS), t.id).toEqual({ chapter, section })
    }
  }
})

test('«Не показывать советы» — сразу на сервер; «Помощь → Показывать советы снова» возвращает', async () => {
  const fake = fakeTips()
  renderApp()
  const c = await card()
  await userEvent.click(within(c).getByRole('button', { name: 'Не показывать советы' }))
  expect(screen.queryByRole('dialog', { name: 'Совет дня' })).not.toBeInTheDocument()
  await waitForSlow(() => expect(fake.calls).toEqual(['shown:drag', 'off:true']))

  await userEvent.click(screen.getByRole('button', { name: 'Помощь' }))
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Помощь' })).getByRole('button', { name: /^Показывать советы снова/ }))
  await waitForSlow(() => expect(fake.calls).toEqual(['shown:drag', 'off:true', 'off:false']))
  // Снова включили — пункта больше нет
  await userEvent.click(screen.getByRole('button', { name: 'Помощь' }))
  expect(within(screen.getByRole('dialog', { name: 'Помощь' })).queryByRole('button', { name: /^Показывать советы снова/ })).not.toBeInTheDocument()
})

test('приглашение в группу: без ссылки — обычный совет; со ссылкой — «Вступить» открывает группу и больше не зовёт', async () => {
  // Ссылки нет — приглашения нет, хотя сервер говорит «пора»
  const noUrl = fakeTips(me, { groupDue: true })
  const app = renderApp()
  await card()
  expect(noUrl.calls).toEqual(['shown:drag'])
  expect(screen.queryByRole('dialog', { name: 'Группа врачей Tish' })).not.toBeInTheDocument()
  app.unmount()

  const open = vi.fn()
  vi.stubGlobal('open', open)
  const fake = fakeTips(me, { groupDue: true }, 'https://t.me/+tishdoctors')
  renderApp()
  const g = await card('Группа врачей Tish')
  expect(g).toHaveTextContent('Новости, советы коллег, ответы на вопросы')
  expect(fake.calls).toEqual(['shown:group'])
  await userEvent.click(within(g).getByRole('button', { name: 'Вступить' }))
  expect(open).toHaveBeenCalledWith('https://t.me/+tishdoctors', '_blank', 'noopener')
  expect(screen.queryByRole('dialog', { name: 'Группа врачей Tish' })).not.toBeInTheDocument()
  await waitForSlow(() => expect(fake.calls).toEqual(['shown:group', 'group-done']))
  expect(fake.view().groupDue).toBe(false)
})

test('не поверх тура: пока тур не пройден, советов не спрашиваем и не показываем', async () => {
  const fake = fakeTips()
  server.use(http.get('*/api/me/tour', () => HttpResponse.json({} satisfies Schemas['StaffTourTourView'])))
  renderApp()
  await screen.findByRole('dialog', { name: /./, description: /./ }, { timeout: 5000 })
  await new Promise((r) => setTimeout(r, 1300))
  expect(screen.queryByRole('dialog', { name: 'Совет дня' })).not.toBeInTheDocument()
  expect(fake.calls).toEqual([])
})

test('не поверх плашки «Заполните профиль»: пока она на экране, совета нет', async () => {
  localStorage.clear()
  // Врач без фото и «о себе» — плашка видна
  const fake = fakeTips()
  renderApp()
  await screen.findByRole('region', { name: 'Заполните профиль' }, { timeout: 5000 })
  await new Promise((r) => setTimeout(r, 1300))
  expect(screen.queryByRole('dialog', { name: 'Совет дня' })).not.toBeInTheDocument()
  expect(fake.calls).toEqual([])
  // Закрыли плашку — совет появится
  await userEvent.click(screen.getByRole('button', { name: 'Скрыть подсказку' }))
  await card()
  expect(fake.calls).toEqual(['shown:drag'])
})
