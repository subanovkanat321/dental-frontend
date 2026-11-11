import { useContext } from 'react'

import { useBack } from '../lib/back'
import { useMedia } from '../lib/useMedia'
import { guarded } from '../lib/unsaved'
import { SectionTitle } from '../layout/section'
import { stickyHead } from '../layout/stickyHead'
import { ItemHost, type ItemHostKind } from './itemHost'

const CRUMB: Record<ItemHostKind, string> = { settings: 'Настройки', clinic: 'Клиника', me: 'Мои настройки', help: 'Помощь' }

/**
 * Шапка пункта: название и «назад». «Настройки»: «‹ Настройки» к списку (телефон; и стрелка Telegram).
 * «Клиника» — обычный раздел с подразделами: на компьютере мелко «Клиника» над названием, на телефоне
 * «Клиника · Персонал ▾» открывает лист подразделов; «назад» не нужен. «Я» и «Помощь» — «‹ Назад» туда,
 * откуда открыли. Есть несохранённые правки — сначала спросим, выйти ли без сохранения.
 */
export function SubHeader({ title, onBack, slotRef, children }: {
  title: string
  onBack: () => void
  /** Место под инструменты пункта (`HeadTools`, layout/PageHead) — в той же строке, что название */
  slotRef?: (el: HTMLElement | null) => void
  children?: React.ReactNode
}) {
  const host = useContext(ItemHost)
  const back = guarded(onBack)
  // «‹ Настройки» — одна кнопка: на телефоне строкой над названием, на компьютере мелкой ссылкой
  const phone = useMedia('(max-width: 760px)')
  // Пункт записан в адресе (#/settings/…): «назад» браузера ведёт в список и так
  useBack(host === 'clinic' ? null : back, { url: true })
  return (
    <header ref={stickyHead} className="toolbar sticky-head page-head">
      {host === 'clinic' ? <SectionTitle page="clinic" title="Клиника" subTitle={title} /> : (
        <>
          {/* Телефон: «‹ Настройки» назад к списку. Компьютер: мелко над названием пункта — у «Настроек»
              ссылкой «‹ Настройки» к списку пунктов (в меню слева они свёрнуты), у «Я» и «Помощи» — подписью */}
          {(host !== 'settings' || phone) && <button type="button" className="btn ghost back settings-back" onClick={back}>{host === 'settings' ? '‹ Настройки' : '‹ Назад'}</button>}
          <div className="sect-titles sub-titles">
            {host === 'settings' && !phone
              ? <button type="button" className="sect-crumb crumb-link" onClick={back}>‹ {CRUMB[host]}</button>
              : <span className="sect-crumb">{CRUMB[host]}</span>}
            <h1>{title}</h1>
          </div>
        </>
      )}
      {slotRef && <div className="head-tools" ref={slotRef} />}
      {children}
    </header>
  )
}
