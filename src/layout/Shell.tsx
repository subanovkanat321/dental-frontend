import { useState, type ReactNode } from 'react'

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
  { key: 'settings', title: 'Настройки' },
] as const
const PLATFORM = { key: 'platform', title: 'Платформа' } as const

function sectionsOf(me: Me): readonly { key: Page; title: string }[] {
  return [...(me.doctor ? CLINIC_SECTIONS : []), ...(me.platform ? [PLATFORM] : [])]
}

/** На телефоне внизу помещается 4 раздела и «Ещё»: остальное — в выезжающем меню. */
const MOBILE_MAIN = 4

/**
 * Раскладка CRM: меню слева (разделы — по ролям), рабочая область. На телефоне меню — полоса внизу:
 * расписание, пациенты, касса, склад и «Настройки» (шестерёнка); у команды платформы — ещё «Ещё».
 */
export function Shell({ me, page, onNavigate, children }: { me: Me; page: Page; onNavigate: (page: Page) => void; children: ReactNode }) {
  const clinic = me.doctor ? me.clinic?.brandName || me.clinic?.name || 'Клиника' : 'Команда Tish'
  const role = !me.doctor ? (me.owner ? 'владелец платформы' : 'менеджер платформы')
    : me.admin ? 'администратор' : me.reception ? 'регистратура' : 'врач'
  const sections = sectionsOf(me)
  // «Платформа» у сотрудника клиники на телефоне — в «Настройках»: внизу пять кнопок без «Ещё»
  const extra = me.doctor ? sections.filter((x) => x.key === 'platform')
    : sections.length > MOBILE_MAIN + 1 ? sections.slice(MOBILE_MAIN) : []
  const moreButton = extra.length > 0 && !me.doctor
  const [more, setMore] = useState(false)
  const go = (key: Page) => {
    setMore(false)
    onNavigate(key)
  }
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
          {sections.map((s) => (
            <button key={s.key} type="button" className={['nav', s.key === page ? 'active' : '', extra.includes(s) ? 'extra' : ''].join(' ').trim()}
              aria-current={s.key === page ? 'page' : undefined} onClick={() => go(s.key)}>
              <Icon name={s.key} /> <span>{s.title}</span>
            </button>
          ))}
          {moreButton && (
            <button type="button" className={extra.some((s) => s.key === page) || more ? 'nav more active' : 'nav more'}
              aria-expanded={more} onClick={() => setMore(!more)}>
              <Icon name="more" /> <span>Ещё</span>
            </button>
          )}
        </nav>
        {!telegram() && (
          <button type="button" className="nav link-out" onClick={() => void logout()}><Icon name="external" /> <span>Выйти</span></button>
        )}
      </aside>
      {more && (
        <div className="more-sheet" role="dialog" aria-label="Ещё разделы" onClick={() => setMore(false)}>
          <div className="more-card" onClick={(e) => e.stopPropagation()}>
            <p className="more-who"><strong>{clinic}</strong><span className="hint">{me.fullName ? `${me.fullName} · ` : ''}{role}</span></p>
            {extra.map((s) => (
              <button key={s.key} type="button" className={s.key === page ? 'more-item active' : 'more-item'} onClick={() => go(s.key)}>
                <Icon name={s.key} /> <span>{s.title}</span>
              </button>
            ))}
            {!telegram() && <button type="button" className="more-item" onClick={() => void logout()}><Icon name="external" /> <span>Выйти</span></button>}
          </div>
        </div>
      )}
      {/* Напоминания админу — на главном экране, чтобы не занимать место в каждом разделе */}
      <main className="workspace">{page === 'schedule' && <AdminNotices me={me} />}{children}</main>
    </div>
  )
}
