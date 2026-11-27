import { lazy, Suspense, useState } from 'react'

import { Icon } from '../layout/Icon'
import type { TopicSlug } from './catalog'
import type { PosterSlug } from './posters'
import { PosterTiles, TopicTiles } from './Tiles'
import './learn.css'
import { Loading } from '../layout/Loading'
import { HelpHint } from '../help/HelpHint'

const LessonDialog = lazy(() => import('./LessonDialog'))
// Плакаты — свой чанк: просмотр во весь экран и кадры 1280 px нужны, только когда плакат открыли
const PosterView = lazy(() => import('./PosterView'))
// 3D-атлас (three.js, ~0,5 МБ) — свой чанк: скачивается, только когда его открыли
const AtlasPage = lazy(() => import('../atlas/AtlasPage'))

/**
 * Раздел «Для пациента» (#/learn): что показать на консультации — 3D-атлас, плакаты (как таблица на стене
 * у врача: строение зуба, кариес, дёсны, чем заменить зуб, зуб мудрости) и презентации по услугам. Без приёма и без данных пациента: можно посмотреть заранее или показать на
 * ТВ. Из карточки приёма — значок 📖 в шапке: там тема подбирается по услуге.
 * Раньше — «Настройки → Показать пациенту» и кнопка «3D-атлас» под меню (старый адрес ведёт сюда).
 */
export function LearnPage() {
  const [open, setOpen] = useState<TopicSlug | null>(null)
  const [atlas, setAtlas] = useState(false)
  const [poster, setPoster] = useState<PosterSlug | null>(null)
  const toId = (id: string) => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return (
    <div className="schedule-main learn-page">
      {/* Что здесь — в «?» у заголовка: абзац на две строки отодвигал плитки (шапка — одной строкой, PageHead) */}
      <header className="toolbar page-head">
        <div className="with-hint"><h1>Для пациента</h1>
          <HelpHint title="Для пациента">Показать на консультации: зуб в разрезе, плакаты — на них удобно показывать «вот здесь» — и короткие
            презентации: что это, почему лучше не откладывать, как проходит лечение и что делать после. Без цен и без данных пациента.</HelpHint>
        </div>
      </header>
      <div className="learn-start">
        <button type="button" className="learn-big" onClick={() => setAtlas(true)}>
          <span className="learn-big-ico" aria-hidden="true"><Icon name="atlas" /></span>
          <span className="learn-big-text"><strong>3D-атлас</strong>
            <span className="hint">Зуб в разрезе, челюсть и зуб мудрости — вращать и приближать</span></span>
        </button>
        <button type="button" className="learn-big" onClick={toId('learn-posters')}>
          <span className="learn-big-ico" aria-hidden="true"><PosterIcon /></span>
          <span className="learn-big-text"><strong>Плакаты</strong>
            <span className="hint">Крупно и с номерами — показать на экране «вот здесь»</span></span>
        </button>
        <button type="button" className="learn-big" onClick={toId('learn-topics')}>
          <span className="learn-big-ico" aria-hidden="true"><Icon name="learn" /></span>
          <span className="learn-big-text"><strong>Презентации</strong>
            <span className="hint">По услугам, 4–5 слайдов, по-русски и по-кыргызски</span></span>
        </button>
      </div>
      <h2 id="learn-posters" className="learn-h">Плакаты</h2>
      <PosterTiles lang="ru" onOpen={(p) => setPoster(p.slug)} />
      <h2 id="learn-topics" className="learn-h">Презентации</h2>
      <TopicTiles lang="ru" action="Показать" onOpen={(t) => setOpen(t.slug)} />
      {open && (
        <Suspense fallback={<Loading />}>
          <LessonDialog topic={open} onClose={() => setOpen(null)} />
        </Suspense>
      )}
      {poster && (
        <Suspense fallback={<Loading />}>
          <PosterView start={poster} onClose={() => setPoster(null)} />
        </Suspense>
      )}
      {atlas && (
        <Suspense fallback={<p className="hint" role="status">Загрузка 3D…</p>}>
          <AtlasPage route={{}} onClose={() => setAtlas(false)} />
        </Suspense>
      )}
    </div>
  )
}

/** Значок «плакат на стене»: лист на подвесе с зубом — в стиле линейных значков меню. */
function PosterIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3.5 12 2l3 1.5" /><rect x="4" y="4.5" width="16" height="16" rx="2" />
      <path d="M9.4 8.6c1-.6 1.9-.3 2.6 0 .7-.3 1.6-.6 2.6 0 1.2.8 1 2.6.5 3.8-.4 1-.6 3.4-1.4 3.4-.6 0-.6-2.1-1.7-2.1s-1.1 2.1-1.7 2.1c-.8 0-1-2.4-1.4-3.4-.5-1.2-.7-3 .5-3.8Z" />
    </svg>
  )
}
