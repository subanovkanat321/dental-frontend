import { useEffect, useState, type ReactNode } from 'react'

import { AccountPage, type AccountTab } from '../account/AccountPage'
import type { Schemas } from '../api/client'
import { ClinicPage, type ClinicTab } from '../clinic/ClinicPage'
import { openSettings, settingsItem } from '../lib/route'
import { telegram } from '../lib/telegram'
import { setTextSize, setThemeChoice, TEXT_SIZES, textSize, themeChoice, THEMES } from '../lib/theme'
import { TeamPage, type TeamTab } from '../team/TeamPage'
import { HoursPage } from './HoursPage'

type Me = Schemas['BookingViewsMe']

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
    item('services', 'Услуги', 'Цены и длительность — для записи и самозаписи', all, clinic('services')),
  ]],
  ['Клиника', [
    item('doctors', 'Врачи', 'Профиль, фото, приглашение, права', all, team('doctors')),
    item('members', 'Сотрудники', 'Администраторы и регистратура', admin, team('members')),
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
      (title) => (me, back) => <TeamPage me={me} only="doctors" title={title} onBack={back} initialOpened={me.doctorId ?? null} />),
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
  if (found) return <div className="settings-item">{found.render(me, back, { ticketId: initialTicket })}</div>

  return (
    <div className="settings">
      <header className="toolbar"><h1>Настройки</h1></header>
      {GROUPS.map(([group, items]) => {
        const shown = items.filter((i) => i.show(me))
        if (!shown.length) return null
        return (
          <section key={group} className="settings-group">
            <h2>{group}</h2>
            <ul className="settings-list">
              {shown.map((i) => (
                <li key={i.key}>
                  <button type="button" className="settings-link" onClick={() => openSettings(i.key)}>
                    <span><strong>{i.title}</strong><span className="hint">{i.hint}</span></span>
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
              <span><strong>Платформа Tish</strong><span className="hint">Клиники, тарифы, обращения</span></span><span aria-hidden="true" className="chev">›</span>
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

async function logout(): Promise<void> {
  await fetch('/web/logout', { method: 'POST', headers: { 'X-Dental-Web': '1' } }).catch(() => null)
  window.location.reload()
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
