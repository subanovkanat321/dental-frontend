import { render } from '@testing-library/react'

import type { Schemas } from '../api/client'
import type { Page } from '../lib/route'
import { CLINIC_ITEMS, SETTINGS_GROUPS } from '../settings/items'
import { me } from '../test/fixtures'
import { subsOf } from './nav'
import { SUB_ICONS } from './subIconPaths'
import { SubIcon } from './subIcons'

type Me = Schemas['BookingViewsMe']

/** Роли с разными наборами подразделов (вымышленные): владелец платформы, руководитель-врач, врач, ассистент, регистратура. */
const ROLES: Me[] = [
  { ...me, doctor: false, platform: true, owner: true },
  me,
  { ...me, admin: false },
  { ...me, admin: false, doctorId: undefined, assistantOf: [2] },
  { ...me, admin: false, reception: true, doctorId: undefined },
]
const PAGES: Page[] = ['schedule', 'patients', 'learn', 'cash', 'stock', 'clinic', 'settings', 'platform']

test('у каждого подраздела каждого раздела — своя иконка (новый подраздел без иконки — тест упадёт)', () => {
  const missing: string[] = []
  for (const who of ROLES) {
    for (const page of PAGES) {
      for (const s of subsOf(page, who)) if (!SUB_ICONS[page]?.[s.key]) missing.push(`${page}/${s.key}`)
    }
  }
  // Пункты «Клиники» и «Настроек» — все, что видны хоть какой-то роли
  for (const i of CLINIC_ITEMS) if (!i.hidden && !SUB_ICONS.clinic?.[i.key]) missing.push(`clinic/${i.key}`)
  for (const [, items] of SETTINGS_GROUPS) for (const i of items) if (!i.hidden && !SUB_ICONS.settings?.[i.key]) missing.push(`settings/${i.key}`)
  expect([...new Set(missing)]).toEqual([])
})

test('внутри раздела иконки подразделов разные', () => {
  for (const [page, icons] of Object.entries(SUB_ICONS)) {
    const html = Object.values(icons).map((paths) => render(<svg>{paths}</svg>).container.innerHTML)
    expect(new Set(html).size, page).toBe(html.length)
  }
})

test('иконка — украшение: aria-hidden, оттенок своего раздела; без рисунка — ничего', () => {
  const { container } = render(<><SubIcon page="cash" sub="salary" /><SubIcon page="cash" sub="nope" /></>)
  const icons = container.querySelectorAll('svg')
  expect(icons).toHaveLength(1)
  expect(icons[0]).toHaveAttribute('aria-hidden', 'true')
  expect(icons[0]!.getAttribute('style')).toContain('var(--ico-cash)')
})

test('у пунктов «Настроек» и «Платформы» — свои оттенки по смыслу, а не один серый раздела', () => {
  const tone = (page: Page, sub: string) => render(<SubIcon page={page} sub={sub} />).container.querySelector('svg')!.getAttribute('style')
  for (const page of ['settings', 'platform'] as const) {
    const subs = Object.keys(SUB_ICONS[page]!)
    const tones = new Set(subs.map((s) => tone(page, s)))
    // Почти у каждого свой: повторов мало (палитра приглушённая, без кислотных цветов)
    expect(tones.size, page).toBeGreaterThanOrEqual(Math.min(subs.length, 10))
  }
  expect(tone('settings', 'plan')).toContain('var(--ico-cash)')
  expect(tone('settings', 'ai')).toContain('var(--ico-ai)')
  expect(tone('platform', 'tariffs')).toContain('var(--ico-cash)')
  // Остальные разделы — оттенком раздела
  expect(tone('cash', 'salary')).toContain('var(--ico-cash)')
})
