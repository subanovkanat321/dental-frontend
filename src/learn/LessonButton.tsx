import { lazy, Suspense, useState } from 'react'

import type { Schemas } from '../api/client'
import { Select } from '../layout/Select'
import { topicForService, topicInfo, TOPICS, type TopicSlug } from './catalog'

type Me = Schemas['BookingViewsMe']

// Слайды и рисунки — отдельным чанком: в карточке приёма только кнопка и список тем
const LessonDialog = lazy(() => import('./LessonDialog'))

/**
 * «📖 Показать пациенту» в карточке приёма: тема подобрана по услуге приёма (catalog.topicForService),
 * рядом — выбор другой темы. Не подобралась — сначала выбрать тему.
 */
export function LessonButton({ serviceName, me, patientId, phone }: { serviceName?: string | null; me: Me; patientId?: number | null; phone?: string | null }) {
  const suggested = topicForService(serviceName)
  const [topic, setTopic] = useState<TopicSlug | ''>(suggested ?? '')
  const [open, setOpen] = useState(false)
  const info = topicInfo(topic)
  return (
    <div className="lesson-line">
      <button type="button" className="btn" disabled={!info} onClick={() => setOpen(true)}>
        📖 Показать пациенту{info ? `: ${info.title.ru}` : ''}
      </button>
      <Select className="lesson-topic" aria-label="Тема презентации" value={topic} onChange={(e) => setTopic(e.target.value as TopicSlug | '')}>
        {!suggested && <option value="">Выберите тему…</option>}
        {TOPICS.map((t) => <option key={t.slug} value={t.slug}>{t.emoji} {t.title.ru}</option>)}
      </Select>
      {open && info && (
        <Suspense fallback={<p className="hint" role="status">Загрузка…</p>}>
          <LessonDialog topic={info.slug} me={me} patientId={patientId} phone={phone} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}
