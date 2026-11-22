import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useMe } from '../api/me'
import { useBack } from '../lib/back'
import { formatPhone, timeOf } from '../lib/time'
import { docDate, type PaperFormat } from './paper'
import './print.css'
import { CloseButton } from '../layout/SheetHead'

/**
 * Лист для печати поверх CRM — не отдельная страница: в адресе нет ни имени пациента, ни id.
 * Открылся — сразу окно печати браузера; «🖨 Печать» — ещё раз, ✕ (или Esc) — назад.
 * Шапка — клиника из «О клинике» (название, юрлицо, адрес, телефон), внизу — дата.
 *
 * @param formats есть — переключатель «A4 / Чек 80 мм» (квитанция)
 * @param initialFormat формат при открытии — тот, что выбрали в «🔍 Просмотре»
 * @param tools поля над листом, которые не печатаются (например, «Примечание»)
 */
export function PrintSheet({ title, onClose, formats = false, initialFormat = 'a4', tools, children }: {
  title: string
  onClose: () => void
  formats?: boolean
  initialFormat?: PaperFormat
  tools?: ReactNode
  children: (format: PaperFormat) => ReactNode
}) {
  const [format, setFormat] = useState<PaperFormat>(initialFormat)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  useBack(onClose)
  useEffect(() => {
    document.body.classList.add('printing')
    // Esc — закрыть лист, а не карточку под ним: перехватываем раньше её обработчика
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close.current()
    }
    window.addEventListener('keydown', onKey, true)
    const timer = window.setTimeout(() => window.print(), 300)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey, true)
      document.body.classList.remove('printing')
    }
  }, [])

  const narrow = format === 'receipt'
  return createPortal(
    <div className="print-root" role="dialog" aria-label={`Печать: ${title}`}>
      {/* Размер бумаги: @page нельзя поставить классом — свой <style> под выбранный формат */}
      <style>{narrow ? '@media print { @page { size: 80mm auto; margin: 3mm } }' : '@media print { @page { size: A4; margin: 12mm } }'}</style>
      <div className="print-toolbar">
        <h2>{title}</h2>
        {formats && (
          <div className="segments" role="group" aria-label="Формат">
            <button type="button" aria-pressed={!narrow} onClick={() => setFormat('a4')}>A4</button>
            <button type="button" aria-pressed={narrow} onClick={() => setFormat('receipt')}>Чек 80 мм</button>
          </div>
        )}
        <button type="button" className="btn primary" onClick={() => window.print()}>🖨 Печать</button>
        <CloseButton className="print-x" onClick={onClose} />
        {tools}
      </div>
      <PaperSheet format={format}>{children(format)}</PaperSheet>
    </div>,
    document.body,
  )
}

/**
 * Сам лист: шапка клиники из «О клинике» (название, юрлицо, адрес, телефон), содержимое и внизу — дата. Один и тот же
 * в окне печати (PrintSheet) и в «🔍 Просмотре» (DocPreview) — что видно в просмотре, то и выйдет на бумаге.
 */
export function PaperSheet({ format, children }: { format: PaperFormat; children: ReactNode }) {
  const me = useMe()
  const clinic = me.data?.clinic
  const name = clinic?.brandName || clinic?.name || ''
  const now = new Date().toISOString()
  return (
    <article className={format === 'receipt' ? 'print-sheet narrow' : 'print-sheet'}>
      <header className="doc-head">
        <div>
          {name && <b>{name}</b>}
          {clinic?.legalName && clinic.legalName !== name && <span>{clinic.legalName}</span>}
        </div>
        <div>
          {clinic?.address && <div>{clinic.address}</div>}
          {(clinic?.phones?.[0] ?? clinic?.whatsappPhone) && <div>{formatPhone(clinic.phones?.[0] ?? clinic.whatsappPhone!)}</div>}
        </div>
      </header>
      {children}
      <footer className="doc-foot">{name ? `${name} · ` : ''}Распечатано {docDate(now)} в {timeOf(now)}</footer>
    </article>
  )
}
