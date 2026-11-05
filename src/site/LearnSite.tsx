import { useEffect, useState } from 'react'

import { lessonUrl, type Lang } from '../learn/catalog'
import { Presentation } from '../learn/Presentation'
import { TopicTiles } from '../learn/Tiles'
import { topicBySlug, UI } from '../learn/topics'
import { getJson, useSiteLang, type ClinicPage } from './web'

/** Тема из адреса /learn/<тема>; /learn — список всех тем. */
function learnSlug(path = window.location.pathname): string | null {
  return path.match(/^\/learn\/([a-z]+)/)?.[1] ?? null
}

/** Код клиники из ?c= — только буквы и цифры, как у /c/<код>. */
function clinicParam(): string | null {
  const c = new URLSearchParams(window.location.search).get('c')
  return c && /^[a-z0-9]{1,40}$/i.test(c) ? c : null
}

/**
 * Презентация темы без входа (/learn/caries?c=<код клиники>&lang=ky) — ссылка, которую врач
 * отправил пациенту. На странице нет ничего о пациенте: только общая тема, название клиники по её коду
 * (то же, что на открытой странице /c/<код>) и «Записаться». Цен нет: у каждой клиники и врача свои.
 */
export function LearnSite() {
  const [siteLang, setSiteLang] = useSiteLang()
  const param = new URLSearchParams(window.location.search).get('lang')
  const [override, setOverride] = useState<Lang | null>(param === 'ky' || param === 'ru' ? param : null)
  const lang: Lang = override ?? siteLang
  const setLang = (l: Lang) => { setOverride(null); setSiteLang(l) }
  const code = clinicParam()
  const topic = topicBySlug(learnSlug())
  const [clinic, setClinic] = useState<ClinicPage | null>(null)

  useEffect(() => {
    if (!code) return
    void getJson<ClinicPage>(`/web/clinic?code=${encodeURIComponent(code)}`).then(({ data }) => setClinic(data))
  }, [code])
  useEffect(() => {
    document.documentElement.lang = lang
    document.title = topic ? topic.title[lang] : UI.topics[lang]
  }, [lang, topic])

  if (!topic) {
    return (
      <main className="site-page learn-site">
        <div className="lang-switch" role="group" aria-label="Тил / Язык">
          <button type="button" aria-pressed={lang === 'ru'} onClick={() => setLang('ru')}>Русский</button>
          <button type="button" aria-pressed={lang === 'ky'} onClick={() => setLang('ky')}>Кыргызча</button>
        </div>
        <h1>{lang === 'ky' ? 'Тиш дарылоо тууралуу кыскача' : 'Коротко о лечении зубов'}</h1>
        <p className="hint">{lang === 'ky' ? 'Жөнөкөй сөздөр жана иллюстрациялар менен — бир мүнөттө.' : 'Простыми словами и с иллюстрациями — за минуту.'}</p>
        <TopicTiles lang={lang} href={(t) => lessonUrl('', t.slug, code, lang)} />
      </main>
    )
  }
  const book = code && clinic ? (clinic.bookingUrl ?? `/c/${code}`) : null
  return (
    <Presentation topic={topic} lang={lang} onLang={setLang} overlay={false} brand={clinic?.name}
      endActions={(
        <>
          {book && <a className="btn primary" href={book}>📅 {lang === 'ky' ? 'Жазылуу' : 'Записаться'}</a>}
          <a className="btn" href={lessonUrl('', topic.slug, code, lang).replace(`/learn/${topic.slug}`, '/learn')}>📚 {UI.topics[lang]}</a>
        </>
      )} />
  )
}
