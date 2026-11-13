import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { AuditJournal } from './AuditJournal'
import { ImportData } from './ImportData'
import { Spinner } from '../layout/Loading'

type Me = Schemas['BookingViewsMe']

/**
 * «Данные»: выгрузка всей клиники одним архивом в бот (кто видит всех врачей) и журнал важных
 * действий сотрудников (админ, AuditJournal) — без имён и телефонов пациентов. Админу — ещё
 * «Загрузить из Excel» (ImportData): перенос пациентов и прайса из таблицы.
 */
export function DataTab({ me, seesAll }: { me: Me; seesAll: boolean }) {
  const exportAll = useMutation<Schemas['ExportControllerResult'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/clinic/export')),
  })
  const r = exportAll.data

  return (
    <>
      {/* Порядок — как в названии пункта «Импорт, выгрузка, журнал»: новая клиника сначала загружает базу */}
      {me.admin && <ImportData />}
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
              {exportAll.isPending ? <><Spinner />Собираем архив…</> : 'Прислать архив в бот'}</button>
          </div>
        </section>
      )}
      {/* Удалить все приёмы — только владелец Tish (сервер тоже: остальным 403) */}
      {me.owner && <ClearAll />}
      {me.admin && <AuditJournal />}
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
        {run.isSuccess && <p className="tone-ok" role="status">Удалено записей: {run.data.deleted}</p>}
        <button type="button" className="btn danger" disabled={run.isPending || !word} onClick={() => run.mutate()}>Удалить все записи</button>
      </div>
    </section>
  )
}
