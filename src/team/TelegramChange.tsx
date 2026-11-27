import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { HelpHint } from '../help/HelpHint'
import { Spinner } from '../layout/Loading'
import { copyText } from '../lib/clipboard'
import { openLink } from '../lib/telegram'
import { whatsappUrl } from '../lib/texts'

/** Что уходит сотруднику вместе со ссылкой: без имён и номеров — только что сделать. */
function changeText(link: string): string {
  return `Перенесите вход в Tish на новый Telegram: откройте ссылку в НОВОМ аккаунте Telegram и нажмите «✅ Да, перенести». Ссылка действует 15 минут. ${link}`
}

/**
 * «Сменить Telegram» в карточке сотрудника — руководитель делает ссылку за сотрудника, которому самому сложно
 * («Мой профиль → Telegram»). Ссылка t.me/<бот>?start=tgmove_… — отправить сотруднику в WhatsApp или скопировать; он
 * открывает её в новом аккаунте Telegram и подтверждает «✅ Да, перенести». Руководитель сессию сотрудника не получает,
 * сервер лишь переносит вход; после этого в «Персонале» сотрудник — уже с новым Telegram (обновить список).
 */
export function ChangeTelegram({ telegramId, name, phone }: { telegramId: number; name: string; phone?: string | null }) {
  const [copied, setCopied] = useState('')
  const start = useMutation<Schemas['TelegramChangeControllerChangeStarted'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/members/{telegramId}/telegram-change', { params: { path: { telegramId } } })),
    onSuccess: () => setCopied(''),
  })
  const link = start.data?.link
  return (
    <div className="telegram-change">
      {!link ? (
        <p>
          <button type="button" className="btn" disabled={start.isPending} onClick={() => start.mutate()}>
            {start.isPending ? <><Spinner />Готовим ссылку…</> : 'Сменить Telegram'}</button>{' '}
          <HelpHint title="Сменить Telegram">Сотрудник завёл новый Telegram для работы? Дайте ему ссылку: он откроет её в новом аккаунте Telegram
            и нажмёт «✅ Да, перенести». Роль, пациенты, график и пароль останутся те же, старый Telegram больше не будет входить.
            Сотрудник может сделать это и сам: «Мой профиль» → «Telegram».</HelpHint>
        </p>
      ) : (
        <div className="invite">
          <p className="hint">Ссылка работает один раз и 15 минут. Отправьте её {name ? `«${name}»` : 'сотруднику'}: открыть в новом аккаунте
            Telegram и нажать «✅ Да, перенести».</p>
          <a className="invite-link" href={link} target="_blank" rel="noopener noreferrer">{link}</a>
          <div className="actions">
            <button type="button" className="btn" onClick={() => openLink(whatsappUrl(phone ?? '', changeText(link)))}>Отправить в WhatsApp</button>
            <button type="button" className="btn" onClick={() => void copyText(changeText(link)).then((ok) => setCopied(ok
              ? 'Скопировано — вставьте в WhatsApp или Telegram' : 'Не получилось скопировать — выделите ссылку выше'))}>Скопировать</button>
          </div>
          {copied && <p className="tone-ok" role="status">{copied}</p>}
          <p className="hint small">Когда сотрудник подтвердит, обновите «Персонал» — он будет уже с новым Telegram.</p>
        </div>
      )}
      {start.error && <p className="error" role="alert">{start.error.message}</p>}
    </div>
  )
}
