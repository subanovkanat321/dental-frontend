import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Loading } from '../layout/Loading'

type Counts = Schemas['StockCleanupCounts']

/** Название вписано верно — без учёта регистра и пробелов по краям, как сверяет сервер. */
function sameName(typed: string, name: string): boolean {
  return typed.trim() !== '' && typed.trim().toLocaleLowerCase('ru') === name.trim().toLocaleLowerCase('ru')
}

/**
 * «Очистить склад» клиники (только владелец платформы): клиника настроит склад заново сама.
 * Сначала сервер считает, что удалится; кнопка активна, только когда вписано название клиники
 * (сервер сверяет его ещё раз). Удаление — одна транзакция на сервере, в журнал клиники.
 */
export function StockClearBox({ id, name }: { id: number; name: string }) {
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<Counts | null>(null)
  return (
    <section className="form" aria-label="Склад клиники">
      <h3>Склад клиники</h3>
      {done && <p className="tone-ok" role="status">Склад очищен: удалено материалов {done.supplies}</p>}
      {open ? (
        <StockClearForm id={id} name={name} onCancel={() => setOpen(false)} onDone={(c) => { setDone(c); setOpen(false) }} />
      ) : (
        <button type="button" className="btn" onClick={() => { setDone(null); setOpen(true) }}>Очистить склад…</button>
      )}
    </section>
  )
}

function StockClearForm({ id, name, onCancel, onDone }: { id: number; name: string; onCancel: () => void; onDone: (c: Counts) => void }) {
  const client = useQueryClient()
  const [word, setWord] = useState('')
  const counts = useQuery({
    queryKey: ['platform-stock', id],
    queryFn: () => unwrap(api.GET('/api/platform/clinics/{id}/stock', { params: { path: { id } } })),
  })
  const clear = useMutation<Counts, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/platform/clinics/{id}/stock', { params: { path: { id } }, body: { confirm: word } })),
    onSuccess: (deleted) => {
      void client.invalidateQueries({ queryKey: ['platform-stock', id] })
      onDone(deleted)
    },
  })
  if (counts.isPending) return <Loading />
  if (counts.error) return <p className="error" role="alert">{counts.error.message}</p>
  const c = counts.data
  if (!c.supplies) {
    return (
      <div className="actions">
        <p className="hint">На складе пусто — удалять нечего.</p>
        <button type="button" className="btn ghost" onClick={onCancel}>Закрыть</button>
      </div>
    )
  }
  return (
    <div className="danger-zone form" role="group" aria-label="Подтверждение очистки склада">
      <p aria-label="Будет удалено">Будет удалено: материалов — {c.supplies}, движений — {c.movements}, норм списания в услугах — {c.serviceNorms}.</p>
      <p className="tone-bad">Удалятся все материалы, остатки, история движений и нормы списания в услугах. Отменить нельзя.</p>
      <p className="hint">Касса, оплаты и приёмы не меняются. Отчёт «Расходы на склад» за прошлые месяцы станет пустым — он считается по движениям склада.</p>
      <label className="field"><span>Впишите название: {name}</span>
        <input value={word} maxLength={100} autoComplete="off" placeholder={name} onChange={(e) => setWord(e.target.value)} /></label>
      {clear.error && <p className="error" role="alert">{clear.error.fieldErrors.confirm ?? clear.error.message}</p>}
      <div className="actions">
        <button type="button" className="btn ghost" onClick={onCancel}>Отмена</button>
        <button type="button" className="btn danger" disabled={!sameName(word, name) || clear.isPending} onClick={() => clear.mutate()}>Очистить склад</button>
      </div>
    </div>
  )
}
