import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { api, unwrap, type Schemas } from '../api/client'
import { useBack } from '../lib/back'
import { telegram } from '../lib/telegram'
import { TOUR_KEY, useFirstScreen } from '../tour/state'
import { launchedAsApp } from './pwa'
import { currentSubscription, permission, pushSupport } from './push'
import { PUSH_KEY, useEnablePush } from './useEnablePush'
import './pwa.css'

type Me = Schemas['BookingViewsMe']

/** «Позже» / «Оставить в Telegram» / закрыли — на этом устройстве окно больше не показываем. Не персональные данные. */
export const PUSH_PROMPT_KEY = 'crm.pushPrompt'

/** Пауза после тура: окно не выскакивает в ту же секунду, как погасло затемнение тура. */
const AFTER_TOUR_MS = 800

function dismissed(): boolean {
  try {
    return localStorage.getItem(PUSH_PROMPT_KEY) != null
  } catch {
    return false
  }
}

function remember() {
  try {
    localStorage.setItem(PUSH_PROMPT_KEY, 'done')
  } catch {
    // приватный режим — окно покажется ещё раз при следующем запуске, не страшно
  }
}

/**
 * Окно «Включить уведомления» при первом запуске установленного приложения (PWA): иначе сотрудник
 * должен сам найти «Настройки → Уведомления». Разрешение браузер даёт только по нажатию — поэтому
 * сначала наше окно, а requestPermission — из его кнопки.
 *
 * Показываем, только если всё сходится: сотрудник клиники, приложение открыто с иконки (не вкладка,
 * не Telegram Mini App), браузер умеет push и не запретил его, сервер включил push, этот браузер ещё
 * не подписан или канал не «приложение», и на этом устройстве окно ещё не закрывали. Тур первого
 * входа — раньше: окно ждёт отметку сервера «тур видел» (tour/Tour.tsx), а само, пока на экране,
 * держит тур (useFirstScreen).
 */
export function PushPrompt({ me }: { me: Me }) {
  const staff = Boolean(me.doctor)
  // Синхронные условия устройства — один раз: за время сеанса они не меняются
  const [eligible] = useState(() => staff && !telegram() && launchedAsApp() && pushSupport() === 'ok'
    && permission() !== 'denied' && !dismissed())
  const tour = useQuery({ queryKey: TOUR_KEY, queryFn: () => unwrap(api.GET('/api/me/tour')), enabled: eligible, staleTime: Infinity, retry: false })
  const tourSeen = Boolean(tour.data?.seenAt)
  const view = useQuery({ queryKey: PUSH_KEY, queryFn: () => unwrap(api.GET('/api/push')), enabled: eligible && tourSeen, retry: false })
  const [here, setHere] = useState<boolean | null>(null)
  const [ready, setReady] = useState(false)
  const [closed, setClosed] = useState(false)

  useEffect(() => {
    if (!eligible || !tourSeen) return
    let alive = true
    void currentSubscription().then((s) => { if (alive) setHere(s != null) })
    const t = window.setTimeout(() => { if (alive) setReady(true) }, AFTER_TOUR_MS)
    return () => { alive = false; window.clearTimeout(t) }
  }, [eligible, tourSeen])

  // Решаем один раз: после «В приложение» канал станет APP, но окно должно остаться с «Готово ✓»
  const [shown, setShown] = useState<{ publicKey: string; noTelegram: boolean } | null>(null)
  const data = view.data
  if (!shown && !closed && ready && here != null && data?.enabled && data.publicKey && !(here && data.channel === 'APP')) {
    setShown({ publicKey: data.publicKey, noTelegram: data.noTelegram === true })
  }
  const open = shown != null && !closed
  useFirstScreen('push-prompt', open)
  if (!open) return null
  return <PromptSheet {...shown} onClose={() => { remember(); setClosed(true) }} />
}

function PromptSheet({ noTelegram, publicKey, onClose }: { noTelegram: boolean; publicKey: string; onClose: () => void }) {
  const { enable, allowed, busy, error } = useEnablePush()
  const [done, setDone] = useState(false)
  const main = useRef<HTMLButtonElement>(null)
  useBack(onClose)
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    main.current?.focus()
    return () => back?.focus?.()
  }, [])
  const phone = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches

  const turnOn = async () => {
    if (await enable(publicKey)) setDone(true)
  }

  const later = 'Включить можно потом: «Настройки» → «Уведомления».'
  let title: string
  let body: ReactNode
  let actions: ReactNode
  if (done) {
    title = 'Готово ✓'
    body = <p className="pwa-ok">{noTelegram ? 'Уведомления о записях будут приходить в приложение.'
      : 'Уведомления будут приходить в приложение, в Telegram их больше не будет.'}</p>
    actions = <button ref={main} type="button" className="btn primary" onClick={onClose}>Хорошо</button>
  } else if (allowed === 'denied') {
    title = noTelegram ? '🔔 Уведомления запрещены' : 'Уведомления запрещены'
    body = <>
      <p className="pwa-warn">{noTelegram ? 'Вы запретили уведомления для Tish — о записях узнает только руководитель.'
        : 'Вы запретили уведомления для Tish — они по-прежнему будут приходить в Telegram.'}</p>
      <p className="hint">Разрешить можно в настройках телефона: Tish → «Уведомления», потом «Настройки» → «Уведомления» здесь.</p>
    </>
    actions = <button ref={main} type="button" className="btn primary" onClick={onClose}>Понятно</button>
  } else {
    title = noTelegram ? '🔔 Включить уведомления' : 'Получать уведомления в приложение вместо Telegram?'
    body = <>
      <p>{noTelegram
        ? 'Новые записи, переносы и вопросы пациентов будут приходить сюда, в приложение. Без уведомлений о записях узнает только руководитель.'
        : 'Новые записи, переносы и вопросы пациентов будут приходить уведомлениями приложения, а не сообщениями бота.'}</p>
      {error && <><p className="error" role="alert">{error}</p><p className="hint">{later}</p></>}
    </>
    actions = <>
      <button type="button" className="btn" disabled={busy} onClick={onClose}>{noTelegram ? 'Позже' : 'Оставить в Telegram'}</button>
      <button ref={main} type="button" className="btn primary" disabled={busy} onClick={() => void turnOn()}>
        {noTelegram ? 'Включить' : 'В приложение'}</button>
    </>
  }

  return createPortal(
    <div className="ui-select-backdrop confirm-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="push-prompt-title" className={phone ? 'confirm sheet push-prompt' : 'confirm push-prompt'}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}>
        <h2 id="push-prompt-title">{title}</h2>
        <div className="push-prompt-body">{body}</div>
        <div className="confirm-actions">{actions}</div>
      </div>
    </div>,
    document.body,
  )
}
