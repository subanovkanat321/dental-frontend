import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { createPortal } from 'react-dom'

import { api, unwrap } from '../api/client'
import type { Lang, TopicSlug } from './catalog'
import { Presentation } from './Presentation'
import { topicBySlug } from './topics'

export type LessonDialogProps = {
  topic: TopicSlug
  onClose: () => void
  /** Пациент приёма: презентация сразу на его языке в боте (кыргызский или русский) */
  patientId?: number | null
}

/**
 * «Показать пациенту» в CRM: презентация во весь экран на языке пациента, без цен. Только
 * показ — из CRM ничего не отправляем: после приёма пациент и так получает «Сообщение после приёма».
 * Отдельный чанк (React.lazy): слайды и рисунки скачиваются, только когда их открыли.
 */
export default function LessonDialog({ topic: slug, onClose, patientId }: LessonDialogProps) {
  const topic = topicBySlug(slug)!
  // Язык пациента в боте; нет прав на медкарту (регистратура) — 403: по-русски, язык переключат на слайде
  const target = useQuery({
    queryKey: ['lessons-target', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/lessons', { params: { path: { patientId: patientId! } } })),
    enabled: patientId != null,
    retry: false,
  })
  const [chosen, setChosen] = useState<Lang | null>(null)
  const lang: Lang = chosen ?? (target.data?.lang === 'KY' ? 'ky' : 'ru')

  // Поверх всего окна: карточка приёма — панель со своей прокруткой, внутри неё fixed мог бы обрезаться
  return createPortal(
    <Presentation topic={topic} lang={lang} onLang={setChosen} onClose={onClose} />,
    document.body,
  )
}
