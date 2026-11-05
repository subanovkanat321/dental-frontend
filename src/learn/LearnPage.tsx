import { lazy, Suspense, useState } from 'react'

import type { Schemas } from '../api/client'
import { SubHeader } from '../settings/SubHeader'
import type { TopicSlug } from './catalog'
import { TopicTiles } from './Tiles'
import './learn.css'

type Me = Schemas['BookingViewsMe']

const LessonDialog = lazy(() => import('./LessonDialog'))

/**
 * «Настройки → Показать пациенту»: все темы презентаций обложками — открыть на консультации без
 * приёма или посмотреть заранее. Отсюда — без пациента: в конце только ссылка (Telegram — из приёма).
 */
export function LearnPage({ me, onBack }: { me: Me; onBack: () => void }) {
  const [open, setOpen] = useState<TopicSlug | null>(null)
  return (
    <div className="schedule-main learn-page">
      <SubHeader title="Показать пациенту" onBack={onBack} />
      <p className="hint">Короткие презентации с иллюстрациями: что это, почему лучше не откладывать, как проходит лечение, больно ли
        и что делать после. Без цен — только общая информация. Из карточки приёма тема подбирается по услуге.</p>
      <TopicTiles lang="ru" onOpen={(t) => setOpen(t.slug)} />
      {open && (
        <Suspense fallback={<p className="hint" role="status">Загрузка…</p>}>
          <LessonDialog topic={open} me={me} onClose={() => setOpen(null)} />
        </Suspense>
      )}
    </div>
  )
}
