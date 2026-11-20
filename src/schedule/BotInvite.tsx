import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { contactPhone } from '../lib/guardian'
import { openLink, telegram } from '../lib/telegram'
import { smsUrl, whatsappUrl } from '../lib/texts'
import { Sheet } from '../layout/Sheet'
import { Segments } from '../layout/Segments'
import { isMobile } from '../pwa/pwa'
import { dayMonth } from './botInvite'

export type InvitePatient = Pick<Schemas['PatientView'], 'id' | 'fullName' | 'phone' | 'guardian' | 'telegram' | 'botInvitedAt'>
type Lang = 'RU' | 'KY'
type Channel = 'WHATSAPP' | 'SMS' | 'COPY'

/**
 * Окно приглашения: сервер выпускает личную ссылку t.me/<бот>?start=inv_… (одноразовая, 30 дней; новая гасит прежнюю)
 * и готовый текст по-русски и по-кыргызски — язык выбирает сотрудник. Дальше — WhatsApp, SMS с телефона или «Скопировать
 * ссылку»; любой путь ставит отметку «пригласили …». У ребёнка с представителем текст и номер — представителя.
 */
export function BotInviteSheet({ patient, onClose }: { patient: InvitePatient; onClose: () => void }) {
  const client = useQueryClient()
  const invite = useQuery({
    queryKey: ['bot-invite', patient.id],
    queryFn: () => unwrap(api.POST('/api/patients/{id}/bot-invite', { params: { path: { id: patient.id } } })),
    // Каждое открытие — новая ссылка: не берём из кэша, не повторяем молча
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
  })
  const [lang, setLang] = useState<Lang>('RU')
  const [done, setDone] = useState('')
  const phone = contactPhone(patient)
  const text = (lang === 'KY' ? invite.data?.textKy : invite.data?.textRu) ?? ''
  const sent = useMutation<Schemas['PatientInviteControllerSent'] | undefined, ApiError, Channel>({
    mutationFn: (channel) => unwrap(api.POST('/api/patients/{id}/bot-invite/sent', {
      params: { path: { id: patient.id } }, body: { channel, lang },
    })),
    onSuccess: (_, channel) => {
      setDone(channel === 'COPY' ? 'Ссылка скопирована — вставьте её в чат с пациентом' : channel === 'SMS' ? 'Открыли «Сообщения» с текстом' : 'Открыли WhatsApp с текстом')
      // «пригласили …» — в карточках, на записи и в списке «Без бота»
      for (const key of ['patient-card', 'appointments', 'patients', 'no-bot']) void client.invalidateQueries({ queryKey: [key] })
    },
  })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite.data!.url)
      sent.mutate('COPY')
    } catch {
      setDone('Не получилось скопировать — выделите ссылку в тексте')
    }
  }
  const sms = invite.data && phone && isMobile() ? smsUrl(phone, text) : null
  return (
    <Sheet label="Пригласить в Telegram-бот" title="📲 Пригласить в Telegram-бот" onClose={onClose}>
      <div className="bot-invite">
        {invite.isPending && <p className="hint">Готовим личную ссылку…</p>}
        {invite.error && <p className="error" role="alert">{invite.error.message}</p>}
        {invite.data && (
          <>
            <p className="hint small">
              {patient.guardian ? `Текст — представителю (${patient.guardian.fullName}): напоминания о ребёнке придут ему. ` : ''}
              В боте пациент сам ответит «Приду» или перенесёт приём, получит отчёт о визите — без звонков. Ссылка личная,
              до {dayMonth(invite.data.expiresAt)}.
            </p>
            <Segments<Lang> label="Язык текста" value={lang} onChange={setLang} options={[{ value: 'RU', label: 'Русский' }, { value: 'KY', label: 'Кыргызча' }]} />
            <p className="bot-invite-text" aria-label="Текст приглашения">{text}</p>
            {done ? (
              <div className="bot-invite-done">
                <p className="tone-ok" role="status">✅ {done}</p>
                <p className="hint small">Пациент нажмёт «Старт» — в карточке появится «в боте».</p>
                <button type="button" className="btn" onClick={onClose}>Готово</button>
              </div>
            ) : (
              <div className="actions">
                {phone && (
                  <button type="button" className="btn primary" disabled={sent.isPending} onClick={() => {
                    // Сначала WhatsApp (по нажатию — иначе браузер не откроет), отметка — следом
                    openLink(whatsappUrl(phone, text))
                    sent.mutate('WHATSAPP')
                  }}>💬 WhatsApp</button>
                )}
                {/* Ссылкой sms:, а не из скрипта: «Сообщения» так открываются надёжнее; в Telegram — своя страница call.html */}
                {sms && phone && (
                  <a className="btn" href={sms} onClick={(e) => {
                    sent.mutate('SMS')
                    if (!telegram()) return
                    e.preventDefault()
                    openLink(`${window.location.origin}/call.html#${new URLSearchParams({ sms: phone, body: text })}`)
                  }}>📱 SMS</a>
                )}
                <button type="button" className={phone ? 'btn' : 'btn primary'} disabled={sent.isPending} onClick={() => void copy()}>📋 Скопировать ссылку</button>
              </div>
            )}
            {!phone && !done && <p className="hint small">Номера нет — скопируйте ссылку и отправьте пациенту сами.</p>}
            {sent.error && <p className="error" role="alert">{sent.error.message}</p>}
          </>
        )}
      </div>
    </Sheet>
  )
}
