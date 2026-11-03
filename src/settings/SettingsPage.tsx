import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import type { AccountTab } from '../account/AccountPage'
import { logout, type Schemas } from '../api/client'
import type { ClinicTab } from '../clinic/ClinicPage'
import { TISH_INSTAGRAM, TISH_INSTAGRAM_NAME } from '../lib/brand'
import { openSettings, settingsItem } from '../lib/route'
import { openLink, telegram } from '../lib/telegram'
import { setTextSize, setThemeChoice, TEXT_SIZES, textSize, themeChoice, THEMES } from '../lib/theme'
import type { TeamTab } from '../team/TeamPage'
import { isAssistant, seesAllMoney } from '../lib/roles'
import { InstallApp } from '../pwa/InstallApp'
import { Notifications } from '../pwa/Notifications'
import { guideRole, guideUrl } from './guides'

// Экраны пунктов — своими чанками: список «Настроек» открывается сразу (~10 КБ вместо ~110 КБ),
// код «Договора» или «Услуг» скачивается, только когда пункт открыли
const AccountPage = lazy(() => import('../account/AccountPage').then((m) => ({ default: m.AccountPage })))
const ClinicPage = lazy(() => import('../clinic/ClinicPage').then((m) => ({ default: m.ClinicPage })))
const TeamPage = lazy(() => import('../team/TeamPage').then((m) => ({ default: m.TeamPage })))
const HoursPage = lazy(() => import('./HoursPage').then((m) => ({ default: m.HoursPage })))
const GuidePage = lazy(() => import('./GuidePage').then((m) => ({ default: m.GuidePage })))
const CalendarPage = lazy(() => import('./CalendarPage').then((m) => ({ default: m.CalendarPage })))
const ProfilePage = lazy(() => import('./ProfilePage').then((m) => ({ default: m.ProfilePage })))
const SurveyPage = lazy(() => import('../survey/SurveyPage').then((m) => ({ default: m.SurveyPage })))

type Me = Schemas['BookingViewsMe']

/** Значки пунктов — как в меню прежнего приложения. */
const EMOJI: Record<string, string> = { 'hours': '🕘', 'timeoff': '☕', 'services': '🦷', 'memos': '📋', 'doctors': '👩‍⚕️', 'members': '🗂️', 'about': '🏥', 'questions': '🩺', 'sources': '📣', 'promo': '🎟', 'patient-news': '📰', 'plan': '💳', 'agreement': '📄', 'data': '📦', 'profile': '🧑‍⚕️', 'calendar': '📅', 'support': '🛟', 'dental-news': '📚', 'privacy': '🔒', 'guide': '📘', 'help': '💬', 'survey': '📝' }

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
const seesAll = (me: Me) => seesAllMoney(me)

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
    item('services', 'Услуги', 'Цены и длительность приёмов', (me) => !isAssistant(me), clinic('services')),
    item('memos', 'Памятки после процедур', 'Что делать после удаления, чистки…', all, clinic('memos')),
  ]],
  ['Клиника', [
    item('doctors', 'Врачи', 'Профиль, фото, приглашение, права', all, team('doctors')),
    item('members', 'Сотрудники', 'Админы, регистратура, ассистенты', admin, team('members')),
    item('about', 'О клинике', 'Адрес, контакты, предоплата, склад', all, clinic('about')),
    item('questions', 'Анкета пациента', 'Вопросы перед первым приёмом', (me) => Boolean(me.admin || me.doctorId != null), clinic('questions')),
    item('sources', 'Откуда узнают о клинике', 'Варианты в карточке и вопрос в боте', all, clinic('sources')),
    // Ассистенту — нет: записи с кодом ставят врач и регистратура, отчёт ему не нужен
    item('promo', 'Промокоды', 'Код для рекламы и работает ли он', (me) => !isAssistant(me), clinic('promo')),
    item('patient-news', 'Новости для пациентов', 'Акции и объявления в боте', admin, clinic('news')),
  ]],
  ['Аккаунт клиники', [
    item('plan', 'Тариф и оплата', 'Сколько осталось и как продлить', admin, account('plan')),
    item('agreement', 'Договор', 'Договор с платформой Tish', admin, account('agreement')),
    item('data', 'Данные', 'Выгрузка и журнал действий', (me) => admin(me) || seesAll(me), account('data')),
  ]],
  ['Профиль и помощь', [
    item('profile', 'Мой профиль', 'Имя, фото и «о себе» для пациентов', (me) => me.doctorId != null,
      () => (me, back) => <ProfilePage me={me} onBack={back} />),
    // Лента — приёмы своего кресла: у кого его нет (админ, регистратура, ассистент), пункта нет
    item('calendar', 'Календарь в телефоне', 'Приёмы в Google или Apple Календаре', (me) => me.doctorId != null,
      () => (_me, back) => <CalendarPage onBack={back} />),
    item('guide', 'Памятка', 'Как записать, напомнить, принять оплату', all,
      () => (me, back) => <GuidePage me={me} onBack={back} />),
    item('help', 'Помощь', 'Спросить помощника о Tish — ответит сразу', all,
      (title) => (me, back) => <AccountPage me={me} only="support" title={title} onBack={back} initialHelp />),
    // Опросы команды Tish проходят сотрудники клиник; команда платформы их составляет
    item('survey', 'Отзыв о Tish', 'Опрос команды Tish — 2–3 минуты', (me) => !me.platform,
      () => (_me, back) => <SurveyPage onBack={back} />),
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
        <Suspense fallback={<p className="hint">Загрузка…</p>}>{found.render(me, back, { ticketId: initialTicket })}</Suspense>
      </div>
    )
  }

  return (
    <div className="settings">
      <header className="toolbar"><h1>Настройки</h1></header>
      <Profile me={me} />
      <div className="settings-groups">
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
                    <span className="settings-text"><strong>{i.title}</strong><span className="hint" title={i.hint}>{i.hint}</span></span>
                    <span aria-hidden="true" className="chev">›</span>
                  </button>
                </li>
              ))}
              {/* Не пункты настроек, а ссылки наружу: в Telegram откроются его браузером, Mini App остаётся */}
              {group === 'Профиль и помощь' && (
                <li>
                  <button type="button" className="settings-link" onClick={() => openLink(guideUrl(guideRole(me)))}>
                    <span className="settings-emoji" aria-hidden="true">📖</span>
                    <span className="settings-text"><strong>Руководство</strong><span className="hint">Подробно, с картинками — для вашей роли</span></span>
                    <span aria-hidden="true" className="chev">↗</span>
                  </button>
                </li>
              )}
              {group === 'Профиль и помощь' && (
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
            <li><button type="button" className="settings-link" onClick={() => { window.location.hash = '/platform' }}>
              <span className="settings-emoji" aria-hidden="true">🧭</span>
              <span className="settings-text"><strong>Платформа Tish</strong><span className="hint">Клиники, тарифы, обращения</span></span><span aria-hidden="true" className="chev">›</span>
            </button></li>
          </ul>
        </section>
      )}
      <Appearance />
      <InstallApp />
      <Notifications />
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
      <h2>Оформление</h2>
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
