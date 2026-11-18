import { useState } from 'react'

import { matches } from '../lib/useMedia'
import { COPY_HINT, nameFromText } from '../schedule/contactText'

type Contact = { name?: string[]; tel?: string[] }
type ContactsNavigator = Navigator & { contacts?: { select: (props: string[], opts?: { multiple?: boolean }) => Promise<Contact[]> } }

/** Записная книжка телефона есть: Chrome на Android и установленное PWA. В Telegram Mini App и на iPhone — нет. */
const contactsSupported = () => typeof navigator !== 'undefined' && 'contacts' in navigator

/**
 * Номер пациента — не набирать руками: «📇 Из контактов телефона» (Contact Picker API — Android Chrome и PWA)
 * или, где записной книжки нет (iPhone, Telegram, компьютер), «📋 Вставить номер» из буфера обмена с
 * подсказкой, как скопировать номер и как прислать контакт боту. Один компонент на все места, где заводят
 * пациента: поиск и «Новый пациент» в «Новой записи», форма «Пациенты → ＋ Новый».
 *
 * onContact получает имя (может быть пустым) и сырой текст с номером; разбирает номер сам (phoneFromText)
 * и возвращает false, если номера в тексте нет.
 */
export function ContactPick({ onContact }: { onContact: (name: string, raw: string) => boolean | Promise<boolean> }) {
  const [hint, setHint] = useState('')

  const pickContact = async () => {
    let contact: Contact | undefined
    try {
      [contact] = await (navigator as ContactsNavigator).contacts!.select(['name', 'tel'])
    } catch {
      return
    }
    const tel = contact?.tel?.[0]
    if (tel) await onContact(contact?.name?.[0] ?? '', tel)
  }

  // На iPhone система сама покажет пузырёк «Вставить» — разрешение на один раз
  const pasteNumber = async () => {
    setHint('')
    let text: string
    try {
      if (!navigator.clipboard?.readText) throw new Error('no clipboard')
      text = await navigator.clipboard.readText()
    } catch {
      setHint(COPY_HINT)
      return
    }
    if (!(await onContact(nameFromText(text), text))) setHint(`В буфере нет номера. ${COPY_HINT}`)
  }

  if (contactsSupported()) {
    return <button type="button" className="link contact-pick" onClick={() => void pickContact()}>📇 Из контактов телефона</button>
  }
  return (
    <div className="paste-number">
      <button type="button" className="link" onClick={() => void pasteNumber()}>📋 Вставить номер</button>
      {hint
        ? <p className="hint small" role="status">{hint}</p>
        : matches('(pointer: coarse)') && (
          <p className="hint small">В Контактах удерживайте номер → «Скопировать». Ещё удобнее: Контакты → «Поделиться контактом» → бот Tish.</p>
        )}
    </div>
  )
}
