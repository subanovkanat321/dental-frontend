import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { permission, subscribeThisDevice } from './push'

export type PushView = Schemas['PushControllerPushView']

/** Ответ GET /api/push в кэше: его читают «Настройки → Уведомления» и окно после установки (PushPrompt). */
export const PUSH_KEY = ['push'] as const

/**
 * «Включить уведомления в приложение» — одно действие для «Настроек → Уведомления» и окна после
 * установки: разрешение браузера → подписать это устройство → канал APP на сервере.
 * `enable` вызывать прямо из нажатия: Notification.requestPermission браузер разрешает только по
 * жесту пользователя, поэтому он — первым делом, до любых других await.
 */
export function useEnablePush() {
  const client = useQueryClient()
  const [allowed, setAllowed] = useState<NotificationPermission>(permission)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** true — подключили (кэш PUSH_KEY уже с каналом APP); false — отказ браузера или ошибка (`error`). */
  const enable = async (publicKey: string): Promise<boolean> => {
    setError(null)
    const answer = await Notification.requestPermission()
    setAllowed(answer)
    if (answer !== 'granted') return false
    setBusy(true)
    try {
      const subscription = await subscribeThisDevice(publicKey)
      await unwrap(api.POST('/api/push/subscribe', { body: subscription }))
      client.setQueryData(PUSH_KEY, await unwrap(api.PUT('/api/push/channel', { body: { channel: 'APP' } })))
      return true
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось подключить уведомления. Обновите страницу и попробуйте ещё раз.')
      return false
    } finally {
      setBusy(false)
    }
  }

  return { enable, allowed, busy, error, setError }
}
