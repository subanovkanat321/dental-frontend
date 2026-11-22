import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, upload, type Schemas } from '../api/client'
import { Loading, Spinner } from '../layout/Loading'
import { SaveBar } from '../layout/SaveBar'
import { useBlobUrl } from '../lib/useBlobUrl'
import { useDirty } from '../lib/unsaved'

type Pay = Schemas['PayRequisitesDoctorPay']

/**
 * «Как оплатить мне» в карточке врача (V225 бэкенда): банк и номер свободным текстом и картинка QR. Заполняют сам
 * врач и руководитель (сервер проверяет то же, регистратуре — 403). Напоминание о долге берёт эти реквизиты, если
 * весь долг — за приёмы этого врача и выручку он берёт сам (аренда кресла или «врачи работают отдельно»): тогда
 * ownRevenue. QR пациенту — в Telegram картинкой, в WhatsApp — ссылкой на страницу /pay/… (payUrl).
 */
export function DoctorPay({ doctorId, self }: { doctorId: number; self: boolean }) {
  const pay = useQuery({
    queryKey: ['doctor-pay', doctorId],
    queryFn: () => unwrap(api.GET('/api/doctors/{id}/pay', { params: { path: { id: doctorId } } })),
    retry: false,
  })
  if (pay.isPending) return <Loading />
  if (pay.error) return <p className="error">{pay.error.message}</p>
  return <PayForm key={doctorId} doctorId={doctorId} self={self} pay={pay.data} />
}

function PayForm({ doctorId, self, pay }: { doctorId: number; self: boolean; pay: Pay }) {
  const client = useQueryClient()
  const [details, setDetails] = useState(pay.details ?? '')
  const { dirty, commit } = useDirty({ details: details.trim() })
  // Картинку перечитываем по адресу страницы: новый QR — новый токен
  const qr = useBlobUrl(pay.hasQr ? `/api/doctors/${doctorId}/pay/qr?v=${encodeURIComponent(pay.payUrl ?? '1')}` : null)
  const saved = (p: Pay) => client.setQueryData(['doctor-pay', doctorId], p)
  const save = useMutation<Pay, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/doctors/{id}/pay', { params: { path: { id: doctorId } }, body: { details: details.trim() } })),
    onSuccess: (p) => {
      commit()
      saved(p)
    },
  })
  const uploadQr = useMutation<Pay, ApiError, File>({
    mutationFn: (file) => {
      const body = new FormData()
      body.append('file', file)
      return upload(`/api/doctors/${doctorId}/pay/qr`, body)
    },
    onSuccess: saved,
  })
  const removeQr = useMutation<Pay, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/doctors/{id}/pay/qr', { params: { path: { id: doctorId } } })),
    onSuccess: saved,
  })
  const qrError = uploadQr.error ?? removeQr.error

  return (
    <div className="doctor-pay" role="group" aria-label="Как оплатить мне">
      <label className="field">
        <span>{self ? 'Как оплатить мне' : 'Как оплатить врачу'}</span>
        <textarea rows={2} maxLength={500} placeholder="MBANK 0555 123 456 (Айгерим С.)" value={details}
          onChange={(e) => { save.reset(); setDetails(e.target.value) }} />
      </label>
      <div className="qr-row">
        {qr && qr !== 'error' && <img className="pay-qr" src={qr.url} alt="QR для оплаты" />}
        <label className="btn">
          {uploadQr.isPending ? <><Spinner />Загружаем…</> : pay.hasQr ? 'Заменить QR' : 'Загрузить QR'}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="QR для оплаты"
            disabled={uploadQr.isPending}
            onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) uploadQr.mutate(file) }} />
        </label>
        {pay.hasQr && <button type="button" className="btn ghost" disabled={removeQr.isPending} onClick={() => removeQr.mutate()}>Удалить QR</button>}
      </div>
      {qrError && <p className="error" role="alert">{qrError.fieldErrors.file ?? qrError.message}</p>}
      <p className="hint small">
        {pay.ownRevenue
          ? 'Напоминание о долге за ваши приёмы уйдёт с этими реквизитами: QR в Telegram — картинкой, в WhatsApp — ссылкой.'
          : 'Выручку собирает клиника, поэтому в напоминании о долге — реквизиты клиники. Свои уйдут пациенту, если врач на аренде кресла («Касса → Зарплата») или клиника работает в режиме «Врачи работают отдельно».'}
      </p>
      <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} savedText="Реквизиты сохранены" label="Сохранить реквизиты"
        error={save.error && (save.error.fieldErrors.details ?? save.error.message)} onSave={() => save.mutate()} />
    </div>
  )
}
