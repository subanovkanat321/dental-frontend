import { lazy, Suspense, useState } from 'react'

import { SubHeader } from '../settings/SubHeader'
import type { TopicSlug } from './catalog'
import { TopicTiles } from './Tiles'
import './learn.css'

const LessonDialog = lazy(() => import('./LessonDialog'))

/**
 * «Настройки → Показать пациенту»: все темы презентаций обложками — открыть на консультации без
 * приёма или посмотреть заранее. Из карточки приёма — значок 📖 в шапке, тема по услуге.
 */
export function LearnPage({ onBack }: { onBack: () => void }) {
  const [open, setOpen] = useState<TopicSlug | null>(null)
  return (
    <div className="schedule-main learn-page">
      <SubHeader title="Показать пациенту" onBack={onBack} />
      <p className="hint">Короткие презентации с картинками: что это, что будет без лечения, как лечим, больно ли и что делать после.
        «Цена ожидания» — на ценах из «Услуг». В карточке приёма — значок 📖 в шапке: тема подбирается по услуге.</p>
      <TopicTiles lang="ru" onOpen={(t) => setOpen(t.slug)} />
      {open && (
        <Suspense fallback={<p className="hint" role="status">Загрузка…</p>}>
          <LessonDialog topic={open} onClose={() => setOpen(null)} />
        </Suspense>
      )}
    </div>
  )
}
