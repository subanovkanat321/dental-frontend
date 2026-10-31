import type { ReactNode } from 'react'

import type { Schemas } from '../api/client'
import type { Page } from '../lib/route'
import { Icon } from './Icon'

type Me = Schemas['BookingViewsMe']

const SECTIONS = [
  { key: 'schedule', title: 'Расписание', ready: true },
  { key: 'patients', title: 'Пациенты', ready: true },
  { key: 'cash', title: 'Касса', ready: true },
  { key: 'stock', title: 'Склад', ready: true },
  { key: 'team', title: 'Команда', ready: true },
] as const

/** Раскладка CRM: меню слева, рабочая область; пока не перенесённое — в приложении (/). */
export function Shell({ me, page, onNavigate, children }: { me: Me; page: Page; onNavigate: (page: Page) => void; children: ReactNode }) {
  const clinic = me.clinic?.brandName || me.clinic?.name || 'Клиника'
  const role = me.admin ? 'администратор' : me.reception ? 'регистратура' : 'врач'
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
          {SECTIONS.map((s) => (
            <button key={s.key} type="button" className={s.key === page ? 'nav active' : 'nav'} disabled={!s.ready}
              aria-current={s.key === page ? 'page' : undefined}
              title={s.ready ? undefined : 'Скоро — пока в приложении'} onClick={() => s.ready && onNavigate(s.key as Page)}>
              <Icon name={s.key} /> <span>{s.title}</span>
              {!s.ready && <span className="soon">скоро</span>}
            </button>
          ))}
        </nav>
        <a className="nav link-out" href="/"><Icon name="external" /> <span>Открыть приложение</span></a>
      </aside>
      <main className="workspace">{children}</main>
    </div>
  )
}
