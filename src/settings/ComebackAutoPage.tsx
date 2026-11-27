import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Loading } from '../layout/Loading'
import { Select } from '../layout/Select'
import { shortDay } from '../lib/time'
import { SubHeader } from './SubHeader'

type View = Schemas['AutoComebacksView']
type Settings = Schemas['AutoComebacksSettings']
type Run = Schemas['AutoComebacksRun']

const KEY = ['comeback-auto']

/** Днём по Бишкеку, как на сервере (9–18). */
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]

const LIMITS = [5, 10, 20, 30, 50]

/** Причины — как карточки «Позвать снова»; порядок — как зовёт Tish (план лечения — первым). */
const REASONS: [keyof Settings & ('plan' | 'recall' | 'noShow' | 'cancelled'), string, string][] = [
  ['plan', 'Не закончили лечение', 'сначала — у кого в плане срочное'],
  ['recall', 'Пора на осмотр', 'по сроку профосмотра услуги или клиники'],
  ['noShow', 'Не пришли и не перезаписались', 'неявка за последние 90 дней'],
  ['cancelled', 'Отменили и не перезаписались', 'отмена 2–60 дней назад'],
]

/** «пт 27 нояб: позвали 5 · не доставлено 1 · без Telegram 7». */
function runText(r: Run): string {
  return [`${shortDay(r.day)}: позвали ${r.sent}`, r.failed > 0 ? `не доставлено ${r.failed}` : null,
    r.noTelegram > 0 ? `без Telegram ${r.noTelegram}` : null].filter(Boolean).join(' · ')
}

/**
 * «Настройки → Привлечение пациентов → Позвать снова» (идея 2 «Рост клиник», бэкенд `/api/clinic/comeback-auto`, V268): Tish
 * сам зовёт в бот тех же пациентов, что в «Пациенты → Позвать снова». Здесь, а не в «Сообщениях пациентам»: это не
 * служебное сообщение о записи, а способ вернуть пациента — рядом с «Приведи друга» и «Днями рождения». Меняет руководитель
 * (сервер отвечает 403 остальным); сохраняется сразу, как «Дни рождения».
 */
export function ComebackAutoPage({ onBack }: { onBack: () => void }) {
  const client = useQueryClient()
  const current = useQuery<View, ApiError>({ queryKey: KEY, queryFn: () => unwrap(api.GET('/api/clinic/comeback-auto')) })
  const save = useMutation<View, ApiError, Settings>({
    mutationFn: (body) => unwrap(api.PUT('/api/clinic/comeback-auto', { body })),
    onSuccess: (now) => client.setQueryData(KEY, now),
  })
  const value = save.isPending ? save.variables : current.data?.settings
  const change = (patch: Partial<Settings>) => value && save.mutate({ ...value, ...patch })
  const off = save.isPending || !value?.enabled
  const run = current.data?.lastRun
  return (
    <section className="schedule-main">
      <SubHeader title="Позвать снова" onBack={onBack} />
      {current.isPending ? <Loading />
        : current.error ? <p className="error">{current.error.message}</p>
          : value && (
            <section className="card-block form" aria-label="Звать пациентов автоматически">
              <p className="hint">
                Кого стоит позвать снова, Tish считает в «Пациенты → Позвать снова». Включите — и раз в день Tish сам напишет им в
                Telegram-бот готовое приглашение с адресом клиники, ссылкой записи и кнопкой «📅 Записаться».
              </p>
              <label className="check">
                <input type="checkbox" checked={value.enabled} disabled={save.isPending} onChange={(e) => change({ enabled: e.target.checked })} />
                <span><strong>Звать пациентов автоматически</strong><span className="hint"> — только тем, у кого есть бот. Без бота
                  — останутся вам в «Позвать снова» для WhatsApp.</span></span>
              </label>
              <fieldset disabled={off}>
                <legend>Кого звать</legend>
                {REASONS.map(([key, title, hint]) => (
                  <label key={key} className="check">
                    <input type="checkbox" checked={value[key]} onChange={(e) => change({ [key]: e.target.checked })} />
                    <span><strong>{title}</strong><span className="hint"> — {hint}</span></span>
                  </label>
                ))}
              </fieldset>
              <label>
                Во сколько
                <Select aria-label="Во сколько звать" value={value.sendHour} disabled={off}
                  onChange={(e) => change({ sendHour: Number(e.target.value) })}>
                  {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </Select>
              </label>
              <label>
                Не больше в день
                <Select aria-label="Не больше в день" value={value.dailyLimit} disabled={off}
                  onChange={(e) => change({ dailyLimit: Number(e.target.value) })}>
                  {[...new Set([...LIMITS, value.dailyLimit])].sort((a, b) => a - b)
                    .map((n) => <option key={n} value={n}>{n} пациентов</option>)}
                </Select>
              </label>
              <p className="hint small">
                Бережно: в воскресенье и выходные клиники — не пишем; одному пациенту — не чаще раза в 30 дней; кого вы звали сами
                на этой неделе — не трогаем; после двух приглашений без записи — больше не зовём. Под сообщением — «🔕 Не
                присылать такие напоминания». В «Позвать снова» видно «позвали автоматически», утром руководителю — только числа.
              </p>
              {run && <p className="hint" role="status">Последний раз — {runText(run)}.</p>}
              {save.error && <p className="error" role="alert">{Object.values(save.error.fieldErrors)[0] ?? save.error.message}</p>}
            </section>
          )}
    </section>
  )
}
