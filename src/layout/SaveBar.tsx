import { useEffect, useRef, useState } from 'react'

import { haptic } from '../lib/telegram'
import { Spinner } from './Loading'

/** Сколько видно «✅ Сохранено» после успешного сохранения. */
const SAVED_MS = 3000

/**
 * Полоса «Сохранить» у формы настроек. Прилипает к низу экрана (на телефоне — над панелью
 * разделов), пока форма на экране, — кнопку не нужно искать в конце длинной формы:
 * - есть правки — «Есть несохранённые изменения» и главная кнопка;
 * - сохраняем — «Сохраняем…», кнопка выключена;
 * - сохранили — зелёное «✅ Сохранено» (или savedText) на 3 секунды, потом полоса прячется;
 * - ошибка — красный текст сервера остаётся, кнопка тоже: можно повторить.
 * Правок нет — полосы нет: «Сохранить», которое молча ничего не делает, не показываем.
 * Без onSave кнопка — submit своей формы (полоса должна быть внутри <form>).
 */
export function SaveBar({ dirty, saving, saved, error, savedText = 'Сохранено', label = 'Сохранить', onSave, disabled = false }: {
  dirty: boolean
  saving: boolean
  /** Сохранение прошло (mutation.isSuccess): переход false → true показывает подтверждение */
  saved: boolean
  /** Ошибка сервера или проверки — показываем, пока она есть */
  error?: string | null
  savedText?: string
  label?: string
  onSave?: () => void
  disabled?: boolean
}) {
  // Подтверждение — по переходу saved false → true (новое сохранение — новый счёт и новые 3 секунды).
  // Полоса появилась уже с saved — тоже подтверждаем: форма закрылась после сохранения, а полоса —
  // у того, кто её показывал (карточка зарплаты, строка ассистента)
  const [prevSaved, setPrevSaved] = useState(false)
  const [shown, setShown] = useState(0)
  const [hidden, setHidden] = useState(0)
  if (saved !== prevSaved) {
    setPrevSaved(saved)
    if (saved) setShown(shown + 1)
  }
  useEffect(() => {
    if (!shown) return
    haptic('success')
    const timer = setTimeout(() => setHidden(shown), SAVED_MS)
    return () => clearTimeout(timer)
  }, [shown])
  const flash = shown > hidden
  const hadError = useRef(Boolean(error))
  useEffect(() => {
    if (error && !hadError.current) haptic('error')
    hadError.current = Boolean(error)
  }, [error])

  const button = (
    <button type={onSave ? 'button' : 'submit'} className="btn primary" disabled={saving || disabled}
      onClick={onSave ? () => onSave() : undefined}>{label}</button>
  )
  if (saving) {
    return <div className="save-bar" data-state="saving"><span className="save-bar-text" role="status"><Spinner />Сохраняем…</span>{button}</div>
  }
  if (error) {
    return <div className="save-bar" data-state="error"><span className="save-bar-text" role="alert">{error}</span>{button}</div>
  }
  if (dirty) {
    return <div className="save-bar" data-state="dirty"><span className="save-bar-text">Есть несохранённые изменения</span>{button}</div>
  }
  if (flash) {
    return (
      <div className="save-bar" data-state="saved">
        <span className="save-bar-text" role="status"><span aria-hidden="true">✅ </span><span>{savedText}</span></span>
      </div>
    )
  }
  return null
}
