import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import type { AccountTab } from '../account/AccountPage'
import { logout, logoutEverywhere, type Schemas } from '../api/client'
import type { ClinicTab } from '../clinic/ClinicPage'
import { backFromMine, itemOf, openSettings } from '../lib/route'
import { ask, notify } from '../lib/confirm'
import { telegram } from '../lib/telegram'
import { setTextSize, setThemeChoice, TEXT_SIZES, textSize, themeChoice, THEMES } from '../lib/theme'
import type { TeamTab } from '../team/TeamPage'
import { InstallApp } from '../pwa/InstallApp'
import { Notifications } from '../pwa/Notifications'
import { Loading } from '../layout/Loading'
import { useSub } from '../lib/sub'
import { CLINIC_ITEMS, HELP_ITEMS, ME_ITEMS, SETTINGS_EMOJI, SETTINGS_GROUPS, type SettingsItem } from './items'
import { ItemHost, type ItemHostKind } from './itemHost'
import { SubHeader } from './SubHeader'

// Экраны пунктов — своими чанками: список «Настроек» открывается сразу (~10 КБ вместо ~110 КБ),
// код «Договора» или «Услуг» скачивается, только когда пункт открыли
const AccountPage = lazy(() => import('../account/AccountPage').then((m) => ({ default: m.AccountPage })))
const ClinicPage = lazy(() => import('../clinic/ClinicPage').then((m) => ({ default: m.ClinicPage })))
const TeamPage = lazy(() => import('../team/TeamPage').then((m) => ({ default: m.TeamPage })))
const WorkTimePage = lazy(() => import('./WorkTimePage').then((m) => ({ default: m.WorkTimePage })))
const GuidePage = lazy(() => import('./GuidePage').then((m) => ({ default: m.GuidePage })))
const HowToPage = lazy(() => import('./HowToPage').then((m) => ({ default: m.HowToPage })))
const CalendarPage = lazy(() => import('./CalendarPage').then((m) => ({ default: m.CalendarPage })))
const ProfilePage = lazy(() => import('./ProfilePage').then((m) => ({ default: m.ProfilePage })))
const ReminderTextPage = lazy(() => import('./ReminderTextPage').then((m) => ({ default: m.ReminderTextPage })))
const AiPage = lazy(() => import('./AiPage').then((m) => ({ default: m.AiPage })))
const SourcesPage = lazy(() => import('./SourcesPage').then((m) => ({ default: m.SourcesPage })))
const ContractTemplatePage = lazy(() => import('../contract/ContractTemplatePage').then((m) => ({ default: m.ContractTemplatePage })))
const ChairsPage = lazy(() => import('./ChairsPage').then((m) => ({ default: m.ChairsPage })))
const SurveyPage = lazy(() => import('../survey/SurveyPage').then((m) => ({ default: m.SurveyPage })))

type Me = Schemas['BookingViewsMe']

type Render = (me: Me, back: () => void, extra: { ticketId?: number }) => ReactNode

const team = (only: TeamTab, title: string): Render => (me, back) => <TeamPage me={me} only={only} title={title} onBack={back} />
const clinic = (only: ClinicTab, title: string): Render => (me, back) => <ClinicPage me={me} only={only} title={title} onBack={back} />
const account = (only: AccountTab, title: string): Render => (me, back, extra) =>
  <AccountPage me={me} only={only} title={title} onBack={back} initialTicket={extra.ticketId} />

/**
 * Экраны пунктов «Настроек», «Клиники», «Я» и «Помощи» (названия, группы и права — settings/items.ts,
 * их же показывает меню).
 */
const RENDER: Record<string, (title: string) => Render> = {
  about: (t) => clinic('about', t),
  staff: (t) => team('doctors', t),
  services: (t) => clinic('services', t),
  hours: () => (me, back) => <WorkTimePage me={me} onBack={back} initial="doctors" />,
  chairs: () => (me, back) => <ChairsPage me={me} onBack={back} />,
  shifts: () => (me, back) => <WorkTimePage me={me} onBack={back} initial="shifts" />,
  timeoff: () => (me, back) => <WorkTimePage me={me} onBack={back} initial="timeoff" />,
  reminder: () => (me, back) => <ReminderTextPage me={me} onBack={back} />,
  questions: (t) => clinic('questions', t),
  contract: () => (me, back) => <ContractTemplatePage me={me} onBack={back} />,
  memos: (t) => clinic('memos', t),
  'patient-news': (t) => clinic('news', t),
  sources: () => (me, back) => <SourcesPage me={me} onBack={back} initial="sources" />,
  promo: () => (me, back) => <SourcesPage me={me} onBack={back} initial="promo" />,
  plan: (t) => account('plan', t),
  agreement: (t) => account('agreement', t),
  data: (t) => account('data', t),
  ai: () => (_me, back) => <AiPage onBack={back} />,
  // «Выйти на всех устройствах» — внизу «Моего профиля» (обычный «Выйти» — в блоке «Я»)
  profile: () => (me, back) => <><ProfilePage me={me} onBack={back} /><LogoutSection /></>,
  appearance: (t) => (_me, back) => <AppearancePage title={t} onBack={back} />,
  notifications: (t) => (_me, back) => <div className="settings mine-page"><SubHeader title={t} onBack={back} /><Notifications /></div>,
  install: (t) => (_me, back) => <div className="settings mine-page"><SubHeader title={t} onBack={back} /><InstallApp /></div>,
  calendar: () => (_me, back) => <CalendarPage onBack={back} />,
  guide: () => (me, back) => <GuidePage me={me} onBack={back} />,
  videos: () => (_me, back) => <HowToPage onBack={back} />,
  support: (t) => account('support', t),
  chat: (t) => (me, back) => <AccountPage me={me} only="support" title={t} onBack={back} initialHelp />,
  survey: () => (_me, back) => <SurveyPage onBack={back} />,
  privacy: (t) => account('privacy', t),
}

/** Экран пункта — своим кусочком кода (Suspense); key — свой экран у каждого пункта: «Мой профиль» и «Персонал» не делят открытую карточку. */
function ItemScreen({ host, item, me, back, ticketId }: { host: ItemHostKind; item: SettingsItem; me: Me; back: () => void; ticketId?: number }) {
  return (
    <ItemHost.Provider value={host}>
      <div key={item.key} className="settings-item" data-host={host}>
        {/* «Клиника»: пока грузится кусочек кода пункта — уже его шапка, чтобы вкладки подразделов на телефоне
            не пропадали на миг (страница под ними прыгала бы на их высоту) */}
        <Suspense fallback={host === 'clinic' ? <><SubHeader title={item.title} onBack={back} /><Loading /></> : <Loading />}>{RENDER[item.key]!(item.title)(me, back, { ticketId })}</Suspense>
      </div>
    </ItemHost.Provider>
  )
}

/** Пункт по ключу — если он есть, виден этой роли и у него есть экран. */
function findItem(items: SettingsItem[], key: string | null | undefined, me: Me): SettingsItem | undefined {
  return items.find((i) => i.key === key && i.show(me) && RENDER[i.key])
}

/** Следим за адресом: пункт раздела (#/me/profile → 'profile'). */
function useItem(page: 'settings' | 'me' | 'help'): string | null {
  const [current, setCurrent] = useState(() => itemOf(page))
  useEffect(() => {
    const onHash = () => setCurrent(itemOf(page))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [page])
  return current
}

/**
 * Раздел «Клиника» (#/clinic/<пункт>): пункты — подразделы в меню слева (на телефоне — лист из
 * «Клиника · Персонал ▾»). Без пункта в адресе — последний открытый или первый, как у других разделов.
 */
export function ClinicSection({ me }: { me: Me }) {
  const chosen = useSub('clinic')
  const visible = CLINIC_ITEMS.filter((i) => !i.hidden && i.show(me))
  const found = findItem(CLINIC_ITEMS, chosen, me) ?? visible[0]
  if (!found) return null
  return <ItemScreen host="clinic" item={found} me={me} back={() => {}} />
}

/**
 * Пункты блока «Я» (#/me/…) и «Помощи» (#/help/…) внизу меню: открываются из их меню, «‹ Назад» —
 * туда, откуда открыли. Без пункта — «Мой профиль» и «Помощь и техподдержка».
 */
export function MineSection({ me, page, initialTicket }: { me: Me; page: 'me' | 'help'; initialTicket?: number }) {
  const current = useItem(page)
  const items = page === 'me' ? ME_ITEMS : HELP_ITEMS
  // Нет пункта в адресе или он не для этой роли (календарь без своего кресла) — пункт по умолчанию
  const found = findItem(items, current, me) ?? findItem(items, page === 'me' ? 'profile' : 'support', me)
  useLayoutEffect(() => { window.scrollTo(0, 0) }, [found?.key])
  if (!found) return null
  return <ItemScreen host={page} item={found} me={me} back={backFromMine} ticketId={initialTicket} />
}

/**
 * «Настройки»: главная — список пунктов двумя группами («Пациентам», «Аккаунт клиники»); пункт — во всю
 * рабочую область. Остальное, что было здесь до 2026-11-10: «Клиника» — раздел меню, своё — блок «Я»
 * внизу меню (профиль, оформление, уведомления, календарь, установка, выход), «Помощь» — внизу меню.
 */
export function SettingsPage({ me }: { me: Me }) {
  const current = useItem('settings')
  const back = () => openSettings(null)
  const found = SETTINGS_GROUPS.flatMap(([, items]) => items).find((i) => i.key === current && i.show(me) && RENDER[i.key])
  // Пункт открывается с начала, а назад в список — туда, где его листали
  const listY = useRef(0)
  const openKey = found?.key ?? null
  const prevKey = useRef(openKey)
  // Прокрутку списка запоминаем, пока он на экране: в момент открытия пункта страница уже короче,
  // и браузер успевает сбросить прокрутку
  useEffect(() => {
    if (openKey != null) return
    const onScroll = () => { listY.current = window.scrollY }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [openKey])
  useLayoutEffect(() => {
    if (prevKey.current === openKey) return
    window.scrollTo(0, openKey == null ? listY.current : 0)
    prevKey.current = openKey
  }, [openKey])
  if (found) return <ItemScreen host="settings" item={found} me={me} back={back} />

  return (
    <div className="settings">
      <header className="toolbar"><h1>Настройки</h1></header>
      <div className="settings-groups">
      {SETTINGS_GROUPS.map(([group, items], index) => {
        const shown = items.filter((i) => !i.hidden && i.show(me))
        if (!shown.length) return null
        return (
          <section key={group} className="settings-group" data-group={index}>
            <h2>{group}</h2>
            <ul className="settings-list">
              {shown.map((i) => (
                <li key={i.key}>
                  <button type="button" className="settings-link" onClick={() => openSettings(i.key)}>
                    <span className="settings-emoji" aria-hidden="true">{SETTINGS_EMOJI[i.key]}</span>
                    <span className="settings-text"><strong>{i.title}</strong><span className="hint" title={i.hint}>{i.hint}</span></span>
                    <span aria-hidden="true" className="chev">›</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      </div>
    </div>
  )
}

const EVERYWHERE_SITE = 'Выйти на всех устройствах? Закроются все входы на сайт Tish — на всех компьютерах и телефонах, '
  + 'через Telegram и по номеру, и здесь тоже. Пароль не меняется: войти снова можно как обычно.'

const EVERYWHERE_TELEGRAM = 'Выйти на всех устройствах? Закроются все входы на сайт Tish — на всех компьютерах и телефонах, '
  + 'через Telegram и по номеру. Здесь, в Telegram, Tish останется открытым.'

/**
 * Внизу «Моего профиля»: «Выйти» (только на сайте: в Telegram выходить не из чего; тот же — в блоке «Я»)
 * и «Выйти на всех устройствах» — гасит все входы на сайт этого человека; из Telegram тоже: забыли выйти
 * на компьютере клиники.
 */
function LogoutSection() {
  const [busy, setBusy] = useState(false)
  const inTelegram = Boolean(telegram())
  const everywhere = async () => {
    if (!await ask(inTelegram ? EVERYWHERE_TELEGRAM : EVERYWHERE_SITE)) return
    setBusy(true)
    try {
      await logoutEverywhere()
      if (inTelegram) await notify('Готово: все входы на сайт Tish закрыты.')
    } catch (e) {
      await notify(e instanceof Error ? e.message : 'Не получилось — попробуйте ещё раз')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="settings-group logout-actions">
      {!inTelegram && <button type="button" className="btn danger" onClick={() => void logout()}>Выйти</button>}
      <button type="button" className="btn danger" disabled={busy} onClick={() => void everywhere()}>Выйти на всех устройствах</button>
    </section>
  )
}

/** «Оформление»: тема и размер текста — сразу, на этом устройстве. Пункт блока «Я». */
function AppearancePage({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="settings">
      <SubHeader title={title} onBack={onBack} />
      <Appearance />
    </div>
  )
}

function Appearance() {
  const [theme, setTheme] = useState(themeChoice)
  const [size, setSize] = useState(textSize)
  return (
    <section className="settings-group" aria-label="Оформление">
      <div className="card-block appearance">
        <div className="field"><span>Тема</span>
          <div className="segments wrap" role="group" aria-label="Тема">
            {THEMES.map(([code, label]) => (
              <button key={code} type="button" aria-pressed={theme === code} onClick={() => { setThemeChoice(code); setTheme(code) }}>{label}</button>
            ))}
          </div>
        </div>
        <div className="field"><span>Размер текста</span>
          <div className="segments wrap" role="group" aria-label="Размер текста">
            {TEXT_SIZES.map(([code, label]) => (
              <button key={code} type="button" aria-pressed={size === code} onClick={() => { setTextSize(code); setSize(code) }}>{label}</button>
            ))}
          </div>
        </div>
        <p className="hint">Сохраняется на этом устройстве.</p>
      </div>
    </section>
  )
}
