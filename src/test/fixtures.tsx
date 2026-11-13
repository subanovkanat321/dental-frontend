import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'

import type { Schemas } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { App } from '../App'
import { todayIn } from '../lib/time'

/** Вымышленная клиника и пациенты — настоящих данных в тестах не бывает. */
export const me: Schemas['BookingViewsMe'] = {
  doctor: true, admin: true, reception: false, doctorId: 1, fullName: 'Айгерим',
  clinic: { brandName: 'Стоматология «Тест»', workStart: '09:00:00', workEnd: '18:00:00', independentDoctors: false, listed: true, separateSupplies: false, settingUp: false, ownHours: false, recallMonths: 6, patientContracts: true },
  doctors: [{ id: 1, fullName: 'Айгерим Садыкова', active: true, telegramLinked: false }, { id: 2, fullName: 'Дастан Т.', active: true, telegramLinked: false }], owner: false, platform: false, bookingEnabled: false, daysAhead: 0, canChangeClinic: false, waiting: false, hasReception: false, hasCard: false, maxRelatives: 6
}

export function appointment(id: number, doctorId: number, time: string, name: string, extra: Partial<Schemas['AppointmentView']> = {}) {
  const start = new Date(`${todayIn()}T${time}:00+06:00`)
  return {
    id, doctorId, startAt: start.toISOString(), endAt: new Date(start.getTime() + 30 * 60000).toISOString(),
    status: 'SCHEDULED', reply: 'NONE', version: 0, source: 'DOCTOR', debtSom: 0, firstVisit: false, chairManual: false, patient: { id, fullName: name, phone: '996555123456', telegram: false }, ...extra,
  } satisfies Schemas['AppointmentView']
}

export function renderApp() {
  const client = createQueryClient({ queries: { retry: false } })
  return render(<QueryClientProvider client={client}><App /></QueryClientProvider>)
}

/**
 * Подразделы открытого раздела: вкладки над страницей («Касса → Зарплата», с 2026-11-11); у «Настроек»
 * вкладок нет — их пункты в меню слева.
 */
function subsArea() {
  return screen.queryByRole('navigation', { name: /^Подразделы: / }) ?? screen.getByRole('navigation', { name: 'Разделы' })
}

/** Подраздел — ссылка; число у подраздела — в имени: «Вопросы · 2». */
export async function findSub(name: string | RegExp) {
  await screen.findByRole('navigation', { name: 'Разделы' })
  return waitFor(() => within(subsArea()).getByRole('link', { name }))
}

export function querySub(name: string | RegExp) {
  return within(subsArea()).queryByRole('link', { name })
}

/** Пункт «Настроек» (#/settings/<item>) — как нажать его в списке. */
export function openItem(item: string) {
  act(() => {
    window.location.hash = `/settings/${item}`
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

/** Карточка пациента → вкладка «Медкарта» → «Открыть медкарту» (карта зубов и план лечения, анкета, снимки). */
export async function openMedicalTab() {
  await userEvent.click(await screen.findByRole('tab', { name: 'Медкарта' }))
  await userEvent.click(screen.getByRole('button', { name: 'Открыть медкарту' }))
}

/** Карточка приёма → оплата: не оплачено — строка «Принять оплату», раскрыть её и вернуть форму. */
export async function openPay(panel: HTMLElement) {
  const open = within(panel).queryByRole('button', { name: 'Принять оплату' })
  if (open) await userEvent.click(open)
  return within(panel).findByRole('form', { name: 'Оплата' })
}

/** Медкарта → вкладка («Зубы», «План лечения», «Анкета», «Снимки и фото», «Заметки»). */
export async function medTab(name: string) {
  await userEvent.click(await screen.findByRole('tab', { name: new RegExp(name) }))
}

/** Карточка приёма → «Ещё» (редкое: промокод, предоплата, лист ожидания, откуда узнал, квитанция, исправить, удалить). */
export async function openMore(panel: HTMLElement) {
  await userEvent.click(await within(panel).findByRole('button', { name: /^Ещё/ }))
}

/** Строка-раскрывашка (layout/Fold: «Зубы», «Материалы», «Продолжение лечения») — раскрыть, если свёрнута. */
export async function expand(region: HTMLElement) {
  const head = region.querySelector<HTMLButtonElement>(':scope > .fold-head')
  if (head?.getAttribute('aria-expanded') === 'false') await userEvent.click(head)
  return region
}
