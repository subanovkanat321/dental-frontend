import { lazy, Suspense, useState } from 'react'

import { Select } from '../layout/Select'
import type { AtlasMode } from '../atlas/ids'
import { topicForService, topicInfo, TOPICS, type TopicSlug } from './catalog'

// Слайды и рисунки — отдельным чанком: в карточке приёма только выбор темы
const LessonDialog = lazy(() => import('./LessonDialog'))
// 3D-атлас (three.js) — свой чанк, грузится только по кнопке «3D»
const AtlasPage = lazy(() => import('../atlas/AtlasPage'))

/** Тема презентации → режим 3D-атласа: у кариеса — стадии, у каналов — эндо и т.д.; остальное — здоровый зуб. */
const ATLAS_MODE: Partial<Record<TopicSlug, AtlasMode>> = { caries: 'caries', canals: 'endo', filling: 'filling', crown: 'crown', implant: 'implant' }

/**
 * «Показать пациенту» в карточке приёма: открывается значком 📖 в шапке — строка «тема + Показать».
 * Тема подобрана по услуге приёма (catalog.topicForService), можно выбрать другую. Только показ на
 * экране: отправлять пациенту не нужно — после приёма уходит «Сообщение после приёма».
 */
export function LessonPicker({ serviceName, patientId, onClose }: { serviceName?: string | null; patientId?: number | null; onClose: () => void }) {
  const suggested = topicForService(serviceName)
  const [topic, setTopic] = useState<TopicSlug | ''>(suggested ?? '')
  const [open, setOpen] = useState(false)
  const [atlas, setAtlas] = useState(false)
  const info = topicInfo(topic)
  return (
    <div className="lesson-line" role="group" aria-label="Показать пациенту">
      <Select className="lesson-topic" aria-label="Тема презентации" value={topic} onChange={(e) => setTopic(e.target.value as TopicSlug | '')}>
        {!suggested && <option value="">Выберите тему…</option>}
        {TOPICS.map((t) => <option key={t.slug} value={t.slug}>{t.emoji} {t.title.ru}</option>)}
      </Select>
      <button type="button" className="btn" disabled={!info} onClick={() => setOpen(true)}>Показать</button>
      <button type="button" className="btn" title="Интерактивный 3D-атлас: зуб в разрезе, челюсть, зуб мудрости" onClick={() => setAtlas(true)}>3D</button>
      <button type="button" className="btn ghost" aria-label="Закрыть выбор темы" onClick={onClose}>✕</button>
      {open && info && (
        <Suspense fallback={<p className="hint" role="status">Загрузка…</p>}>
          <LessonDialog topic={info.slug} patientId={patientId} onClose={() => setOpen(false)} />
        </Suspense>
      )}
      {atlas && (
        <Suspense fallback={<p className="hint" role="status">Загрузка 3D…</p>}>
          <AtlasPage route={{ mode: info ? ATLAS_MODE[info.slug] : undefined }} onClose={() => setAtlas(false)} />
        </Suspense>
      )}
    </div>
  )
}
