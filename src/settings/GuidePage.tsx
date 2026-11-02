import { useState } from 'react'

import type { Schemas } from '../api/client'
import { GUIDES, ORDER, ownRole, type Role } from './guides'
import { SubHeader } from './SubHeader'

type Me = Schemas['BookingViewsMe']

/** «Памятка»: коротко, как записать, напомнить и принять оплату — для каждой роли. */
export function GuidePage({ me, onBack }: { me: Me; onBack: () => void }) {
  const [role, setRole] = useState<Role>(() => ownRole(me))
  const guide = GUIDES[role]
  return (
    <div className="schedule-main">
      <SubHeader title="Памятка" onBack={onBack} />
      <div className="segments wrap" role="group" aria-label="Роль">
        {ORDER.map((r) => (
          <button key={r} type="button" aria-pressed={role === r} onClick={() => setRole(r)}>{GUIDES[r].label}</button>
        ))}
      </div>
      <p className="hint">{guide.intro}</p>
      {guide.topics.map((t) => (
        <section key={t.title} className="card-block guide" aria-label={t.title}>
          <h2>{t.title}</h2>
          <ol>{t.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        </section>
      ))}
    </div>
  )
}
