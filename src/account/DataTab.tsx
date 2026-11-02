import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { dayTitle, timeOf, ZONE } from '../lib/time'

type Me = Schemas['BookingViewsMe']

const dateOf = (instant: string) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(instant))

/**
 * «Данные»: выгрузка всей клиники одним архивом в бот (кто видит всех врачей) и журнал важных
 * действий сотрудников (админ) — без имён и телефонов пациентов, последние 200.
 */
export function DataTab({ me, seesAll }: { me: Me; seesAll: boolean }) {
  const audit = useQuery({ queryKey: ['clinic-audit'], queryFn: () => unwrap(api.GET('/api/clinic/audit')), enabled: Boolean(me.admin) })
  const exportAll = useMutation<Schemas['ExportControllerResult'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/clinic/export')),
  })
  const days = new Map<string, Schemas['AuditLogEntry'][]>()
  for (const x of audit.data ?? []) {
    const day = x.at ? dateOf(x.at) : ''
    days.set(day, [...(days.get(day) ?? []), x])
  }
  const r = exportAll.data

  return (
    <>
      {seesAll && (
        <section className="card-block">
          <h2>Выгрузка данных</h2>
          <div className="form narrow">
            <p>Все данные клиники одним архивом: пациенты, приёмы и оплаты, заметки, карта зубов, план лечения, анкеты, снимки,
              врачи, услуги и склад. Таблицы открываются в Excel.</p>
            <p className="hint">Бот пришлёт архив в ваш чат. Внутри медицинские данные пациентов — храните его как медкарты и не пересылайте.</p>
            {exportAll.error && <p className="error" role="alert">{exportAll.error.message}</p>}
            {r && <p className="tone-ok" role="status">Архив в чате с ботом: пациентов {r.patients}, снимков {r.filesIncluded}{r.filesSkipped ? ` (не поместилось ${r.filesSkipped})` : ''}</p>}
            <button type="button" className="btn primary" disabled={exportAll.isPending} onClick={() => exportAll.mutate()}>
              {exportAll.isPending ? 'Собираем архив…' : 'Прислать архив в бот'}</button>
          </div>
        </section>
      )}
      {me.admin && <ClearAll />}
      {me.admin && (
        <section className="card-block">
          <h2>Журнал действий</h2>
          <p className="hint">Важные действия сотрудников: удаление записей, оплаты, врачи и сотрудники, «О клинике», новости, склад,
            выгрузка. Без имён и телефонов пациентов — только номера. Последние 200.</p>
          {audit.error && <p className="error">{audit.error.message}</p>}
          {audit.isPending ? <p className="hint">Загрузка…</p> : days.size ? (
            <table className="table" aria-label="Журнал действий">
              <tbody>
                {[...days.entries()].map(([day, items]) => (
                  <Fragment key={day}>
                    <tr className="group-row"><th colSpan={3} scope="colgroup">{day ? dayTitle(day) : ''}</th></tr>
                    {items.map((x, i) => (
                      <tr key={i}><td className="nowrap num hint">{x.at ? timeOf(x.at) : ''}</td><td className="strong nowrap">{x.who}</td><td>{x.text}</td></tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          ) : <p className="hint">Пока пусто.</p>}
        </section>
      )}
    </>
  )
}

/**
 * «Начать с чистого листа» (админ): удалить все приёмы и заявки после показа или тестов. Сервер
 * разрешает это, только пока в клинике нет состоявшихся приёмов, заметок и денег (иначе 409
 * has-records — показываем его текст). Врачи, услуги, пациенты и склад остаются. Слово «УДАЛИТЬ»
 * проверяет сервер. Здесь, в «Данных», под выгрузкой: сначала сохранить архив.
 */
function ClearAll() {
  const client = useQueryClient()
  const [word, setWord] = useState('')
  const run = useMutation<Schemas['AppointmentControllerDeleted'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/appointments/delete-all', { body: { confirm: word } })),
    onSuccess: () => {
      setWord('')
      void client.invalidateQueries()
    },
  })
  return (
    <section className="card-block danger-zone">
      <h2>Начать с чистого листа</h2>
      <div className="form narrow">
        <p>Удалит все приёмы и заявки — например, после показа или тестов. Врачи, услуги, пациенты и склад останутся.</p>
        <p className="tone-bad" role="note"><strong>Только пока клиника не начала работать:</strong> если уже есть состоявшиеся приёмы,
          заметки или оплаты, удалить не получится — касса и медкарты не пропадут. Ошибочную запись — отмените.</p>
        <label className="field"><span>Впишите УДАЛИТЬ</span>
          <input value={word} maxLength={20} autoComplete="off" placeholder="УДАЛИТЬ" onChange={(e) => { run.reset(); setWord(e.target.value) }} /></label>
        {run.error && <p className="error" role="alert">{run.error.fieldErrors.confirm ?? run.error.message}</p>}
        {run.isSuccess && <p className="tone-ok" role="status">Удалено записей: {run.data.deleted ?? 0}</p>}
        <button type="button" className="btn danger" disabled={run.isPending || !word} onClick={() => run.mutate()}>Удалить все записи</button>
      </div>
    </section>
  )
}
