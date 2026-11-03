import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { SubHeader } from './SubHeader'

type Setting = Schemas['VisitReportControllerAiSetting']

/** Что клиника доверяет ИИ: у каждого своё согласие и свой адрес на сервере. */
const SWITCHES = [
  {
    key: 'visit-report-ai',
    path: '/api/clinic/visit-report-ai',
    title: 'ИИ пишет отчёты пациенту',
    hint: 'Черновик «Отчёта пациенту» — понятнее и на языке пациента. В ИИ уходят данные приёма (услуга, зубы, план, заметка) — без имени и телефона пациента. Выключено — черновик по шаблону.',
  },
  {
    key: 'dictation-ai',
    path: '/api/clinic/dictation-ai',
    title: 'ИИ разбирает голосовую диктовку',
    hint: '«🎤 Надиктовать» раскладывает сказанное по карте зубов, плану и заметке. В ИИ уходит текст диктовки — без имени и телефона пациента (телефоны и почта в тексте скрываются), звук не отправляется. Выключено — текст диктовки попадает в заметку как есть.',
  },
  {
    key: 'post-ai',
    path: '/api/clinic/post-ai',
    title: 'ИИ для постов «до / после»',
    hint: 'В конструкторе «до / после»: «✨ Написать с ИИ» — текст поста, «✨ Подогнать кадр» — улыбки на двух фото одного размера и на одном месте. ИИ не меняет фото — только подбирает кадр и пишет текст. Только у пациентов с согласием на публикацию. В ИИ уходят уменьшенные копии двух выбранных фото и название процедуры — без имени и телефона пациента. Выключено — текст по шаблону, кадр вручную.',
  },
] as const

type Switch = (typeof SWITCHES)[number]

/**
 * «Настройки → ИИ-помощник» (только админ клиники — сервер отвечает 403 остальным): отдельные
 * согласия — отчёты пациенту, разбор диктовки и посты «до / после». В диктовке сырой медицинский текст,
 * в постах — фото пациента, поэтому включение одного не включает другое.
 */
export function AiPage({ onBack }: { onBack: () => void }) {
  return (
    <section className="schedule-main">
      <SubHeader title="ИИ-помощник" onBack={onBack} />
      <p className="hint">Что клиника доверяет ИИ (Claude). Каждое — отдельно; включает и выключает администратор клиники.</p>
      {SWITCHES.map((s) => <AiSwitch key={s.key} s={s} />)}
    </section>
  )
}

function AiSwitch({ s }: { s: Switch }) {
  const client = useQueryClient()
  const setting = useQuery<Setting, ApiError>({
    queryKey: [s.key],
    queryFn: () => unwrap(api.GET(s.path)),
  })
  const turn = useMutation<Setting, ApiError, boolean>({
    mutationFn: (on) => unwrap(api.PUT(s.path, { body: { on } })),
    onSuccess: (now) => client.setQueryData([s.key], now),
  })
  const now = setting.data
  return (
    <section className="card-block" aria-label={s.title}>
      <label className="check">
        <input type="checkbox" checked={Boolean(now?.on)} disabled={!now?.available || turn.isPending}
          onChange={(e) => turn.mutate(e.target.checked)} /> <strong>{s.title}</strong>
      </label>
      <p className="hint small">{s.hint}</p>
      {now && !now.available && <p className="hint small">ИИ на сервере не подключён — включить пока нельзя.</p>}
      {(setting.error ?? turn.error) && <p className="error small" role="alert">{(setting.error ?? turn.error)!.message}</p>}
    </section>
  )
}
