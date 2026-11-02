import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'

import type { AccountTab } from '../account/AccountPage'
import { logout, type Schemas } from '../api/client'
import type { ClinicTab } from '../clinic/ClinicPage'
import { openSettings, settingsItem } from '../lib/route'
import { telegram } from '../lib/telegram'
import { setTextSize, setThemeChoice, TEXT_SIZES, textSize, themeChoice, THEMES } from '../lib/theme'
import type { TeamTab } from '../team/TeamPage'
import { isAssistant } from '../lib/roles'

// Экраны пунктов — своими чанками: список «Настроек» открывается сразу (~10 КБ вместо ~110 КБ),
// код «Договора» или «Услуг» скачивается, только когда пункт открыли
const AccountPage = lazy(() => import('../account/AccountPage').then((m) => ({ default: m.AccountPage })))
const ClinicPage = lazy(() => import('../clinic/ClinicPage').then((m) => ({ default: m.ClinicPage })))
const TeamPage = lazy(() => import('../team/TeamPage').then((m) => ({ default: m.TeamPage })))
const HoursPage = lazy(() => import('./HoursPage').then((m) => ({ default: m.HoursPage })))
const GuidePage = lazy(() => import('./GuidePage').then((m) => ({ default: m.GuidePage })))
const ProfilePage = lazy(() => import('./ProfilePage').then((m) => ({ default: m.ProfilePage })))

type Me = Schemas['BookingViewsMe']

/** Значки пунктов — как в меню прежнего приложения. */
const EMOJI: Record<string, string> = { 'hours': '🕘', 'timeoff': '☕', 'services': '🦷', 'doctors': '👩‍⚕️', 'members': '🗂️', 'about': '🏥', 'questions': '🩺', 'patient-news': '📰', 'plan': '💳', 'agreement': '📄', 'data': '📦', 'profile': '🧑‍⚕️', 'support': '🛟', 'dental-news': '📚', 'privacy': '🔒', 'guide': '📘' }

type Item = {
  key: string
  title: string
  hint: string
  show: (me: Me) => boolean
  render: (me: Me, back: () => void, extra: { ticketId?: number }) => ReactNode
}

const team = (only: TeamTab) => (title: string) => (me: Me, back: () => void) => <TeamPage me={me} only={only} title={title} onBack={back} />
const clinic = (only: ClinicTab) => (title: string) => (me: Me, back: () => void) => <ClinicPage me={me} only={only} title={title} onBack={back} />
const account = (only: AccountTab) => (title: string) => (me: Me, back: () => void, extra: { ticketId?: number }) =>
  <AccountPage me={me} only={only} title={title} onBack={back} initialTicket={extra.ticketId} />

const all = () => true
const admin = (me: Me) => Boolean(me.admin)
const seesAll = (me: Me) => Boolean(me.admin && !me.clinic?.independentDoctors)

function item(key: string, title: string, hint: string, show: Item['show'], render: (title: string) => Item['render']): Item {
  return { key, title, hint, show, render: render(title) }
}

/**
 * Пункты «Настроек» группами — как меню прежнего приложения (шестерёнка): расписание, клиника,
 * аккаунт, профиль и помощь. Каждый пункт — свой экран с «‹ Настройки» назад.
 */
const GROUPS: [string, Item[]][] = [
  ['Расписание', [
    item('hours', 'Часы работы', 'Часы клиники и каждого врача', all, () => (me, back) => <HoursPage me={me} onBack={back} />),
    item('timeoff', 'Перерывы и выходные', 'Обед, намаз, отпуск, праздники', all, team('timeoff')),
    // Ассистенту цены не показываем — и пункта «Услуги» у него нет
    item('services', 'Услуги', 'Цены и длительность — для записи и самозаписи', (me) => !isAssistant(me), clinic('services')),
  ]],
  ['Клиника', [
    item('doctors', 'Врачи', 'Профиль, фото, приглашение, права', all, team('doctors')),
    item('members', 'Сотрудники', 'Администраторы, регистратура и ассистенты', admin, team('members')),
    item('about', 'О клинике', 'Адрес, контакты, работа с компьютера, склад врачей, предоплата', all, clinic('about')),
    item('questions', 'Анкета пациента', 'Вопросы перед первым приёмом', (me) => Boolean(me.admin || me.doctorId != null), clinic('questions')),
    item('patient-news', 'Новости для пациентов', 'Акции и объявления в боте', admin, clinic('news')),
  ]],
  ['Аккаунт клиники', [
    item('plan', 'Тариф и оплата', 'Сколько осталось и как продлить', admin, account('plan')),
    item('agreement', 'Договор', 'Договор с платформой Tish', admin, account('agreement')),
    item('data', 'Данные', 'Выгрузка и журнал действий', (me) => admin(me) || seesAll(me), account('data')),
  ]],
  ['Профиль и помощь', [
    item('profile', 'Мой профиль', 'Имя, фото, о себе — что видят пациенты', (me) => me.doctorId != null,
      () => (me, back) => <ProfilePage me={me} onBack={back} />),
    item('guide', 'Памятка', 'Как записать, напомнить и принять оплату — по ролям', all,
      () => (me, back) => <GuidePage me={me} onBack={back} />),
    item('support', 'Техподдержка', 'Написать команде Tish, частые вопросы', all, account('support')),
    item('dental-news', 'Новости стоматологии', 'Подборка профессиональных изданий', all, account('news')),
    item('privacy', 'Конфиденциальность', 'Как мы обращаемся с данными пациентов', all, account('privacy')),
  ]],
]

/** «Настройки»: главная — список пунктов и оформление; пункт — во всю рабочую область. */
export function SettingsPage({ me, initialTicket }: { me: Me; initialTicket?: number }) {
  const [current, setCurrent] = useState(settingsItem)
  useEffect(() => {
    const onHash = () => setCurrent(settingsItem())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const back = () => openSettings(null)
  const found = GROUPS.flatMap(([, items]) => items).find((i) => i.key === current && i.show(me))
  // key — свой экран у каждого пункта: «Мой профиль» и «Врачи» не делят открытую карточку
  if (found) {
    return (
      <div key={found.key} className="settings-item">
        <Suspense fallback={<p className="hint">Загрузка…</p>}>{found.render(me, back, { ticketId: initialTicket })}</Suspense>
      </div>
    )
  }

  return (
    <div className="settings">
      <header className="toolbar"><h1>⚙️ Настройки</h1></header>
      <Profile me={me} />
      {GROUPS.map(([group, items], index) => {
        const shown = items.filter((i) => i.show(me))
        if (!shown.length) return null
        return (
          <section key={group} className="settings-group" data-group={index}>
            <h2>{group}</h2>
            <ul className="settings-list">
              {shown.map((i) => (
                <li key={i.key}>
                  <button type="button" className="settings-link" onClick={() => openSettings(i.key)}>
                    <span className="settings-emoji" aria-hidden="true">{EMOJI[i.key]}</span>
                    <span className="settings-text"><strong>{i.title}</strong><span className="hint">{i.hint}</span></span>
                    <span aria-hidden="true" className="chev">›</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      {me.platform && (
        <section className="settings-group mobile-only">
          <h2>Платформа</h2>
          <ul className="settings-list">
            <li><button type="button" className="settings-link" onClick={() => { window.location.hash = '/platform' }}>
              <span className="settings-emoji" aria-hidden="true">🧭</span>
              <span className="settings-text"><strong>Платформа Tish</strong><span className="hint">Клиники, тарифы, обращения</span></span><span aria-hidden="true" className="chev">›</span>
            </button></li>
          </ul>
        </section>
      )}
      <Appearance />
      {!telegram() && (
        <section className="settings-group">
          <button type="button" className="btn danger" onClick={() => void logout()}>Выйти</button>
        </section>
      )}
    </div>
  )
}

/** «Оформление»: тема и размер текста — сразу, на этом устройстве. */
function Appearance() {
  const [theme, setTheme] = useState(themeChoice)
  const [size, setSize] = useState(textSize)
  return (
    <section className="settings-group" aria-label="Оформление">
      <h2>🎨 Оформление</h2>
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
 * Профиль сверху «Настроек»: кто вошёл — фото, имя, роль и клиника. Врачу — «Изменить профиль»
 * (имя, фото, «о себе» — их видят пациенты при записи).
 */
function Profile({ me }: { me: Me }) {
  const own = (me.doctors ?? []).find((d) => d.id === me.doctorId)
  const roles = [me.admin ? 'администратор' : null, me.reception ? 'регистратура' : null, isAssistant(me) ? 'ассистент врача' : null, me.doctorId != null ? 'врач' : null,
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
      {me.doctorId != null && <button type="button" className="btn" onClick={() => openSettings('profile')}>Изменить профиль</button>}
    </section>
  )
}
