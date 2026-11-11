import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { openMine } from '../lib/route'
import { TOUR_KEY, useFirstScreen } from '../tour/state'

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
 * себя сам — подсказка ведёт в «Мой профиль» (нажмите на себя внизу меню). Не навязчиво: ✕ — и больше не покажем.
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
  // Сначала тур при первом входе, плашка — после него: пока тур не пройден (или ответ ещё не пришёл), её нет.
  // Ошибка запроса тура — плашку не прячем
  const tour = useQuery({
    queryKey: TOUR_KEY,
    queryFn: () => unwrap(api.GET('/api/me/tour')),
    enabled: Boolean(me.doctor),
    staleTime: Infinity,
    retry: false,
  })
  const tourFirst = Boolean(me.doctor) && (tour.isPending || (tour.isSuccess && !tour.data.seenAt))
  const text = hidden || tourFirst ? false : doctor
    ? (!doctor.photoUrl || !doctor.about?.trim()) && 'Заполните свой профиль — его видят пациенты: фото и пару слов о себе.'
    : name.data?.editable && !name.data.fullName?.trim() && 'Заполните свой профиль — укажите имя: так вас видят коллеги.'
  // Тур идёт первым — плашка его не задерживает; отметка остаётся на случай, если тур запустят снова
  useFirstScreen('profile', !hidden && !tourFirst && (name.isLoading || Boolean(text)))
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
        <button type="button" className="notice-text" onClick={() => openMine('me', 'profile')}>
          {text}{' '}<span className="notice-open" aria-hidden="true">Изменить профиль ›</span>
        </button>
        <button type="button" className="notice-close" aria-label="Скрыть подсказку" title="Скрыть подсказку" onClick={hide}>✕</button>
      </div>
    </section>
  )
}
