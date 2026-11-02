import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useMe } from '../api/me'
import { useBack } from '../lib/back'
import { formatPhone, timeOf } from '../lib/time'
import { docDate, type PaperFormat } from './paper'
import './print.css'

/**
 * Лист для печати поверх CRM — не отдельная страница: в адресе нет ни имени пациента, ни id.
 * Открылся — сразу окно печати браузера; «🖨 Печать» — ещё раз, «Закрыть» (или Esc) — назад.
 * Шапка — клиника из «О клинике» (название, юрлицо, адрес, телефон), внизу — дата.
 *
 * @param formats есть — переключатель «A4 / Чек 80 мм» (квитанция)
 * @param tools поля над листом, которые не печатаются (например, «Примечание»)
 */
export function PrintSheet({ title, onClose, formats = false, tools, children }: {
  title: string
  onClose: () => void
  formats?: boolean
  tools?: ReactNode
  children: (format: PaperFormat) => ReactNode
}) {
  const me = useMe()
  const [format, setFormat] = useState<PaperFormat>('a4')
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

  const clinic = me.data?.clinic
  const name = clinic?.brandName || clinic?.name || ''
  const now = new Date().toISOString()
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
        <button type="button" className="btn" onClick={onClose}>Закрыть</button>
        {tools}
      </div>
      <article className={narrow ? 'print-sheet narrow' : 'print-sheet'}>
        <header className="doc-head">
          <div>
            {name && <b>{name}</b>}
            {clinic?.legalName && clinic.legalName !== name && <span>{clinic.legalName}</span>}
          </div>
          <div>
            {clinic?.address && <div>{clinic.address}</div>}
            {clinic?.whatsappPhone && <div>{formatPhone(clinic.whatsappPhone)}</div>}
          </div>
        </header>
        {children(format)}
        <footer className="doc-foot">{name ? `${name} · ` : ''}Распечатано {docDate(now)} в {timeOf(now)}</footer>
      </article>
    </div>,
    document.body,
  )
}
