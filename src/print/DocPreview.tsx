import { useState, type ReactNode } from 'react'

import { canPrint, type PaperFormat } from './paper'
import { ChannelSwitch, MessagePreview, type Channel } from './MessagePreview'
import { PaperSheet } from './PrintSheet'

type Tab = 'message' | 'paper'

/** Лист для вкладки «📄 Лист»: тот же, что уйдёт на печать. */
export type Paper = {
  /** переключатель «A4 / Чек 80 мм» (квитанция) */
  formats?: boolean
  render: (format: PaperFormat) => ReactNode
}

/**
 * «👁 Просмотр» документа пациенту (памятка, сообщение после приёма, квитанция, план): ровно то, что он получит, и уже
 * отсюда — «Отправить в Telegram / WhatsApp» или «🖨 Печать». Один порядок у всех документов: Просмотр → (Отправить |
 * Печать).
 *
 * Вкладка «💬 Сообщение» — текст с сервера как он придёт (MessagePreview: тот же текст уходит в бот и в WhatsApp, здесь
 * его не собираем); «📄 Лист» — лист печати с шапкой клиники (PaperSheet, тот же, что в окне печати). Канал — Telegram,
 * если пациент пишет боту, иначе WhatsApp; оба есть — переключатель. Сам ничего не отправляет и не печатает — только
 * по нажатию. Это часть карточки, а не отдельная страница: в адресе нет ни имени, ни телефона пациента.
 *
 * @param label что за документ — в подписях кнопок для экранного диктора («Печать: квитанция»)
 * @param telegram пациент пишет боту — можно отправить в Telegram
 * @param phone телефон для WhatsApp (ссылку wa.me соберёт вызывающий: на сервер телефон не уходит)
 * @param paper лист печати; нет — только сообщение, «🖨 Печать» откроет окно печати сразу (план лечения)
 * @param note подсказка под сообщением, свой текст для канала (оценка приёма)
 * @param messageLabel имя пузыря сообщения для диктора; нет — «Предпросмотр: <label>»
 * @param sendLabel подпись кнопки отправки для диктора; нет — видимый текст
 */
export function DocPreview({ label, text, telegram, phone, parts, paper, initialTab = 'message', busy = false, note, sendLabel, messageLabel,
  onTelegram, onWhatsapp, onPrint, onClose, closeText = 'Закрыть', hint, children }: {
  label: string
  text: string
  telegram: boolean
  phone?: string | null
  parts?: number
  paper?: Paper
  initialTab?: Tab
  busy?: boolean
  note?: (channel: Channel) => ReactNode
  sendLabel?: (channel: Channel) => string
  messageLabel?: string
  onTelegram: () => void
  onWhatsapp: () => void
  onPrint: (format: PaperFormat) => void
  onClose?: () => void
  closeText?: string
  hint?: ReactNode
  children?: ReactNode
}) {
  const [tab, setTab] = useState<Tab>(paper ? initialTab : 'message')
  const [channel, setChannel] = useState<Channel>(telegram ? 'TELEGRAM' : 'WHATSAPP')
  const [format, setFormat] = useState<PaperFormat>('a4')
  const toTelegram = channel === 'TELEGRAM' && telegram
  const nowhere = !telegram && !phone
  return (
    <div className="doc-preview" role="region" aria-label={`Просмотр: ${label}`}>
      {hint}
      {paper && (
        <div className="segments" role="group" aria-label="Что показать">
          <button type="button" aria-pressed={tab === 'message'} onClick={() => setTab('message')}>💬 Сообщение</button>
          <button type="button" aria-pressed={tab === 'paper'} onClick={() => setTab('paper')}>📄 Лист</button>
        </div>
      )}
      {tab === 'message' ? (
        <>
          <ChannelSwitch value={channel} telegram={telegram} whatsapp={Boolean(phone)} onChange={setChannel} />
          {nowhere
            ? <p className="hint small">Пациент не в Telegram и без телефона — отправить некуда{paper ? ', можно распечатать' : ''}.</p>
            : <MessagePreview text={text} channel={toTelegram ? 'TELEGRAM' : 'WHATSAPP'} parts={parts}
                label={messageLabel ?? `Предпросмотр: ${label}`} />}
          {!nowhere && note?.(toTelegram ? 'TELEGRAM' : 'WHATSAPP')}
        </>
      ) : paper && (
        <>
          {paper.formats && (
            <div className="segments" role="group" aria-label="Формат">
              <button type="button" aria-pressed={format === 'a4'} onClick={() => setFormat('a4')}>A4</button>
              <button type="button" aria-pressed={format === 'receipt'} onClick={() => setFormat('receipt')}>Чек 80 мм</button>
            </div>
          )}
          <div className="doc-preview-paper" role="document" aria-label={`Лист: ${label}`}>
            <PaperSheet format={format}>{paper.render(format)}</PaperSheet>
          </div>
        </>
      )}
      <div className="actions">
        {toTelegram && (
          <button type="button" className={tab === 'message' ? 'btn primary' : 'btn'} disabled={busy} aria-label={sendLabel?.('TELEGRAM')}
            onClick={onTelegram}>Отправить в Telegram</button>
        )}
        {!toTelegram && phone && (
          <button type="button" className={tab === 'message' ? 'btn primary' : 'btn'} disabled={busy} aria-label={sendLabel?.('WHATSAPP')}
            onClick={onWhatsapp}>Отправить в WhatsApp</button>
        )}
        {canPrint() ? (
          <button type="button" className={tab === 'paper' || nowhere ? 'btn primary' : 'btn'} disabled={busy} aria-label={`Печать: ${label}`}
            onClick={() => onPrint(format)}>🖨 Печать</button>
        ) : <span className="hint small">🖨 Печать — с компьютера</span>}
        {onClose && <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>{closeText}</button>}
      </div>
      {children}
    </div>
  )
}
