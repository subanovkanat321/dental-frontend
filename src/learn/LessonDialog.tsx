import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { createPortal } from 'react-dom'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { openLink } from '../lib/telegram'
import { lessonUrl, type Lang, type TopicSlug } from './catalog'
import { Presentation } from './Presentation'
import { topicBySlug } from './topics'

type Me = Schemas['BookingViewsMe']

export type LessonDialogProps = {
  topic: TopicSlug
  me: Me
  onClose: () => void
  /** Пациент приёма: его язык в боте и «Отправить в Telegram»; нет — только ссылка */
  patientId?: number | null
  /** Телефон пациента — для «WhatsApp» с готовым текстом (собирается в браузере, на сервер не уходит) */
  phone?: string | null
}

/**
 * «📖 Показать пациенту» в CRM: презентация во весь экран на языке пациента, с ценами клиники, а в
 * конце — «Отправить в Telegram» (сервер шлёт ссылку в бот, как план лечения) и ссылка для WhatsApp.
 * Отдельный чанк (React.lazy): слайды и рисунки скачиваются, только когда их открыли.
 */
export default function LessonDialog({ topic: slug, me, onClose, patientId, phone }: LessonDialogProps) {
  const topic = topicBySlug(slug)!
  // Прайс — тот же запрос, что у «Услуг»; ассистенту сервер присылает цены пустыми — слайд без чисел
  const services = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')) })
  // Язык пациента в боте и можно ли отправить; нет прав на медкарту (регистратура) — 403: только ссылка
  const target = useQuery({
    queryKey: ['lessons-target', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/lessons', { params: { path: { patientId: patientId! } } })),
    enabled: patientId != null,
    retry: false,
  })
  const [chosen, setChosen] = useState<Lang | null>(null)
  const lang: Lang = chosen ?? (target.data?.lang === 'KY' ? 'ky' : 'ru')
  const send = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/patients/{patientId}/lessons/{topic}/send', { params: { path: { patientId: patientId!, topic: slug } } })),
  })
  const [copied, setCopied] = useState(false)
  const code = me.clinic?.code
  const url = code ? lessonUrl(window.location.origin, slug, code, lang) : null
  const waText = url ? `${topic.title[lang]} — ${lang === 'ky' ? 'кыскача жана сүрөттөр менен' : 'коротко и с картинками'}: ${url}` : ''
  const copy = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(waText)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const actions = (
    <>
      {target.data?.telegram && (send.isSuccess
        ? <span className="lsn-sent" role="status">✓ Отправлено в Telegram</span>
        : <button type="button" className="btn primary" disabled={send.isPending} onClick={() => send.mutate()}>✈️ Отправить в Telegram</button>)}
      {url && phone && <button type="button" className="btn" onClick={() => openLink(`https://wa.me/${phone}?text=${encodeURIComponent(waText)}`)}>💬 Отправить в WhatsApp</button>}
      {url && <button type="button" className="btn" onClick={() => void copy()}>{copied ? '✓ Ссылка скопирована' : '🔗 Скопировать ссылку'}</button>}
      {send.error && <p className="lsn-error" role="alert">{send.error.message}</p>}
    </>
  )

  // Поверх всего окна: карточка приёма — панель со своей прокруткой, внутри неё fixed мог бы обрезаться
  return createPortal(
    <Presentation topic={topic} lang={lang} onLang={setChosen} services={services.data ?? []} onClose={onClose} endActions={actions} />,
    document.body,
  )
}
