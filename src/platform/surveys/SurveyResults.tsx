import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../../api/client'
import { EmptyState } from '../../layout/EmptyState'
import { Select } from '../../layout/Select'
import { download } from '../../lib/download'
import { shortDate } from '../../lib/time'
import { ROLE_ONE, ROLES, rolesText, type Role } from '../../survey/texts'
import { Loading } from '../../layout/Loading'

type Details = Schemas['SurveyDetails']
type Result = Schemas['SurveyResultsQuestionResult']

/**
 * Итоги опроса: сколько ответили (по ролям и клиникам), по каждому вопросу — среднее, NPS и
 * распределение (одна серия — один цвет, число и доля подписаны у каждой полосы, легенда не нужна),
 * ответы текстом с клиникой и ролью, без имён. Имя — только у согласившихся на связь. CSV — всё
 * построчно для таблицы.
 */
export function SurveyResults({ survey }: { survey: Details }) {
  const [role, setRole] = useState<Role | ''>('')
  const [clinicId, setClinicId] = useState<number | null>(null)
  const clinics = useQuery({ queryKey: ['platform-clinics'], queryFn: () => unwrap(api.GET('/api/platform/clinics')) })
  const results = useQuery({
    queryKey: ['platform-survey-results', survey.id, role, clinicId],
    queryFn: () => unwrap(api.GET('/api/platform/surveys/{id}/results', {
      params: { path: { id: survey.id }, query: { role: role || undefined, clinicId: clinicId ?? undefined } },
    })),
  })
  const csv = useMutation<void, ApiError>({ mutationFn: () => download(`/api/platform/surveys/${survey.id}/results.csv`, `опрос-${survey.id}.csv`) })
  const r = results.data
  return (
    <div className="survey-results">
      <div className="survey-filters">
        <Select aria-label="Роль" value={role} onChange={(e) => setRole(e.target.value as Role | '')}>
          <option value="">Все роли</option>
          {ROLES.map(([code, title]) => <option key={code} value={code}>{title}</option>)}
        </Select>
        <Select aria-label="Клиника" value={clinicId ?? ''} onChange={(e) => setClinicId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Все клиники</option>
          {(clinics.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <button type="button" className="btn" disabled={csv.isPending || !survey.responses} onClick={() => csv.mutate()}>Скачать CSV</button>
      </div>
      {csv.error && <p className="error" role="alert">{csv.error.message}</p>}
      {results.error && <p className="error">{results.error.message}</p>}
      {results.isPending ? <Loading /> : !r?.responses ? (
        <EmptyState title={role || clinicId ? 'С такими условиями ответов нет' : 'Ответов пока нет'}>
          {survey.status === 'DRAFT' ? 'Опрос не запущен — сотрудники его не видят.' : 'Сотрудники видят приглашение на «Расписании» и в «Помощи → Отзыв о Tish».'}
        </EmptyState>
      ) : (
        <>
          <section className="card-block survey-summary" aria-label="Кто ответил">
            <div className="survey-tiles">
              <div className="survey-tile"><span className="hint">Ответов</span><b>{r.responses}</b></div>
              {(r.byRole ?? []).map((x) => <div key={x.role} className="survey-tile"><span className="hint">{ROLE_ONE[x.role!]}</span><b>{x.count}</b></div>)}
            </div>
            {(r.byClinic?.length ?? 0) > 1 && (
              <Bars label="По клиникам" total={r.responses} rows={(r.byClinic ?? []).map((c) => [c.clinicName ?? 'Клиника удалена', c.count])} />
            )}
          </section>
          {(r.questions ?? []).map((q, i) => <QuestionResult key={q.questionId} q={q} number={i + 1} />)}
          {(r.contacts?.length ?? 0) > 0 && (
            <section className="card-block" aria-label="Готовы поговорить">
              <h3>Готовы поговорить: {r.contacts!.length}</h3>
              <table className="table">
                <thead><tr><th>Имя</th><th>Клиника</th><th>Роль</th><th>Ответил</th></tr></thead>
                <tbody>
                  {r.contacts!.map((c, i) => (
                    <tr key={i}><td>{c.name}</td><td>{c.clinicName}</td><td>{rolesText(c.roles)}</td><td className="hint nowrap">{c.createdAt ? shortDate(c.createdAt) : ''}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function QuestionResult({ q, number }: { q: Result; number: number }) {
  const counts = q.counts ?? []
  const answered = q.answered
  return (
    <section className="card-block survey-q-result" aria-label={`Итоги: ${q.text}`}>
      <h3>{number}. {q.text}</h3>
      <p className="hint">Ответили: {answered}</p>
      {q.type === 'NPS' && q.nps && (
        <div className="survey-tiles">
          <div className="survey-tile hero"><span className="hint">NPS</span><b>{q.nps.score > 0 ? `+${q.nps.score}` : q.nps.score}</b></div>
          <div className="survey-tile"><span className="hint">Порекомендуют (9–10)</span><b>{q.nps.promoters}</b></div>
          <div className="survey-tile"><span className="hint">Нейтральны (7–8)</span><b>{q.nps.passives}</b></div>
          <div className="survey-tile"><span className="hint">Не порекомендуют (0–6)</span><b>{q.nps.detractors}</b></div>
          <div className="survey-tile"><span className="hint">Средняя</span><b>{q.average}</b></div>
        </div>
      )}
      {q.type === 'RATING' && q.average != null && (
        <div className="survey-tiles"><div className="survey-tile hero"><span className="hint">Средняя оценка</span><b>{q.average} ★</b></div></div>
      )}
      {q.type === 'RATING' && <Bars label="Оценки" total={answered} rows={counts.map((c, i) => [`${i + 1} ★`, c])} />}
      {q.type === 'NPS' && <Bars label="Оценки 0–10" total={answered} rows={counts.map((c, i) => [String(i), c])} />}
      {(q.type === 'SINGLE' || q.type === 'MULTI') && <Bars label="Варианты" total={answered} rows={(q.options ?? []).map((o, i) => [o, counts[i] ?? 0])} />}
      {q.type === 'CONTACT' && <Bars label="Ответы" total={answered} rows={[['Да', counts[1] ?? 0], ['Нет', counts[0] ?? 0]]} />}
      {q.type === 'TEXT' && (
        (q.texts?.length ?? 0) > 0 ? (
          <ul className="survey-texts">
            {q.texts!.map((t, i) => (
              <li key={i}><p>{t.text}</p><span className="hint">{t.clinicName ?? 'Клиника удалена'} · {rolesText(t.roles)} · {t.createdAt ? shortDate(t.createdAt) : ''}</span></li>
            ))}
          </ul>
        ) : <p className="hint">Текстом пока не ответили.</p>
      )}
    </section>
  )
}

/**
 * Распределение — горизонтальные полосы одного цвета: подпись слева, полоса, число и доля справа.
 * Числа подписаны прямо, поэтому это и график, и таблица (читается скринридером как список).
 */
function Bars({ label, rows, total }: { label: string; rows: [string, number][]; total: number }) {
  const max = Math.max(1, ...rows.map(([, n]) => n))
  return (
    <ul className="survey-bars" aria-label={label}>
      {rows.map(([name, n], i) => {
        const share = total ? Math.round((100 * n) / total) : 0
        return (
          <li key={i} title={`${name}: ${n} (${share}%)`}>
            <span className="survey-bar-label">{name}</span>
            <span className="survey-bar-track"><span className="survey-bar-fill" style={{ width: `${(100 * n) / max}%` }} /></span>
            <span className="survey-bar-value num">{n} · {share}%</span>
          </li>
        )
      })}
    </ul>
  )
}
