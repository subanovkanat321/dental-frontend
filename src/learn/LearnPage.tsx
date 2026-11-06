import { lazy, Suspense, useState } from 'react'

import { Icon } from '../layout/Icon'
import type { TopicSlug } from './catalog'
import { TopicTiles } from './Tiles'
import './learn.css'
import { Loading } from '../layout/Loading'

const LessonDialog = lazy(() => import('./LessonDialog'))
// 3D-атлас (three.js, ~0,5 МБ) — свой чанк: скачивается, только когда его открыли
const AtlasPage = lazy(() => import('../atlas/AtlasPage'))

/**
 * Раздел «Для пациента» (#/learn): что показать на консультации — 3D-атлас и презентации по услугам
 * (все темы обложками). Без приёма и без данных пациента: можно посмотреть заранее или показать на
 * ТВ. Из карточки приёма — значок 📖 в шапке: там тема подбирается по услуге.
 * Раньше — «Настройки → Показать пациенту» и кнопка «3D-атлас» под меню (старый адрес ведёт сюда).
 */
export function LearnPage() {
  const [open, setOpen] = useState<TopicSlug | null>(null)
  const [atlas, setAtlas] = useState(false)
  const toTopics = () => document.getElementById('learn-topics')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return (
    <div className="schedule-main learn-page">
      <header className="toolbar"><h1>Для пациента</h1></header>
      <p className="hint">Показать на консультации: зуб в разрезе и короткие презентации — что это, почему лучше не откладывать, как
        проходит лечение и что делать после. Без цен и без данных пациента.</p>
      <div className="learn-start">
        <button type="button" className="learn-big" onClick={() => setAtlas(true)}>
          <span className="learn-big-ico" aria-hidden="true"><Icon name="atlas" /></span>
          <span className="learn-big-text"><strong>3D-атлас</strong>
            <span className="hint">Зуб в разрезе, кариес, каналы, пломба, коронка, имплант, челюсть и зуб мудрости — вращать и приближать</span></span>
        </button>
        <button type="button" className="learn-big" onClick={toTopics}>
          <span className="learn-big-ico" aria-hidden="true"><Icon name="learn" /></span>
          <span className="learn-big-text"><strong>Презентации по услугам</strong>
            <span className="hint">Кариес, каналы, имплант и другие — 4–5 слайдов, по-русски и по-кыргызски</span></span>
        </button>
      </div>
      <h2 id="learn-topics" className="learn-h">Презентации</h2>
      <TopicTiles lang="ru" action="Показать" onOpen={(t) => setOpen(t.slug)} />
      {open && (
        <Suspense fallback={<Loading />}>
          <LessonDialog topic={open} onClose={() => setOpen(null)} />
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
