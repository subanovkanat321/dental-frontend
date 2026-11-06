import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { openSettings } from '../lib/route'

type Me = Schemas['BookingViewsMe']

/** Закрыли подсказку — не показываем больше (в localStorage только «1», без личных данных). */
const HIDDEN = 'crm.profile-notice.hidden'

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN) === '1'
  } catch {
    return false
  }
}

/**
 * «Заполните свой профиль» — когда своё о себе пусто: у врача нет фото или «Кратко о себе» (их видят
 * пациенты в боте), у остального персонала — нет имени. Админ только приглашает, дальше каждый заполняет
 * себя сам — подсказка ведёт в «Настройки → Изменить профиль». Не навязчиво: ✕ — и больше не покажем.
 */
export function ProfileNotice({ me }: { me: Me }) {
  const [hidden, setHidden] = useState(readHidden)
  const doctor = me.doctorId == null ? undefined : (me.doctors ?? []).find((d) => d.id === me.doctorId)
  // Имя не-врача — отдельным запросом (у врача имя в его карточке и обязательно)
  const name = useQuery({
    queryKey: ['me-name'],
    queryFn: () => unwrap(api.GET('/api/me/name')),
    enabled: me.doctorId == null && !hidden,
    staleTime: 10 * 60_000,
  })
  if (hidden) return null
  const text = doctor
    ? (!doctor.photoUrl || !doctor.about?.trim()) && 'Заполните свой профиль — его видят пациенты: фото и пару слов о себе.'
    : name.data?.editable && !name.data.fullName?.trim() && 'Заполните свой профиль — укажите имя: так вас видят коллеги.'
  if (!text) return null
  const hide = () => {
    setHidden(true)
    try {
      localStorage.setItem(HIDDEN, '1')
    } catch {
      // приватный режим — скрыто до перезагрузки
    }
  }
  return (
    <section className="notices" aria-label="Заполните профиль">
      <div className="notice tone-wait">
        <span className="notice-ico" aria-hidden="true">i</span>
        <button type="button" className="notice-text" onClick={() => openSettings('profile')}>
          {text}{' '}<span className="notice-open" aria-hidden="true">Изменить профиль ›</span>
        </button>
        <button type="button" className="notice-close" aria-label="Скрыть подсказку" title="Скрыть подсказку" onClick={hide}>✕</button>
      </div>
    </section>
  )
}
