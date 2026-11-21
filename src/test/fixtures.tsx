import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'

import type { Schemas } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { App } from '../App'
import { todayIn } from '../lib/time'
import { warmSchedule } from './wait'

// Оболочка и «Расписание» в App.tsx — ленивые: файл, который рисует приложение (renderApp), заранее собирает их в
// beforeAll со своим сроком. Иначе под нагрузкой (полный прогон, --maxWorkers) первый тест файла ждал сборку внутри
// 5 с findBy и падал «Unable to find …» через раз, а один — проходил (2026-11-20: rowswipe, telegram, actions…)
beforeAll(warmSchedule, 60_000)

/** Вымышленная клиника и пациенты — настоящих данных в тестах не бывает. */
export const me: Schemas['BookingViewsMe'] = {
  doctor: true, admin: true, reception: false, doctorId: 1, fullName: 'Айгерим',
  clinic: { brandName: 'Стоматология «Тест»', workStart: '09:00:00', workEnd: '18:00:00', independentDoctors: false, listed: true, separateSupplies: false, settingUp: false, ownHours: false, recallMonths: 6, patientContracts: true },
  doctors: [{ id: 1, fullName: 'Айгерим Садыкова', active: true, telegramLinked: false }, { id: 2, fullName: 'Дастан Т.', active: true, telegramLinked: false }], owner: false, platform: false, bookingEnabled: false, daysAhead: 0, canChangeClinic: false, waiting: false, hasReception: false, hasCard: false, maxRelatives: 6
}

/** Клиника отмечает приход (флаг V245; пункт настройки убран 2026-11-21, у старых клиник может быть включён): цепочка «Пришёл» → «Начать приём» → «Приём состоялся». */
export const meArrivals: Schemas['BookingViewsMe'] = { ...me, clinic: { ...me.clinic!, markArrival: true } }

export function appointment(id: number, doctorId: number, time: string, name: string, extra: Partial<Schemas['AppointmentView']> = {}) {
  const start = new Date(`${todayIn()}T${time}:00+06:00`)
  return {
    id, doctorId, startAt: start.toISOString(), endAt: new Date(start.getTime() + 30 * 60000).toISOString(),
    status: 'SCHEDULED', reply: 'NONE', version: 0, source: 'DOCTOR', debtSom: 0, firstVisit: false, chairManual: false, lockedForDoctors: false, patient: { id, fullName: name, phone: '996555123456', telegram: false }, ...extra,
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

/**
 * «Платформа»: вкладка и режим объединённой вкладки (2026-11-14) — «Маркетинг» → «Материалы»,
 * «Рассылка клиникам» → «Всем сразу (руководителям)». Без режима — только вкладка.
 */
export async function openPlatform(sub: string | RegExp, mode?: string, user = userEvent.setup()) {
  await user.click(await findSub(sub))
  if (!mode) return
  const button = await waitFor(() => within(document.querySelector<HTMLElement>('.platform-modes')!).getByRole('button', { name: mode }))
  await user.click(button)
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

/** Карточка пациента → «Медкарта»: вкладка сразу открывает медкарту (карта зубов и план лечения, анкета, снимки). */
export async function openMedicalTab() {
  await userEvent.click(await screen.findByRole('tab', { name: 'Медкарта' }))
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

/** Карточка приёма → пилюля статуса «🟢 Пришёл ▾» (имя «Статус: Пришёл»); без прав — без меню (null). */
export function statusMenu(panel: HTMLElement) {
  return within(panel).queryByRole('button', { name: /^Статус: / })
}

/**
 * Карточка приёма → пилюля статуса → статус в списке («Неявка», «Отменён», «Записан», «Приём состоялся»…).
 * Имя пункта — подпись и мелкая причина под ней («Неявка с дня приёма»), поэтому по умолчанию — по началу.
 */
export async function pickStatus(panel: HTMLElement, item: string | RegExp) {
  const button = statusMenu(panel)
  if (!button) throw new Error('Нет пилюли статуса — приём только посмотреть?')
  await userEvent.click(button)
  const name = typeof item === 'string' ? new RegExp(`^${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) : item
  await userEvent.click(await screen.findByRole('menuitemradio', { name }))
}

/** Карточка приёма или пациента → «📞 Связаться ▾» (один пункт — это сама кнопка или ссылка, меню нет). */
export function contactMenu(panel: HTMLElement) {
  return within(panel).queryByRole('button', { name: /^(📞 )?Связаться$/ })
}

/**
 * «📞 Связаться ▾» → пункт («Позвонить», «Написать в WhatsApp», «Напомнить о приёме в WhatsApp», «Попросить оценку»,
 * «Напомнить о долге»). Имя пункта — подпись и мелкая подсказка под ней, поэтому строка ищется по началу.
 */
export async function pickContact(panel: HTMLElement, item: string | RegExp) {
  const button = contactMenu(panel)
  if (!button) throw new Error('Нет кнопки «Связаться»')
  await userEvent.click(button)
  const name = typeof item === 'string' ? new RegExp(`^${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) : item
  await userEvent.click(await screen.findByRole('menuitem', { name }))
}

/** Строка-раскрывашка (layout/Fold: «Зубы», «Материалы», «Продолжение лечения») — раскрыть, если свёрнута. */
export async function expand(region: HTMLElement) {
  const head = region.querySelector<HTMLButtonElement>(':scope > .fold-head')
  if (head?.getAttribute('aria-expanded') === 'false') await userEvent.click(head)
  return region
}

/** Новая запись: какой врач выбран — нажатый чип в группе «Врач» (до шести врачей — чипы, а не список). */
export function chosenDoctor(scope: HTMLElement): string | undefined {
  const group = within(scope).getByRole('group', { name: 'Врач' })
  return within(group).getAllByRole('button').find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent ?? undefined
}

/** Новая запись: выбрать врача чипом («Айгерим С.», «Дастан Т.»). */
export async function pickDoctorChip(scope: HTMLElement, name: string) {
  await userEvent.click(within(within(scope).getByRole('group', { name: 'Врач' })).getByRole('button', { name }))
}

/** После «Записать» форма закрывается, внизу тост «Записано: … — Открыть»: открыть из него карточку записи. */
export async function openBooked() {
  const toast = (await screen.findByText(/^Записано: /)).closest('.booked-toast') as HTMLElement
  await userEvent.click(within(toast).getByRole('button', { name: 'Открыть' }))
  return screen.findByRole('complementary', { name: 'Карточка приёма' })
}

/** Новая запись: раскрыть «Ещё» (промокод, «Хочет раньше»). */
export async function openNewMore(panel: HTMLElement) {
  await userEvent.click(within(within(panel).getByRole('region', { name: /^Ещё: промокод/ })).getByRole('button', { name: /Ещё/ }))
}

/** Поле «Услуга» (ServicePicker): какая услуга выбрана — текст поля («🦷 Чистка · 60 мин»), пусто — подсказка. */
export function serviceField(scope: HTMLElement): HTMLElement {
  return within(scope).getByRole('combobox', { name: 'Услуга' })
}

/**
 * Что выбрано в «Услуге» «Новой записи» (несколько услуг, шаг 5А): чипы «Выбранные услуги»; ничего не выбрано — само поле
 * с подсказкой «Выберите услугу…».
 */
export function servicesChosen(scope: HTMLElement): HTMLElement {
  return within(scope).queryByRole('list', { name: 'Выбранные услуги' }) ?? serviceField(scope)
}

/** Выбрать услугу в поле «Услуга»: открыть список и нажать строку (имя — начало строки, без эмодзи). */
export async function pickService(scope: HTMLElement, name: string | RegExp) {
  await userEvent.click(serviceField(scope))
  const list = await screen.findByRole('listbox')
  const re = typeof name === 'string' ? new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : name
  await userEvent.click(within(list).getAllByRole('option', { name: re })[0]!)
}

/** Строки списка услуг (открыть поле «Услуга»): тексты без эмодзи-префикса не трогаем — как на экране. */
export async function serviceOptionsShown(scope: HTMLElement): Promise<string[]> {
  await userEvent.click(serviceField(scope))
  const list = await screen.findByRole('listbox')
  const texts = within(list).getAllByRole('option').map((o) => o.textContent ?? '')
  await userEvent.keyboard('{Escape}')
  return texts
}
