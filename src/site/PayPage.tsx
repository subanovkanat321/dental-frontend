import { useEffect, useState } from 'react'

import type { Schemas } from '../api/client'
import { translator } from '../patient/i18n'
import { payToken } from './payToken'
import { getJson, useSiteLang } from './web'

type Page = Schemas['PayRequisitesPage']

/**
 * QR для оплаты по ссылке из напоминания о долге в WhatsApp (V224 бэкенда): /pay/<токен>. Картинку ссылкой wa.me не
 * приложить — пациент открывает эту страницу. На ней только QR, клиника (и врач, если QR его) и реквизиты: ни имени
 * пациента, ни суммы — сумма есть в самом сообщении. Клиника заменила QR — старая ссылка больше не открывается.
 */
export function PayPage() {
  const token = payToken()
  const [lang, setLang] = useSiteLang()
  const t = translator(lang)
  const [page, setPage] = useState<Page | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'gone' | 'offline'>(token ? 'loading' : 'gone')

  useEffect(() => {
    if (!token) return
    void getJson<Page>(`/web/pay/${token}`).then(({ status, data }) => {
      setPage(data)
      setState(data ? 'ok' : status === 0 ? 'offline' : 'gone')
    })
  }, [token])

  return (
    <main className="site-page review-page pay-page">
      <div className="lang-switch" role="group" aria-label="Тил / Язык">
        <button type="button" aria-pressed={lang === 'ru'} onClick={() => setLang('ru')}>Русский</button>
        <button type="button" aria-pressed={lang === 'ky'} onClick={() => setLang('ky')}>Кыргызча</button>
      </div>
      {state === 'loading' && <p className="hint">…</p>}
      {state === 'gone' && <p role="alert">{t('payGone')}</p>}
      {state === 'offline' && <p role="alert">{t('noConnection')}</p>}
      {state === 'ok' && page && (
        <>
          <header className="review-head">
            <p className="review-clinic">{page.clinicName}</p>
            {page.doctorName && <p className="hint">{t('payDoctor', { doctor: page.doctorName })}</p>}
          </header>
          <section className="review-ask" aria-labelledby="pay-title">
            <h1 id="pay-title">{t('payTitle')}</h1>
            <img className="pay-page-qr" src={`/web/pay/${token}/qr`} alt={t('payTitle')} />
            <p className="hint">{t('payScan')}</p>
            {page.details && (
              <div className="pay-details">
                <h2>{t('payDetails')}</h2>
                <p>{page.details}</p>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}
