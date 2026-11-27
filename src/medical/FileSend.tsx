import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Sheet } from '../layout/Sheet'
import { ask } from '../lib/confirm'
import { useQr } from '../lib/qr'
import { QrSvg } from '../lib/QrSvg'
import { haptic, inTelegram } from '../lib/telegram'
import { whatsappUrl } from '../lib/texts'
import { dateOf } from '../lib/time'

type FileView = Schemas['PatientFilesView']
type Link = Schemas['FileLinksLink']

/** «2026-12-27» → «27.12.2026». */
const dmy = (date: string) => date.split('-').reverse().join('.')

/**
 * «📤 Отправить пациенту» у снимка (V270 бэкенда): в бот — картинкой с подписью «Снимок от … — клиника», иначе ссылкой
 * /x#… — WhatsApp с готовым текстом или QR, который пациент сканирует камерой прямо в кресле. Ссылка живёт 30 дней,
 * «Отозвать ссылку» — под снимком. Права и журнал — на сервере; сама ссылка (секрет) живёт только в этом окне: в
 * консоль, адрес и localStorage не попадает.
 *
 * @param phone телефон пациента или представителя для WhatsApp; нет — только бот и QR
 */
export function FileSend({ patientId, file, phone }: { patientId: number; file: FileView; phone?: string | null }) {
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState('')
  const refresh = () => client.invalidateQueries({ queryKey: ['files', patientId] })
  const revoke = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/patients/{patientId}/files/{fileId}/link', { params: { path: { patientId, fileId: file.id } } })),
    onSuccess: () => {
      setSent('Ссылка отозвана — больше не откроется')
      void refresh()
    },
  })
  return (
    <span className="file-send">
      <button type="button" className="link" onClick={() => { setSent(''); setOpen(true) }}>📤 Отправить пациенту</button>
      {file.linkUntil && (
        <button type="button" className="link danger-link" disabled={revoke.isPending}
          title={`Ссылка действует до ${dmy(dateOf(file.linkUntil))}`}
          onClick={() => void ask('Отозвать ссылку на снимок? Пациент больше не сможет её открыть.').then((ok) => ok && revoke.mutate())}>
          Отозвать ссылку
        </button>
      )}
      {sent && <span className="tone-ok small" role="status">{sent}</span>}
      {revoke.error && <span className="error small" role="alert">{revoke.error.message}</span>}
      {open && <SendSheet patientId={patientId} file={file} phone={phone} onClose={() => setOpen(false)}
        onSent={(text) => { setSent(text); void refresh() }} />}
    </span>
  )
}

function SendSheet({ patientId, file, phone, onClose, onSent }: {
  patientId: number; file: FileView; phone?: string | null; onClose: () => void; onSent: (text: string) => void
}) {
  const target = useQuery({
    queryKey: ['file-send-target', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/files/send-target', { params: { path: { patientId } } })),
  })
  const [mode, setMode] = useState<'pick' | 'whatsapp' | 'qr'>('pick')
  const bot = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/patients/{patientId}/files/{fileId}/send', { params: { path: { patientId, fileId: file.id } } })),
    onSuccess: () => {
      haptic('success')
      onSent('Отправлено в Telegram')
      onClose()
    },
    onError: () => haptic('error'),
  })
  const link = useMutation<Link, ApiError, 'whatsapp' | 'qr'>({
    mutationFn: () => unwrap(api.POST('/api/patients/{patientId}/files/{fileId}/link', { params: { path: { patientId, fileId: file.id } } })),
    onSuccess: (_, how) => {
      setMode(how)
      onSent('Ссылка создана — действует 30 дней')
    },
  })
  const data = link.data
  return (
    <Sheet label="Отправить снимок пациенту" title="Отправить снимок пациенту" onClose={onClose}>
      {mode === 'pick' && (
        <>
          <ul className="choice-list" aria-label="Как отправить">
            {target.data?.telegram && (
              <li><button type="button" className="choice-item" disabled={bot.isPending} onClick={() => bot.mutate()}>
                <span className="choice-icon" aria-hidden="true">✈️</span>
                <span className="choice-text"><span className="choice-name">В Telegram</span><span className="choice-hint">Бот клиники пришлёт снимок картинкой</span></span>
              </button></li>
            )}
            {phone && (
              <li><button type="button" className="choice-item" disabled={link.isPending} onClick={() => link.mutate('whatsapp')}>
                <span className="choice-icon" aria-hidden="true">💬</span>
                <span className="choice-text"><span className="choice-name">Ссылкой в WhatsApp</span><span className="choice-hint">Готовый текст со ссылкой — пациент откроет и скачает</span></span>
              </button></li>
            )}
            <li><button type="button" className="choice-item" disabled={link.isPending} onClick={() => link.mutate('qr')}>
              <span className="choice-icon" aria-hidden="true">🔳</span>
              <span className="choice-text"><span className="choice-name">Показать QR</span><span className="choice-hint">Пациент наводит камеру телефона — снимок откроется у него</span></span>
            </button></li>
          </ul>
          <p className="hint small">На странице по ссылке — только снимок, клиника и дата: без имени и подписи. Ссылка действует 30 дней.</p>
          {bot.error && <p className="error small" role="alert">{bot.error.code === 'not-delivered' ? `${bot.error.message}. Отправьте ссылкой или покажите QR.` : bot.error.message}</p>}
          {link.error && <p className="error small" role="alert">{link.error.message}</p>}
        </>
      )}
      {mode === 'whatsapp' && data?.text && phone && (
        <div className="file-send-link">
          <p className="file-send-text">{data.text}</p>
          <a className="btn primary" href={whatsappUrl(phone, data.text)} target="_blank" rel="noreferrer"
            onClick={(e) => { inTelegram(whatsappUrl(phone, data.text ?? ''))(e); onClose() }}>💬 Открыть WhatsApp</a>
          <button type="button" className="btn" onClick={() => setMode('qr')}>🔳 Показать QR</button>
        </div>
      )}
      {mode === 'qr' && data?.url && <LinkQr url={data.url} expiresAt={data.expiresAt} />}
    </Sheet>
  )
}

/** Крупный QR ссылки: пациент сканирует камерой телефона с экрана врача. */
function LinkQr({ url, expiresAt }: { url: string; expiresAt?: string }) {
  const qr = useQr(url)
  return (
    <div className="file-send-qr">
      <div className="file-send-qr-plate">
        {qr && qr !== 'error' ? <QrSvg qr={qr} label="QR-код снимка: наведите камеру телефона" />
          : <span className="hint">{qr === 'error' ? 'QR не загрузился — отправьте ссылкой' : '…'}</span>}
      </div>
      <p>Попросите пациента навести камеру телефона на код — откроется снимок с кнопкой «Скачать».</p>
      {expiresAt && <p className="hint small">Ссылка действует до {dmy(dateOf(expiresAt))}.</p>}
    </div>
  )
}
