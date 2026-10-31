import type { ReactNode } from 'react'

import type { Schemas } from '../api/client'
import type { Page } from '../lib/route'
import { telegram } from '../lib/telegram'
import { AdminNotices } from './AdminNotices'
import { Icon } from './Icon'

type Me = Schemas['BookingViewsMe']

/** Выйти на сайте: сервер гасит cookie-сессию — снова экран входа. В Telegram выходить не из чего. */
async function logout(): Promise<void> {
  await fetch('/web/logout', { method: 'POST', headers: { 'X-Dental-Web': '1' } }).catch(() => null)
  window.location.reload()
}

/** Разделы клиники — сотрудникам; «Платформа» — команде Tish (владелец и менеджеры). */
const CLINIC_SECTIONS = [
  { key: 'schedule', title: 'Расписание' },
  { key: 'patients', title: 'Пациенты' },
  { key: 'cash', title: 'Касса' },
  { key: 'stock', title: 'Склад' },
  { key: 'team', title: 'Команда' },
  { key: 'clinic', title: 'Клиника' },
  { key: 'account', title: 'Аккаунт' },
] as const
const PLATFORM = { key: 'platform', title: 'Платформа' } as const

function sectionsOf(me: Me): readonly { key: Page; title: string }[] {
  return [...(me.doctor ? CLINIC_SECTIONS : []), ...(me.platform ? [PLATFORM] : [])]
}

/** Раскладка CRM: меню слева (разделы — по ролям), рабочая область. */
export function Shell({ me, page, onNavigate, children }: { me: Me; page: Page; onNavigate: (page: Page) => void; children: ReactNode }) {
  const clinic = me.doctor ? me.clinic?.brandName || me.clinic?.name || 'Клиника' : 'Команда Tish'
  const role = !me.doctor ? (me.owner ? 'владелец платформы' : 'менеджер платформы')
    : me.admin ? 'администратор' : me.reception ? 'регистратура' : 'врач'
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}tooth.svg`} alt="" width={28} height={28} />
          <span>Tish</span>
        </div>
        <div className="clinic">
          <strong>{clinic}</strong>
          <span>{me.fullName ? `${me.fullName} · ` : ''}{role}</span>
        </div>
        <nav aria-label="Разделы">
          {sectionsOf(me).map((s) => (
            <button key={s.key} type="button" className={s.key === page ? 'nav active' : 'nav'}
              aria-current={s.key === page ? 'page' : undefined} onClick={() => onNavigate(s.key)}>
              <Icon name={s.key} /> <span>{s.title}</span>
            </button>
          ))}
        </nav>
        {!telegram() && (
          <button type="button" className="nav link-out" onClick={() => void logout()}><Icon name="external" /> <span>Выйти</span></button>
        )}
      </aside>
      <main className="workspace"><AdminNotices me={me} onNavigate={onNavigate} />{children}</main>
    </div>
  )
}
