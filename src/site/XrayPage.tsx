import { useEffect, useState } from 'react'

import type { Schemas } from '../api/client'
import { dateOf } from '../lib/time'
import { translator } from '../patient/i18n'
import { getJson, useSiteLang } from './web'
import { xrayToken } from './xrayToken'

type Page = Schemas['FileLinksPage']

/** «2026-11-20» → «20.11.2026» — как в подписи снимка в боте. */
const dmy = (date: string) => date.split('-').reverse().join('.')

/**
 * Снимок по ссылке из бота, WhatsApp или QR у кресла (V270 бэкенда): /x#<секрет>. Секрет — во фрагменте: не уходит ни в
 * журнал nginx, ни в Referer. На странице только снимок, клиника, дата и «Скачать» — ни имени пациента, ни подписи к
 * снимку: пересланная ссылка ничего о человеке не скажет. Истёкшая, отозванная и неизвестная — одно «Ссылка устарела».
 */
export function XrayPage() {
  const token = xrayToken()
  const [lang, setLang] = useSiteLang()
  const t = translator(lang)
  const [page, setPage] = useState<Page | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'gone' | 'offline'>(token ? 'loading' : 'gone')

  useEffect(() => {
    if (!token) return
    void getJson<Page>(`/web/x/${token}`).then(({ status, data }) => {
      setPage(data)
      setState(data ? 'ok' : status === 0 ? 'offline' : 'gone')
    })
  }, [token])

  const title = page?.takenOn ? t('xrayTitle', { date: dmy(page.takenOn) }) : ''
  return (
    <main className="site-page review-page xray-page">
      <div className="lang-switch" role="group" aria-label="Тил / Язык">
        <button type="button" aria-pressed={lang === 'ru'} onClick={() => setLang('ru')}>Русский</button>
        <button type="button" aria-pressed={lang === 'ky'} onClick={() => setLang('ky')}>Кыргызча</button>
      </div>
      {state === 'loading' && <p className="hint">…</p>}
      {state === 'gone' && <p role="alert" className="xray-gone">{t('xrayGone')}</p>}
      {state === 'offline' && <p role="alert">{t('noConnection')}</p>}
      {state === 'ok' && page && (
        <>
          <header className="review-head">
            <p className="review-clinic">{page.clinic}</p>
          </header>
          <section className="review-ask" aria-labelledby="xray-title">
            <h1 id="xray-title">{title}</h1>
            <a href={`/web/x/${token}/image`} target="_blank" rel="noreferrer" className="xray-image">
              <img src={`/web/x/${token}/image`} alt={title} />
            </a>
            <a className="btn primary xray-download" href={`/web/x/${token}/image?download=true`} download>⬇ {t('xrayDownload')}</a>
            {page.expiresAt && <p className="hint small">{t('xraySave', { date: dmy(dateOf(page.expiresAt)) })}</p>}
          </section>
        </>
      )}
    </main>
  )
}
