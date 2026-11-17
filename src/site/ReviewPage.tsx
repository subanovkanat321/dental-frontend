import { useEffect, useState } from 'react'

import type { Schemas } from '../api/client'
import { dayLong, translator } from '../patient/i18n'
import { dateOf, timeOf } from '../lib/time'
import { reviewToken } from './reviewToken'
import { getJson, postJson, useSiteLang } from './web'

type Page = Schemas['ReviewLinksPage']

/**
 * Оценка приёма по ссылке из WhatsApp (V222 бэкенда): /r/<секрет> — для пациентов без Telegram. Логика — как у
 * бота: 5 ⭐ — большая кнопка «Оставить отзыв в 2ГИС» (и «Google»), 1–3 ⭐ — «Что было не так?» (текст уходит
 * врачу в карточку приёма, не публично), 4 ⭐ — спасибо. Имени пациента на странице нет — клиника, врач и дата.
 * Открыть ссылку — ничего не тратит: оценку ставит только нажатие на звезду.
 */
export function ReviewPage() {
  const token = reviewToken()
  const [lang, setLang] = useSiteLang()
  const t = translator(lang)
  const [page, setPage] = useState<Page | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'gone' | 'offline'>(token ? 'loading' : 'gone')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')

  useEffect(() => {
    if (!token) return
    void getJson<Page>(`/web/review/${token}`).then(({ status, data }) => {
      setPage(data)
      setState(data ? 'ok' : status === 0 ? 'offline' : 'gone')
    })
  }, [token])

  const send = async (path: string, body: unknown) => {
    setBusy(true)
    setError(null)
    const { status, data, problem } = await postJson<Page>(`/web/review/${token}${path}`, body)
    setBusy(false)
    if (data) return setPage(data)
    if (status === 404) return setState('gone')
    if (status === 409 && problem?.code === 'already-rated') {
      setError(t('reviewAlready'))
      const fresh = await getJson<Page>(`/web/review/${token}`)
      if (fresh.data) setPage(fresh.data)
      return
    }
    setError(status === 422 ? t('reviewEmpty') : status === 0 ? t('noConnection') : problem?.detail ?? t('noConnection'))
  }

  return (
    <main className="site-page review-page">
      <div className="lang-switch" role="group" aria-label="Тил / Язык">
        <button type="button" aria-pressed={lang === 'ru'} onClick={() => setLang('ru')}>Русский</button>
        <button type="button" aria-pressed={lang === 'ky'} onClick={() => setLang('ky')}>Кыргызча</button>
      </div>
      {state === 'loading' && <p className="hint">…</p>}
      {state === 'gone' && <p role="alert">{t('reviewGone')}</p>}
      {state === 'offline' && <p role="alert">{t('noConnection')}</p>}
      {state === 'ok' && page && (
        <>
          <header className="review-head">
            <p className="review-clinic">{page.clinicName}</p>
            <p className="hint">{t(page.doctorName ? 'reviewWhen' : 'reviewWhenNoDoctor', {
              date: `${dayLong(lang, dateOf(page.startAt))}, ${timeOf(page.startAt)}`, doctor: page.doctorName ?? '',
            })}</p>
          </header>
          {page.rating == null ? (
            <section className="review-ask" aria-labelledby="review-title">
              <h1 id="review-title">{t('reviewTitle')}</h1>
              <p>{t('reviewAsk')}</p>
              <div className="review-stars" role="group" aria-label={t('reviewTitle')}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" disabled={busy} aria-label={t('reviewStar', { n })} onClick={() => void send('', { rating: n })}>
                    <span aria-hidden="true">★</span><span className="review-star-n">{n}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <section className="review-done" aria-live="polite">
              <p className="review-given" aria-label={t('reviewStar', { n: page.rating })}>
                {'★'.repeat(page.rating)}<span className="review-off">{'★'.repeat(5 - page.rating)}</span>
              </p>
              <h1>{t('reviewThanks')}</h1>
              {page.rating >= 4 && <p>{t('reviewGood')}</p>}
              {(page.mapUrl || page.googleUrl) && (
                <div className="review-public">
                  <p>{t('review2gisAsk')}</p>
                  {page.mapUrl && <a className="btn primary review-2gis" href={page.mapUrl} target="_blank" rel="noopener noreferrer">{t('review2gisButton')}</a>}
                  {page.googleUrl && <a className="btn review-google" href={page.googleUrl} target="_blank" rel="noopener noreferrer">{t('reviewGoogleButton')}</a>}
                </div>
              )}
              {page.rating <= 3 && !page.commented && <p>{t('reviewBad')}</p>}
              {page.canComment && (
                <form className="review-comment-form" onSubmit={(e) => { e.preventDefault(); void send('/comment', { text }) }}>
                  <label className="field"><span>{t('reviewWhat')}</span>
                    <textarea rows={4} maxLength={1000} value={text} onChange={(e) => { setError(null); setText(e.target.value) }} /></label>
                  <p className="hint small">{t('reviewWhatHint')}</p>
                  <button type="submit" className="btn primary" disabled={busy || !text.trim()}>{t('reviewSend')}</button>
                </form>
              )}
              {page.commented && <p className="tone-ok" role="status">{t('reviewSaved')}</p>}
            </section>
          )}
          {error && <p className="error" role="alert">{error}</p>}
        </>
      )}
    </main>
  )
}
