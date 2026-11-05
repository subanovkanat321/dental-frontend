import { lazy, Suspense, useState } from 'react'

import { Select } from '../layout/Select'
import { topicForService, topicInfo, TOPICS, type TopicSlug } from './catalog'

// Слайды и рисунки — отдельным чанком: в карточке приёма только выбор темы
const LessonDialog = lazy(() => import('./LessonDialog'))

/**
 * «Показать пациенту» в карточке приёма: открывается значком 📖 в шапке — строка «тема + Показать».
 * Тема подобрана по услуге приёма (catalog.topicForService), можно выбрать другую. Только показ на
 * экране: отправлять пациенту не нужно — после приёма уходит «Сообщение после приёма».
 */
export function LessonPicker({ serviceName, patientId, onClose }: { serviceName?: string | null; patientId?: number | null; onClose: () => void }) {
  const suggested = topicForService(serviceName)
  const [topic, setTopic] = useState<TopicSlug | ''>(suggested ?? '')
  const [open, setOpen] = useState(false)
  const info = topicInfo(topic)
  return (
    <div className="lesson-line" role="group" aria-label="Показать пациенту">
      <Select className="lesson-topic" aria-label="Тема презентации" value={topic} onChange={(e) => setTopic(e.target.value as TopicSlug | '')}>
        {!suggested && <option value="">Выберите тему…</option>}
        {TOPICS.map((t) => <option key={t.slug} value={t.slug}>{t.emoji} {t.title.ru}</option>)}
      </Select>
      <button type="button" className="btn" disabled={!info} onClick={() => setOpen(true)}>Показать</button>
      <button type="button" className="btn ghost" aria-label="Закрыть выбор темы" onClick={onClose}>✕</button>
      {open && info && (
        <Suspense fallback={<p className="hint" role="status">Загрузка…</p>}>
          <LessonDialog topic={info.slug} patientId={patientId} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}
