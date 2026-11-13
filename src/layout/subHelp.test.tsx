import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState, type ReactNode } from 'react'

import { HelpHint } from '../help/HelpHint'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { HeadSlotProvider, PageHead, SubHelp } from './PageHead'
import { useHeadSlot } from './headSlot'
import { SectionTitle } from './section'
import { NavContext, type NavApi } from './useSection'

/**
 * «?» подраздела (`SubHelp`): в полосе вкладок, а не строкой-шапкой с одним кружком; без полосы — как
 * раньше, в шапке страницы. Данные вымышленные.
 */

/** Как Shell: место полосы вкладок и место «?» подраздела в ней; два подраздела «Кассы». */
function Harness({ hint, children }: { hint?: ReactNode; children?: ReactNode }) {
  const [tabsSlot, setTabsSlot] = useState<HTMLElement | null>(null)
  const [helpSlot, setHelpSlot] = useState<HTMLElement | null>(null)
  const [slot, setSlot] = useHeadSlot()
  const nav: NavApi = {
    openSheet: () => {}, go: () => {}, counts: {}, active: () => 'money', tabsSlot, helpSlot, setHelpSlot,
    subs: () => [{ key: 'money', title: 'Деньги' }, { key: 'report', title: 'Отчёт' }],
  }
  return (
    <NavContext.Provider value={nav}>
      <div ref={setTabsSlot} />
      <HeadSlotProvider slot={slot}>
        <PageHead slotRef={setSlot} title={<SectionTitle page="cash" title="Касса" subTitle="Деньги" hint={hint} />} />
        {children}
      </HeadSlotProvider>
    </NavContext.Provider>
  )
}

const strip = () => screen.getByRole('navigation', { name: 'Подразделы: Касса' })
const hints = (el: HTMLElement) => within(el).queryAllByRole('button', { name: /^Подсказка/ }).map((b) => b.getAttribute('aria-label'))

afterEach(() => {
  window.location.hash = ''
})

test('«?» подраздела — в полосе вкладок, шапка страницы пустая', () => {
  const { container } = render(<Harness><SubHelp title="Деньги">Что тут.</SubHelp></Harness>)
  expect(hints(strip())).toEqual(['Подсказка: Деньги'])
  // Шапка без инструментов — её схлопывает CSS (.page-head без видимого содержимого)
  expect(container.querySelector('.page-head .head-tools')).toBeEmptyDOMElement()
})

test('два «?» подряд не показываем: подраздела заменяет «?» раздела', async () => {
  const { rerender } = render(<Harness hint={<HelpHint hint="cash" />} />)
  expect(hints(strip())).toEqual(['Подсказка: Касса'])
  // Что подраздел положил «?», полоса узнаёт от MutationObserver — он срабатывает после отрисовки
  rerender(<Harness hint={<HelpHint hint="cash" />}><SubHelp title="Деньги">Что тут.</SubHelp></Harness>)
  await waitFor(() => expect(hints(strip())).toEqual(['Подсказка: Деньги']))
  // Подраздел без своего «?» — снова «?» раздела
  rerender(<Harness hint={<HelpHint hint="cash" />} />)
  await waitFor(() => expect(hints(strip())).toEqual(['Подсказка: Касса']))
})

test('без полосы вкладок — как раньше: «?» своей строкой инструментов', () => {
  const { container } = render(<SubHelp title="Кресла">Что такое кресло.</SubHelp>)
  expect(container.querySelector('.head-tools-inline')).toContainElement(screen.getByRole('button', { name: 'Подсказка: Кресла' }))
})

test('«⌄» учитывает место «?» подраздела', async () => {
  // jsdom без раскладки: строка 390px, вкладки — 370px; каждый показанный «?» — 40px
  const props: Record<string, (el: HTMLElement) => number> = {
    offsetWidth: (el) => (el.classList.contains('sub-tabs-list') ? 370
      : el.classList.contains('sub-tabs-helps') ? 40 * el.querySelectorAll('.sub-tabs-help:not(:empty)').length : 0),
    clientWidth: (el) => (el.classList.contains('sub-tabs') || el.classList.contains('sub-tabs-scroll') ? 390 : 0),
  }
  const own = Object.fromEntries(Object.keys(props).map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]))
  for (const [name, get] of Object.entries(props)) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get(this: HTMLElement) { return get(this) } })
  }
  try {
    const { rerender } = render(<Harness />)
    expect(screen.queryByRole('button', { name: /^Все подразделы/ })).not.toBeInTheDocument()
    rerender(<Harness><SubHelp title="Деньги">Что тут.</SubHelp></Harness>)
    expect(await screen.findByRole('button', { name: /^Все подразделы/ })).toBeInTheDocument()
  } finally {
    for (const [name, d] of Object.entries(own)) {
      if (d) Object.defineProperty(HTMLElement.prototype, name, d)
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
    }
  }
})

test('«Платформа → Клиники»: «?» в полосе вкладок, отдельной строки с ним нет', async () => {
  window.location.hash = '/platform'
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, owner: true, platform: true })),
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })),
    http.get('*/api/platform/clinics', () => HttpResponse.json([])),
    http.get('*/api/platform/applications', () => HttpResponse.json([])),
    http.get('*/api/platform/agreements/statuses', () => HttpResponse.json({})),
    http.get('*/api/platform/pay-requests', () => HttpResponse.json([])),
  )
  renderApp()
  const tabs = await screen.findByRole('navigation', { name: 'Подразделы: Платформа' })
  const help = await within(tabs).findByRole('button', { name: 'Подсказка: Клиники' })
  expect(document.querySelector('.page-head .help-hint')).toBeNull()
  await userEvent.click(help)
  expect(within(tabs).getByRole('note', { name: 'Подсказка: Клиники' })).toHaveTextContent('Все клиники приложения')
})
