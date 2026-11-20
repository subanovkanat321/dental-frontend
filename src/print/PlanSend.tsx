import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Sheet } from '../layout/Sheet'
import { contactPhone } from '../lib/guardian'
import { haptic, openLink } from '../lib/telegram'
import { whatsappUrl } from '../lib/texts'

type Patient = Schemas['PatientView']
type Channel = NonNullable<Schemas['PlanOffersSendRequest']['channel']>

/**
 * «📤 Пациенту» с листа плана (шаг 4А): одним нажатием — в WhatsApp ссылка на страницу плана с кнопкой «Согласен»
 * (PDF в WhatsApp не грузим: страница плана уже есть и открывается на любом телефоне) или в Telegram-бот — план с
 * кнопками «Согласен», «Есть вопрос» и «Открыть план». Это то же «Отправить план пациенту» (PlanOffers, V140) с
 * настройками по умолчанию: цены действительны месяц. Отправляет сервер; имени пациента в ссылке нет.
 */
export function PlanSendSheet({ patient, onClose }: { patient: Patient; onClose: () => void }) {
  const client = useQueryClient()
  const [done, setDone] = useState('')
  const phone = contactPhone(patient)
  const send = useMutation<Schemas['PlanOffersSent'], ApiError, Channel>({
    mutationFn: (channel) => unwrap(api.POST('/api/patients/{patientId}/plan/offers', { params: { path: { patientId: patient.id } }, body: { channel } })),
    onSuccess: (sent, channel) => {
      haptic('success')
      if (channel === 'WHATSAPP' && phone && sent.text) openLink(whatsappUrl(phone, sent.text))
      setDone(channel === 'TELEGRAM' ? 'План отправлен в бот — с кнопками «Согласен» и «Есть вопрос»'
        : 'Открыли WhatsApp — в тексте ссылка на страницу плана с кнопкой «Согласен»')
      void client.invalidateQueries({ queryKey: ['plan-offers', patient.id] })
    },
    onError: () => haptic('error'),
  })
  const error = send.error ? Object.values(send.error.fieldErrors)[0] ?? send.error.message : null
  return (
    <Sheet label="Отправить план пациенту" title="Отправить план пациенту" onClose={onClose}>
      {done ? <p className="tone-ok" role="status">✅ {done}</p> : (
        <>
          <p className="hint small">Пациент откроет план со своими этапами и ценами и нажмёт «Согласен». Цены действительны месяц.</p>
          <div className="actions plan-send">
            {patient.telegram && (
              <button type="button" className="btn primary" disabled={send.isPending} onClick={() => send.mutate('TELEGRAM')}>В Telegram-бот</button>
            )}
            {phone && (
              <button type="button" className={patient.telegram ? 'btn' : 'btn primary'} disabled={send.isPending}
                onClick={() => send.mutate('WHATSAPP')}>В WhatsApp</button>
            )}
          </div>
          {!patient.telegram && !phone && <p className="hint small">Пациент не в боте и без телефона — распечатайте план.</p>}
          {error && <p className="error small" role="alert">{error}</p>}
          {send.error?.code === 'not-delivered' && phone && (
            <button type="button" className="btn small" onClick={() => send.mutate('WHATSAPP')}>Отправить в WhatsApp</button>
          )}
        </>
      )}
      {!done && <div className="actions"><button type="button" className="btn ghost" onClick={onClose}>Отмена</button></div>}
    </Sheet>
  )
}
