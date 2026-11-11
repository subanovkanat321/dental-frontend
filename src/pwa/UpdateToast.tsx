import { useEffect } from 'react'

import { confirmLeave } from '../lib/unsaved'
import { applyUpdate, dismissUpdate, registerServiceWorker, usePwa } from './pwa'
import './pwa.css'

/**
 * Регистрирует service worker (только CRM и вход: пациенту на сайте он не нужен) и показывает
 * «Доступна новая версия — Обновить», когда новая версия скачана и ждёт. Посреди работы сами не
 * перезагружаем — у регистратуры может быть открыта несохранённая запись; при смене раздела, когда
 * ничего не вводят, ждущую версию включает pwa/version.ts (updateAtSafeMoment) без кнопки.
 */
export function UpdateToast() {
  useEffect(() => { registerServiceWorker() }, [])
  const { waiting } = usePwa()
  if (!waiting) return null
  return (
    <div className="pwa-toast" role="status">
      <span>Доступна новая версия</span>
      <button type="button" className="btn primary small" onClick={() => { if (confirmLeave()) applyUpdate() }}>Обновить</button>
      <button type="button" className="btn ghost small" aria-label="Позже" onClick={dismissUpdate}>✕</button>
    </div>
  )
}
