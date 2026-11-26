import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { openMine } from '../lib/route'
import { fetchTour, TOUR_KEY, useFirstScreen } from '../tour/state'

type Me = Schemas['BookingViewsMe']

/** Закрыли подсказку — не показываем больше (в localStorage только «1», без личных данных). */
const HIDDEN = 'crm.profile-notice.hidden'

/** Закрыли «Добавьте почту» — тоже больше не показываем (только «1»). */
const EMAIL_HIDDEN = 'crm.email-notice.hidden'

/** Подсказка после входа, если почты нет: «а если забуду пароль?» — код придёт на неё. */
export const ADD_EMAIL = 'Добавьте почту в «Мой профиль»: забудете пароль — код для нового придёт на неё.'

function readHidden(key = HIDDEN): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function remember(key: string) {
  try {
    localStorage.setItem(key, '1')
  } catch {
    // приватный режим — скрыто до перезагрузки
  }
}

/**
 * «Заполните свой профиль» — когда своё о себе пусто: у врача нет фото или «Кратко о себе» (их видят
 * пациенты в боте), у остального персонала — нет имени. Админ только приглашает, дальше каждый заполняет
 * себя сам — подсказка ведёт в «Мой профиль» (нажмите на себя внизу меню). Не навязчиво: ✕ — и больше не покажем.
 * <p>
 * Профиль заполнен, а почты нет — «Добавьте почту» (2026-11-26): только тем, кто входит по номеру и паролю (у них есть
 * «Забыли пароль?»), и только если на сервере настроена почта. Одна плашка за раз, своя ✕ — и тоже навсегда.
 */
export function ProfileNotice({ me }: { me: Me }) {
  const [hidden, setHidden] = useState(() => readHidden())
  const [emailHidden, setEmailHidden] = useState(() => readHidden(EMAIL_HIDDEN))
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
    queryFn: fetchTour,
    enabled: Boolean(me.doctor),
    staleTime: Infinity,
    retry: false,
  })
  const tourFirst = Boolean(me.doctor) && (tour.isPending || (tour.isSuccess && !tour.data.seenAt))
  const text = hidden || tourFirst ? false : doctor
    ? (!doctor.photoUrl || !doctor.about?.trim()) && 'Заполните свой профиль — его видят пациенты: фото и пару слов о себе.'
    : name.data?.editable && !name.data.fullName?.trim() && 'Заполните свой профиль — укажите имя: так вас видят коллеги.'
  // Почта — когда о профиле сказать нечего (имя не-врача уже пришло)
  const profileDone = !text && !tourFirst && !name.isLoading
  const email = useQuery({
    queryKey: ['me-email'],
    queryFn: () => unwrap(api.GET('/api/me/email')),
    enabled: Boolean(me.doctor) && profileDone && !emailHidden,
    staleTime: 10 * 60_000,
  })
  const emailText = profileDone && !emailHidden && email.data?.available && email.data.phoneLogin && !email.data.email ? ADD_EMAIL : ''
  // Тур идёт первым — плашка его не задерживает; отметка остаётся на случай, если тур запустят снова
  useFirstScreen('profile', !tourFirst && ((!hidden && (name.isLoading || Boolean(text))) || (profileDone && !emailHidden && (email.isLoading || Boolean(emailText)))))
  if (!text && !emailText) return null
  const hide = () => {
    if (text) {
      setHidden(true)
      remember(HIDDEN)
    } else {
      setEmailHidden(true)
      remember(EMAIL_HIDDEN)
    }
  }
  return (
    <section className="notices" aria-label={text ? 'Заполните профиль' : 'Добавьте почту'}>
      <div className="notice tone-wait">
        <span className="notice-ico" aria-hidden="true">i</span>
        <button type="button" className="notice-text" onClick={() => openMine('me', 'profile')}>
          {text || emailText}{' '}<span className="notice-open" aria-hidden="true">{text ? 'Изменить профиль ›' : 'Добавить почту ›'}</span>
        </button>
        <button type="button" className="notice-close" aria-label="Скрыть подсказку" title="Скрыть подсказку" onClick={hide}>✕</button>
      </div>
    </section>
  )
}
