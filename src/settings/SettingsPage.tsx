import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import type { AccountTab } from '../account/AccountPage'
import { logout, logoutEverywhere, type Schemas } from '../api/client'
import type { ClinicTab } from '../clinic/ClinicPage'
import { TISH_INSTAGRAM, TISH_INSTAGRAM_NAME } from '../lib/brand'
import { openSection, openSettings, settingsItem } from '../lib/route'
import { ask, notify } from '../lib/confirm'
import { openLink, telegram } from '../lib/telegram'
import { setTextSize, setThemeChoice, TEXT_SIZES, textSize, themeChoice, THEMES } from '../lib/theme'
import type { TeamTab } from '../team/TeamPage'
import { isAssistant } from '../lib/roles'
import { InstallApp } from '../pwa/InstallApp'
import { Notifications } from '../pwa/Notifications'
import { Loading } from '../layout/Loading'
import { SETTINGS_EMOJI, SETTINGS_GROUPS } from './items'
import { SubHeader } from './SubHeader'

// Экраны пунктов — своими чанками: список «Настроек» открывается сразу (~10 КБ вместо ~110 КБ),
// код «Договора» или «Услуг» скачивается, только когда пункт открыли
const AccountPage = lazy(() => import('../account/AccountPage').then((m) => ({ default: m.AccountPage })))
const ClinicPage = lazy(() => import('../clinic/ClinicPage').then((m) => ({ default: m.ClinicPage })))
const TeamPage = lazy(() => import('../team/TeamPage').then((m) => ({ default: m.TeamPage })))
const WorkTimePage = lazy(() => import('./WorkTimePage').then((m) => ({ default: m.WorkTimePage })))
const GuidePage = lazy(() => import('./GuidePage').then((m) => ({ default: m.GuidePage })))
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

/** Экраны пунктов «Настроек» (названия, группы и права — settings/items.ts, их же показывает меню). */
const RENDER: Record<string, (title: string) => Render> = {
  about: (t) => clinic('about', t),
  doctors: (t) => team('doctors', t),
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
  profile: () => (me, back) => <ProfilePage me={me} onBack={back} />,
  appearance: (t) => (_me, back) => <AppearancePage title={t} onBack={back} />,
  calendar: () => (_me, back) => <CalendarPage onBack={back} />,
  guide: () => (me, back) => <GuidePage me={me} onBack={back} />,
  support: (t) => account('support', t),
  help: (t) => (me, back) => <AccountPage me={me} only="support" title={t} onBack={back} initialHelp />,
  survey: () => (_me, back) => <SurveyPage onBack={back} />,
  privacy: (t) => account('privacy', t),
}

/** «Настройки»: главная — список пунктов и оформление; пункт — во всю рабочую область. */
export function SettingsPage({ me, initialTicket }: { me: Me; initialTicket?: number }) {
  const [current, setCurrent] = useState(settingsItem)
  useEffect(() => {
    const onHash = () => setCurrent(settingsItem())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const back = () => openSettings(null)
  const found = SETTINGS_GROUPS.flatMap(([, items]) => items).find((i) => i.key === current && i.show(me) && !i.section && RENDER[i.key])
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
  // key — свой экран у каждого пункта: «Мой профиль» и «Врачи» не делят открытую карточку
  if (found) {
    return (
      <div key={found.key} className="settings-item">
        <Suspense fallback={<Loading />}>{RENDER[found.key]!(found.title)(me, back, { ticketId: initialTicket })}</Suspense>
      </div>
    )
  }

  return (
    <div className="settings">
      <header className="toolbar"><h1>Настройки</h1></header>
      <Profile me={me} />
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
                  <button type="button" className="settings-link" onClick={() => (i.section ? openSection(i.section) : openSettings(i.key))}>
                    <span className="settings-emoji" aria-hidden="true">{SETTINGS_EMOJI[i.key]}</span>
                    <span className="settings-text"><strong>{i.title}</strong><span className="hint" title={i.hint}>{i.hint}</span></span>
                    <span aria-hidden="true" className="chev">›</span>
                  </button>
                </li>
              ))}
              {/* Не пункт настроек, а ссылка наружу: в Telegram откроется его браузером, Mini App остаётся */}
              {group === 'Помощь' && (
                <li>
                  <button type="button" className="settings-link" onClick={() => openLink(TISH_INSTAGRAM)}>
                    <span className="settings-emoji" aria-hidden="true">📸</span>
                    <span className="settings-text"><strong>Tish в Instagram</strong><span className="hint">{TISH_INSTAGRAM_NAME} — видео-инструкции и новости</span></span>
                    <span aria-hidden="true" className="chev">↗</span>
                  </button>
                </li>
              )}
            </ul>
          </section>
        )
      })}
      </div>
      {me.platform && (
        <section className="settings-group mobile-only">
          <h2>Платформа</h2>
          <ul className="settings-list">
            <li><button type="button" className="settings-link" onClick={() => openSection('platform')}>
              <span className="settings-emoji" aria-hidden="true">🧭</span>
              <span className="settings-text"><strong>Платформа Tish</strong><span className="hint">Клиники, тарифы, обращения</span></span><span aria-hidden="true" className="chev">›</span>
            </button></li>
          </ul>
        </section>
      )}
      <InstallApp />
      <Notifications />
      <LogoutSection />
    </div>
  )
}

const EVERYWHERE_SITE = 'Выйти на всех устройствах? Закроются все входы на сайт Tish — на всех компьютерах и телефонах, '
  + 'через Telegram и по номеру, и здесь тоже. Пароль не меняется: войти снова можно как обычно.'

const EVERYWHERE_TELEGRAM = 'Выйти на всех устройствах? Закроются все входы на сайт Tish — на всех компьютерах и телефонах, '
  + 'через Telegram и по номеру. Здесь, в Telegram, Tish останется открытым.'

/**
 * «Выйти» (только на сайте: в Telegram выходить не из чего) и «Выйти на всех устройствах» — гасит
 * все входы на сайт этого человека; из Telegram тоже: забыли выйти на компьютере клиники.
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

/** «Оформление»: тема и размер текста — сразу, на этом устройстве. Свой пункт в «Мои настройки». */
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

/**
 * Профиль сверху «Настроек»: кто вошёл — фото, имя, роль и клиника. «Изменить профиль» — телефон для
 * входа, а врачу ещё имя, фото и «о себе» (их видят пациенты при записи).
 */
function Profile({ me }: { me: Me }) {
  const own = (me.doctors ?? []).find((d) => d.id === me.doctorId)
  const roles = [me.admin ? 'руководитель' : null, me.reception ? 'регистратура' : null, isAssistant(me) ? 'ассистент врача' : null, me.doctorId != null ? 'врач' : null,
    me.owner ? 'владелец платформы' : me.platform ? 'менеджер платформы' : null].filter(Boolean)
  const clinic = me.clinic?.brandName || me.clinic?.name
  const name = own?.fullName ?? me.fullName ?? 'Без имени'
  return (
    <section className="profile-card" aria-label="Профиль">
      {own?.photoUrl ? <img className="me-photo" src={own.photoUrl} alt="" />
        : <span className="me-photo" aria-hidden="true">{me.doctorId != null ? '🧑‍⚕️' : '👤'}</span>}
      <div className="profile-text">
        <strong>{name}</strong>
        <span className="hint">{roles.join(' · ') || 'сотрудник'}</span>
        {clinic && <span className="hint">🏥 {clinic}</span>}
        {own?.about && <span className="profile-about">{own.about}</span>}
      </div>
      <button type="button" className="btn" onClick={() => openSettings('profile')}>Изменить профиль</button>
    </section>
  )
}
