import { useState } from 'react'

import { Spinner } from '../layout/Loading'
import { channelLink, LINK_CHANNELS } from '../lib/channels'
import { qrSvg, useQr } from '../lib/qr'
import { QrSvg } from '../lib/QrSvg'

/**
 * «Ссылки для записи»: своя ссылка на каждый канал — Instagram, 2ГИС, WhatsApp-статус, рилсы, QR на ресепшн.
 * У каждой метка `?from=…`: новый пациент, записавшийся по ней, попадёт в «Аналитика → Пациенты от Tish» с этим
 * каналом (бэкенд, V232). Метку страница клиники передаёт и в бота, и в форму записи; данных пациента в ссылке нет.
 * QR — тем же кодом, что вход по QR (`useQr`), его можно скачать и распечатать.
 */
export function BookingLinks({ clinicCode }: { clinicCode: string }) {
  const origin = window.location.origin
  const [copied, setCopied] = useState<{ slug: string; ok: boolean } | null>(null)
  const copy = async (slug: string, link: string) => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied({ slug, ok: true })
    } catch {
      setCopied({ slug, ok: false })
    }
  }
  return (
    <section className="card-block booking-links" aria-label="Ссылки для записи">
      <h2>Ссылки для записи</h2>
      <p className="hint">Своя ссылка в каждое место — и в «Аналитике» видно, откуда пришли новые пациенты: «Пациенты от Tish».
        Ссылка ведёт на страницу клиники: запись в Telegram или прямо на сайте.</p>
      {LINK_CHANNELS.map(({ slug, title, where }) => {
        const link = channelLink(origin, clinicCode, slug)
        return (
          <div key={slug} className="booking-link">
            <div className="booking-link-head"><b>{title}</b><span className="hint small">{where}</span></div>
            <a href={link} target="_blank" rel="noopener noreferrer">{link}</a>
            <div className="actions">
              <button type="button" className="btn small" aria-label={`Скопировать ссылку: ${title}`} onClick={() => void copy(slug, link)}>Скопировать</button>
            </div>
            {copied?.slug === slug && (copied.ok
              ? <p className="tone-ok small" role="status">Ссылка «{title}» скопирована</p>
              : <p className="hint small" role="status">Скопировать не получилось — нажмите на ссылку и удерживайте, затем «Копировать»</p>)}
            {slug === 'qr' && <QrBlock link={link} />}
          </div>
        )
      })}
    </section>
  )
}

/** QR ссылки «на ресепшн»: картинка и «Скачать QR» (SVG — печатается чётко любого размера). */
function QrBlock({ link }: { link: string }) {
  const qr = useQr(link)
  if (qr === 'error') return <p className="hint small">QR не открылся — обновите страницу.</p>
  if (!qr) return <Spinner />
  const download = () => {
    const url = URL.createObjectURL(new Blob([qrSvg(qr)], { type: 'image/svg+xml' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'tish-qr-zapis.svg'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <div className="booking-qr">
      <div className="login-qr-plate"><QrSvg qr={qr} label="QR-код записи в клинику для ресепшн" /></div>
      <button type="button" className="btn small ghost" onClick={download}>Скачать QR</button>
    </div>
  )
}
