import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import type { AccountTab } from '../account/AccountPage'
import { logout, logoutEverywhere, type Schemas } from '../api/client'
import type { ClinicTab } from '../clinic/ClinicPage'
import { TISH_INSTAGRAM, TISH_INSTAGRAM_NAME } from '../lib/brand'
import { openSection, openSettings, settingsItem, type Page } from '../lib/route'
import { ask, notify } from '../lib/confirm'
import { openLink, telegram } from '../lib/telegram'
import { setTextSize, setThemeChoice, TEXT_SIZES, textSize, themeChoice, THEMES } from '../lib/theme'
import type { TeamTab } from '../team/TeamPage'
import { isAssistant, seesAllMoney } from '../lib/roles'
import { InstallApp } from '../pwa/InstallApp'
import { Notifications } from '../pwa/Notifications'
import { PasswordSection } from './PasswordSection'
import { Loading } from '../layout/Loading'

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
const SurveyPage = lazy(() => import('../survey/SurveyPage').then((m) => ({ default: m.SurveyPage })))

type Me = Schemas['BookingViewsMe']

/** Значки пунктов — как в меню прежнего приложения. */
const EMOJI: Record<string, string> = { 'about': '🏥', 'doctors': '👩‍⚕️', 'services': '🦷', 'hours': '🕘', 'reminder': '🔔', 'questions': '🩺', 'memos': '📋', 'learn': '📖', 'patient-news': '📰', 'sources': '📣', 'plan': '💳', 'agreement': '📄', 'data': '📦', 'ai': '✨', 'profile': '🧑‍⚕️', 'calendar': '📅', 'guide': '📘', 'support': '🛟', 'survey': '📝', 'dental-news': '📚', 'privacy': '🔒' }

type Item = {
  key: string
  title: string
  hint: string
  show: (me: Me) => boolean
  render: (me: Me, back: () => void, extra: { ticketId?: number }) => ReactNode
  /** Не в списке, но открывается по адресу (старые ссылки, кнопки бота) */
  hidden?: boolean
  /** Не свой экран, а ссылка на раздел меню */
  section?: Page
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
 * Пункты «Настроек» группами — в порядке «от клиники к себе»: клиника (о ней, персонал, услуги,
 * рабочее время) → что получают пациенты (напоминание, анкета, памятки, презентации, новости,
 * откуда приходят) → аккаунт клиники (тариф, договор, данные, ИИ) → моё (профиль, календарь) →
 * помощь. Каждый пункт — свой экран с «‹ Настройки» назад.
 *
 * Объединены (2026-11-05): «Часы и смены» + «Перерывы и выходные» → «Рабочее время» (вкладки);
 * «Откуда узнают» + «Промокоды» → «Откуда приходят пациенты»; «Помощь» + «Техподдержка» →
 * «Помощь и техподдержка». Старые адреса (#/settings/timeoff, /shifts, /promo, /help — закладки,
 * кнопки бота, напоминания) — скрытые пункты: открывают нужную вкладку.
 */
const GROUPS: [string, Item[]][] = [
  ['Клиника', [
    item('about', 'О клинике', 'Адрес, контакты, предоплата, склад', all, clinic('about')),
    // Врачи и сотрудники — одним списком с ролями; адрес «doctors» прежний (#/settings/members ведёт сюда же)
    item('doctors', 'Персонал', 'Врачи, админы, регистратура, ассистенты — роли и вход', all, team('doctors')),
    // Ассистенту цены не показываем — и пункта «Услуги» у него нет
    item('services', 'Услуги и цены', 'Цены, длительность, материалы и памятки', (me) => !isAssistant(me), clinic('services')),
    // Кто и когда работает — один пункт с вкладками: часы врачей, смены персонала, перерывы
    item('hours', 'Рабочее время', 'Часы врачей, смены, перерывы и выходные', all, () => (me, back) => <WorkTimePage me={me} onBack={back} initial="doctors" />),
    // Старые адреса: «График смен» (кнопка бота «Кто на смене») и «Перерывы и выходные» — та же страница
    { ...item('shifts', 'Рабочее время', '', all, () => (me, back) => <WorkTimePage me={me} onBack={back} initial="shifts" />), hidden: true },
    { ...item('timeoff', 'Рабочее время', '', all, () => (me, back) => <WorkTimePage me={me} onBack={back} initial="timeoff" />), hidden: true },
  ]],
  ['Пациентам', [
    // От имени клиники всем пациентам — меняет только админ (сервер: 403 остальным)
    item('reminder', 'Текст напоминания', 'Что пациент получит перед приёмом', admin,
      () => (me, back) => <ReminderTextPage me={me} onBack={back} />),
    item('questions', 'Анкета пациента', 'Вопросы перед первым приёмом', (me) => Boolean(me.admin || me.doctorId != null), clinic('questions')),
    item('memos', 'Памятки после процедур', 'Что делать после удаления, чистки…', all, clinic('memos')),
    // Атлас и презентации — раздел меню «Для пациента»; здесь ссылка на него: на телефоне в нижнем меню
    // для него нет места. Старый адрес #/settings/learn ведёт туда же (lib/route)
    { ...item('learn', 'Для пациента', '3D-атлас и презентации — раздел меню', all, () => () => null), section: 'learn' },
    item('patient-news', 'Новости для пациентов', 'Акции и объявления в боте', admin, clinic('news')),
    // «Откуда узнал» и промокоды — оба про то, какая реклама работает
    item('sources', 'Откуда приходят пациенты', 'Варианты «откуда узнал» и промокоды рекламы', all,
      () => (me, back) => <SourcesPage me={me} onBack={back} initial="sources" />),
    { ...item('promo', 'Откуда приходят пациенты', '', (me) => !isAssistant(me), () => (me, back) => <SourcesPage me={me} onBack={back} initial="promo" />), hidden: true },
  ]],
  ['Аккаунт клиники', [
    item('plan', 'Тариф и оплата', 'Сколько осталось и как продлить', admin, account('plan')),
    item('agreement', 'Договор', 'Договор с платформой Tish', admin, account('agreement')),
    item('data', 'Данные', 'Выгрузка и журнал действий', (me) => admin(me) || seesAll(me), account('data')),
    // Согласие клиники на ИИ — решает админ (сервер: 403 остальным); отчёты и диктовка — отдельно
    item('ai', 'ИИ-помощник', 'Отчёты пациенту и разбор диктовки', admin, () => (_me, back) => <AiPage onBack={back} />),
  ]],
  ['Мои настройки', [
    // Телефон для входа по номеру — у всех; врачу ещё имя, фото и «о себе»
    // В списке не показываем: тот же экран открывает «Изменить профиль» в карточке профиля наверху
    { ...item('profile', 'Мой профиль', 'Телефон для входа; врачу — имя, фото и «о себе»', all,
      () => (me, back) => <ProfilePage me={me} onBack={back} />), hidden: true },
    // Лента — приёмы своего кресла: у кого его нет (админ, регистратура, ассистент), пункта нет
    item('calendar', 'Календарь в телефоне', 'Приёмы в Google или Apple Календаре', (me) => me.doctorId != null,
      () => (_me, back) => <CalendarPage onBack={back} />),
  ]],
  ['Помощь', [
    // Одно место для обучения: видео, коротко по роли и ссылка на полное руководство с картинками
    item('guide', 'Руководство', 'Видео, коротко по вашей роли и подробно с картинками', all,
      () => (me, back) => <GuidePage me={me} onBack={back} />),
    // Помощник (ответит сразу) и обращения к команде Tish — одна страница
    item('support', 'Помощь и техподдержка', 'Спросить помощника или написать команде Tish', all, account('support')),
    // «Спросить помощника» (руководство, старые ссылки) — та же страница, сразу чат
    { ...item('help', 'Помощь и техподдержка', '', all,
      (title) => (me, back) => <AccountPage me={me} only="support" title={title} onBack={back} initialHelp />), hidden: true },
    // Опросы команды Tish проходят сотрудники клиник; команда платформы их составляет
    item('survey', 'Отзыв о Tish', 'Опрос команды Tish — 2–3 минуты', (me) => !me.platform,
      () => (_me, back) => <SurveyPage onBack={back} />),
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
        <Suspense fallback={<Loading />}>{found.render(me, back, { ticketId: initialTicket })}</Suspense>
      </div>
    )
  }

  return (
    <div className="settings">
      <header className="toolbar"><h1>Настройки</h1></header>
      <Profile me={me} />
      <div className="settings-groups">
      {GROUPS.map(([group, items], index) => {
        const shown = items.filter((i) => !i.hidden && i.show(me))
        if (!shown.length) return null
        return (
          <section key={group} className="settings-group" data-group={index}>
            <h2>{group}</h2>
            <ul className="settings-list">
              {shown.map((i) => (
                <li key={i.key}>
                  <button type="button" className="settings-link" onClick={() => (i.section ? openSection(i.section) : openSettings(i.key))}>
                    <span className="settings-emoji" aria-hidden="true">{EMOJI[i.key]}</span>
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
      {/* Пароль — только у входа по номеру (на сайте; в Telegram такого входа нет) */}
      {!telegram() && <PasswordSection />}
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
 * Профиль сверху «Настроек»: кто вошёл — фото, имя, роль и клиника. «Изменить профиль» — телефон для
 * входа, а врачу ещё имя, фото и «о себе» (их видят пациенты при записи).
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
      <button type="button" className="btn" onClick={() => openSettings('profile')}>Изменить профиль</button>
    </section>
  )
}
