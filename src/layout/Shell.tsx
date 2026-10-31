import type { ReactNode } from 'react'

import type { Schemas } from '../api/client'

type Me = Schemas['Me']

const SECTIONS = [
  { key: 'schedule', icon: '📅', title: 'Расписание', ready: true },
  { key: 'patients', icon: '👥', title: 'Пациенты', ready: false },
  { key: 'cash', icon: '💰', title: 'Касса', ready: false },
  { key: 'stock', icon: '📦', title: 'Склад', ready: false },
] as const

/** Раскладка CRM: меню слева, рабочая область; пока не перенесённое — в приложении (/). */
export function Shell({ me, children }: { me: Me; children: ReactNode }) {
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
          <span className="hint">{me.fullName ? `${me.fullName} · ` : ''}{role}</span>
        </div>
        <nav aria-label="Разделы">
          {SECTIONS.map((s) => (
            <button key={s.key} type="button" className={s.key === 'schedule' ? 'nav active' : 'nav'} disabled={!s.ready}
              title={s.ready ? undefined : 'Скоро — пока в приложении'}>
              <span aria-hidden="true">{s.icon}</span> {s.title}
              {!s.ready && <span className="soon">скоро</span>}
            </button>
          ))}
        </nav>
        <a className="nav link-out" href="/">↗ Открыть приложение</a>
      </aside>
      <main className="workspace">{children}</main>
    </div>
  )
}
