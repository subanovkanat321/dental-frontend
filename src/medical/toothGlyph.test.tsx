import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { ToothFormula } from './ToothFormula'
import { ToothFigure, ToothGlyph } from './ToothGlyph'
import type { ToothState } from './toothStates'

// Карта вымышленного пациента: состояние — прямо на рисунке зуба
const chart: Record<number, ToothState> = { 16: 'CARIES', 36: 'FILLING', 11: 'CROWN', 46: 'IMPLANT', 48: 'MISSING', 14: 'TREATING' }

function Chart() {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <>
      <ToothFormula render={(n) => (
        <button key={n} type="button" className={`tooth${open === n ? ' active' : ''}`} aria-pressed={open === n}
          aria-label={`Зуб ${n}: ${chart[n] ?? 'HEALTHY'}`} onClick={() => setOpen(n)}>
          <ToothFigure number={n} state={chart[n]} />
        </button>
      )} />
      <p>Выбран: {open ?? '—'}</p>
    </>
  )
}

const glyph = (name: string) => screen.getByRole('button', { name }).querySelector('svg.tooth-glyph')!

test('формула: 32 зуба рисунками, состояние — на рисунке, выбор нажатием и с клавиатуры', async () => {
  render(<Chart />)
  expect(screen.getAllByRole('button', { name: /^Зуб \d\d:/ })).toHaveLength(32)
  expect(document.querySelectorAll('svg.tooth-glyph')).toHaveLength(32)

  expect(glyph('Зуб 16: CARIES').querySelector('[data-part=caries]')).not.toBeNull()
  expect(glyph('Зуб 36: FILLING').querySelector('[data-part=filling]')).not.toBeNull()
  expect(glyph('Зуб 11: CROWN').querySelector('[data-part=crown-cap]')).not.toBeNull()
  expect(glyph('Зуб 14: TREATING').querySelector('[data-part=treating]')).not.toBeNull()
  // Имплант — винт вместо корней и без каналов; удалённый — без пульпы
  const implant = glyph('Зуб 46: IMPLANT')
  expect(implant.querySelector('[data-part=implant]')).not.toBeNull()
  expect(implant.querySelector('.tg-root, [data-part=pulp]')).toBeNull()
  expect(glyph('Зуб 48: MISSING')).toHaveAttribute('data-state', 'MISSING')
  expect(glyph('Зуб 48: MISSING').querySelector('[data-part=pulp]')).toBeNull()
  // Здоровый зуб — с пульпой и каналами, без пометок
  const healthy = glyph('Зуб 21: HEALTHY')
  expect(healthy.querySelector('[data-part=pulp]')).not.toBeNull()
  expect(healthy.querySelector('[data-part=caries], [data-part=filling]')).toBeNull()

  await userEvent.click(screen.getByRole('button', { name: 'Зуб 36: FILLING' }))
  expect(screen.getByRole('button', { name: 'Зуб 36: FILLING' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('Выбран: 36')).toBeInTheDocument()
  // Клавиатура: зуб — обычная кнопка, Tab до неё и Enter
  screen.getByRole('button', { name: 'Зуб 37: HEALTHY' }).focus()
  await userEvent.keyboard('{Enter}')
  expect(screen.getByText('Выбран: 37')).toBeInTheDocument()
})

test('форма и корни по группе: верхний моляр — 3 корня, нижний — 2, 14 — 2, резец — 1; рисунок скрыт от экранного диктора', () => {
  const roots = (n: number) => {
    const { container, unmount } = render(<ToothGlyph number={n} />)
    const svg = container.querySelector('svg')!
    const r = { count: svg.querySelectorAll('.tg-root').length, shape: svg.dataset.shape, hidden: svg.getAttribute('aria-hidden') }
    unmount()
    return r
  }
  expect(roots(16)).toEqual({ count: 3, shape: 'molar3', hidden: 'true' })
  expect(roots(36).count).toBe(2)
  expect(roots(14).count).toBe(2)
  expect(roots(45)).toMatchObject({ count: 1, shape: 'premolar1' })
  expect(roots(13).shape).toBe('canine')
  expect(roots(31)).toMatchObject({ count: 1, shape: 'incisor' })
})

test('номер у линии смыкания: у верхнего зуба под рисунком, у нижнего — над', () => {
  const { container } = render(<><div><ToothFigure number={26} /></div><div><ToothFigure number={36} /></div></>)
  const [u, l] = [container.children[0]!, container.children[1]!]
  expect(u.firstElementChild!.tagName.toLowerCase()).toBe('svg')
  expect(l.firstElementChild).toHaveClass('tooth-number')
})
