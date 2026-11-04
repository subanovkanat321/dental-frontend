import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { telegram } from '../lib/telegram'
import { currentSubscription, permission, pushSupport, subscribeThisDevice } from './push'
import './pwa.css'

type View = Schemas['PushControllerPushView']

/**
 * «Настройки → 🔔 Уведомления»: куда присылать уведомления — в Telegram (как раньше) или в
 * установленное приложение (Web Push). Каждое уведомление сервер шлёт ровно в одно место — то,
 * что выбрано (DoctorNotifier.deliver бэкенда); не дошло в приложение — уйдёт в Telegram.
 */
export function Notifications() {
  if (telegram()) {
    return (
      <Section>
        <p>Вы в Telegram — уведомления приходят сюда, в бот. Чтобы получать их в приложении, установите его
          (выше) и выберите там «В приложение».</p>
      </Section>
    )
  }
  return <NotificationsBody />
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section className="settings-group" aria-label="Уведомления">
      <h2>Уведомления</h2>
      <div className="card-block pwa-install">{children}</div>
    </section>
  )
}

function NotificationsBody() {
  const client = useQueryClient()
  const view = useQuery({ queryKey: ['push'], queryFn: () => unwrap(api.GET('/api/push')) })
  const support = pushSupport()
  const [allowed, setAllowed] = useState<NotificationPermission>(permission)
  // Подписан ли этот браузер: уведомления идут на устройства из подписок, а не «куда-то»
  const [here, setHere] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [test, setTest] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void currentSubscription().then((s) => { if (alive) setHere(s != null) })
    return () => { alive = false }
  }, [])

  // Ключей нет на сервере (или ещё грузим) — выбора нет, всё в Telegram: блок не показываем
  if (!view.data?.enabled || !view.data.publicKey) return null
  const data = view.data
  const publicKey = view.data.publicKey
  const app = data.channel === 'APP'
  const devices = data.devices ?? []
  // Вход по SMS: Telegram нет — только приложение; не включил — о записях узнает администратор
  const noTelegram = data.noTelegram === true
  const fallback = 'Включите уведомления приложения, иначе сообщения о записях получит администратор.'

  const save = (next: View) => client.setQueryData(['push'], next)

  const toTelegram = async () => {
    setError(null)
    setTest(null)
    try {
      save(await unwrap(api.PUT('/api/push/channel', { body: { channel: 'TELEGRAM' } })))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не сохранилось — проверьте интернет')
    }
  }

  // Разрешение браузер спрашивает только из нажатия: requestPermission — первым делом в обработчике
  const toApp = async () => {
    setError(null)
    setTest(null)
    const answer = await Notification.requestPermission()
    setAllowed(answer)
    if (answer !== 'granted') return
    setBusy(true)
    try {
      const subscription = await subscribeThisDevice(publicKey)
      await unwrap(api.POST('/api/push/subscribe', { body: subscription }))
      save(await unwrap(api.PUT('/api/push/channel', { body: { channel: 'APP' } })))
      setHere(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось подключить уведомления. Обновите страницу и попробуйте ещё раз.')
    } finally {
      setBusy(false)
    }
  }

  const sendTest = async () => {
    setTest(null)
    setBusy(true)
    try {
      const result = await unwrap(api.POST('/api/push/test'))
      setTest(result.sent ? 'Отправили — уведомление придёт через пару секунд.' : 'Не дошло ни на одно устройство. Подключите это устройство ещё раз.')
    } catch (e) {
      setTest(e instanceof ApiError ? e.message : 'Не отправилось — проверьте интернет')
    } finally {
      setBusy(false)
    }
  }

  let status
  if (support === 'ios-install') {
    status = <p>На iPhone уведомления приходят только в установленное приложение (iOS 16.4 и новее): добавьте Tish
      на экран «Домой» — выше «Установить приложение», — откройте его с иконки и включите здесь.</p>
  } else if (support === 'unsupported') {
    status = <p>{noTelegram ? 'Этот браузер не умеет уведомления — сообщения о записях получит администратор.'
      : 'Этот браузер не умеет уведомления — они приходят в Telegram.'} Подойдут Chrome, Edge, Firefox,
      Safari на Mac, а на iPhone — приложение с экрана «Домой».</p>
  } else if (allowed === 'denied') {
    status = <p className="pwa-warn">🚫 Уведомления для Tish запрещены в браузере. Разрешите: значок слева от адреса
      (🔒) → «Уведомления» → «Разрешить»; в приложении на телефоне — «Настройки» телефона → Tish → «Уведомления».
      Потом нажмите «В приложение» ещё раз.</p>
  } else if (app && here && allowed === 'granted') {
    status = (
      <>
        <p className="pwa-ok">{noTelegram ? 'Работает ✓ Уведомления приходят в приложение.'
          : 'Работает ✓ Уведомления приходят в приложение, в Telegram их больше не будет.'}</p>
        {devices.length > 1 && <p className="hint">Устройства: {devices.join(', ')}.</p>}
        <div className="actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void sendTest()}>🔔 Отправить проверочное</button>
        </div>
        {test && <p role="status">{test}</p>}
      </>
    )
  } else if (app) {
    status = (
      <>
        {devices.length > 0
          ? <p>Уведомления приходят на: {devices.join(', ')}. Это устройство не подключено.</p>
          : <p className="pwa-warn">{noTelegram ? `⚠️ ${fallback}` : '⚠️ Ни одно устройство не подключено — пока уведомления идут в Telegram.'}</p>}
        <div className="actions">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void toApp()}>
            {noTelegram && !devices.length ? 'Включить уведомления' : 'Подключить это устройство'}</button>
        </div>
      </>
    )
  }

  return (
    <Section>
      {noTelegram ? <p className="hint">Вы входите без Telegram — уведомления приходят только в приложение. {fallback}</p> : (
        <div className="field"><span>Куда присылать</span>
          <div className="segments" role="group" aria-label="Куда присылать уведомления">
            <button type="button" aria-pressed={!app} disabled={busy} onClick={() => void toTelegram()}>Telegram</button>
            <button type="button" aria-pressed={app} disabled={busy || support !== 'ok'} onClick={() => { if (!(app && here)) void toApp() }}>В приложение</button>
          </div>
        </div>
      )}
      {status}
      {error && <p className="error" role="alert">{error}</p>}
      {!noTelegram && <p className="hint">Каждое уведомление приходит в одно место — туда, что выбрано здесь. Не дошло в приложение — придёт в Telegram.</p>}
    </Section>
  )
}
