import { useContext } from 'react'

import { useBack } from '../lib/back'
import { guarded } from '../lib/unsaved'
import { SectionTitle } from '../layout/section'
import { stickyHead } from '../layout/stickyHead'
import { ItemChrome, ItemHost, type ItemHostKind } from './itemHost'

const CRUMB: Record<ItemHostKind, string> = { settings: 'Настройки', clinic: 'Клиника', me: 'Мои настройки', help: 'Помощь' }

/**
 * Шапка пункта: название и «назад». «Клиника» и «Настройки» (с 2026-11-13) — обычные разделы с подразделами:
 * вкладки сверху (`SectionTitle`), «назад» не нужен. «Я» и «Помощь» — «‹ Назад» туда, откуда открыли,
 * мелко «Мои настройки»/«Помощь» над названием. Есть несохранённые правки — сначала спросим, выйти ли без сохранения.
 */
export function SubHeader({ title, onBack, slotRef, children }: {
  title: string
  onBack: () => void
  /** Место под инструменты пункта (`HeadTools`, layout/PageHead) — в той же строке, что название */
  slotRef?: (el: HTMLElement | null) => void
  children?: React.ReactNode
}) {
  const host = useContext(ItemHost)
  // Вкладка объединённого пункта «Настроек»: название — пункта, вкладки — в этой же шапке
  const chrome = useContext(ItemChrome)
  const shown = chrome?.title ?? title
  const back = guarded(onBack)
  const section = host === 'clinic' || host === 'settings'
  // Пункт записан в адресе (#/me/…): «назад» браузера ведёт туда, откуда открыли
  useBack(section ? null : back, { url: true })
  return (
    <header ref={stickyHead} className="toolbar sticky-head page-head">
      {section ? <SectionTitle page={host} title={CRUMB[host]} subTitle={shown} /> : (
        <>
          <button type="button" className="btn ghost back settings-back" onClick={back}>‹ Назад</button>
          <div className="sect-titles sub-titles">
            <span className="sect-crumb">{CRUMB[host]}</span>
            <h1>{shown}</h1>
          </div>
        </>
      )}
      {slotRef && <div className="head-tools" ref={slotRef} />}
      {children}
      {chrome?.tabs}
    </header>
  )
}
