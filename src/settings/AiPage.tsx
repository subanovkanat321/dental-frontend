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
    hint: 'Личная часть «Сообщения после приёма» и черновики ответов на вопросы пациентов — понятнее и на языке пациента; уход дома всегда из памятки клиники. В ИИ уходят данные приёма (услуга, зубы, план, заметка) — без имени и телефона пациента. Выключено — черновик по шаблону.',
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
  {
    key: 'bot-ai',
    path: '/api/clinic/bot-ai',
    title: 'ИИ отвечает пациентам в боте',
    hint: 'Пациент пишет боту — ИИ сразу отвечает от имени клиники только по данным клиники: адрес, телефоны, часы, выходные, услуги и цены «от», врачи, предоплата, как записаться, ближайшие свободные окна — и даёт кнопку «Записаться на приём». Сам не записывает. Медицинское, жалобы, просьба позвать человека («администратор») — передаёт вам в «Пациенты → Вопросы». Все ответы ИИ видны там с пометкой «🤖 Ответил ИИ». В ИИ уходит текст сообщений пациента в этом чате (телефоны скрыты) — без имени, телефона и медкарты. Выключено — как раньше: вопросы сотрудникам.',
    warning: 'ИИ отвечает пациентам сам, без проверки сотрудником. Он не ставит диагнозы и не советует лечение, но может ошибиться — заполните «О клинике», «Часы работы», «Услуги» и «Врачи» и время от времени просматривайте его ответы.',
    needsReports: true,
  },
] as const

type Switch = (typeof SWITCHES)[number]

const REPORTS_KEY = 'visit-report-ai'

/**
 * «Настройки → ИИ-помощник» (только админ клиники — сервер отвечает 403 остальным): отдельные
 * согласия — отчёты пациенту, разбор диктовки и посты «до / после». В диктовке сырой медицинский текст,
 * в постах — фото пациента, поэтому включение одного не включает другое. «ИИ отвечает пациентам в боте» —
 * только поверх «ИИ пишет отчёты пациенту» (общее согласие клиники): без него переключатель не нажать, а
 * выключили общий — сервер выключает и бот.
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
    onSuccess: (now) => {
      client.setQueryData([s.key], now)
      // Выключили общий ИИ — сервер выключил и ответы в боте
      if (s.key === REPORTS_KEY && !now.on) void client.invalidateQueries({ queryKey: ['bot-ai'] })
    },
  })
  // Общее согласие — тот же запрос, что у первого переключателя (из кэша)
  const reports = useQuery<Setting, ApiError>({
    queryKey: [REPORTS_KEY],
    queryFn: () => unwrap(api.GET('/api/clinic/visit-report-ai')),
    enabled: 'needsReports' in s,
  })
  const blocked = 'needsReports' in s && reports.data != null && !reports.data.on && !setting.data?.on
  const now = setting.data
  return (
    <section className="card-block" aria-label={s.title}>
      <label className="check">
        <input type="checkbox" checked={Boolean(now?.on)} disabled={!now?.available || turn.isPending || blocked}
          onChange={(e) => turn.mutate(e.target.checked)} /> <strong>{s.title}</strong>
      </label>
      <p className="hint small">{s.hint}</p>
      {'warning' in s && <p className="notice tone-wait">⚠️ {s.warning}</p>}
      {now?.available && blocked && <p className="hint small">Сначала включите «ИИ пишет отчёты пациенту» — это общее согласие клиники на ИИ.</p>}
      {now && !now.available && <p className="hint small">ИИ на сервере не подключён — включить пока нельзя.</p>}
      {(setting.error ?? turn.error) && <p className="error small" role="alert">{(setting.error ?? turn.error)!.message}</p>}
    </section>
  )
}
