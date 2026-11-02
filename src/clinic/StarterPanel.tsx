import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap } from '../api/client'
import { useClose } from '../lib/useClose'

/** Что предложит «Стартовая настройка»: памятки и материалы. Один запрос на оба экрана — кэш общий. */
function useStarter(stock = true) {
  const memos = useQuery({ queryKey: ['starter', 'memos'], queryFn: () => unwrap(api.GET('/api/care-memos/starter')) })
  const supplies = useQuery({
    queryKey: ['starter', 'supplies', stock],
    queryFn: () => unwrap(api.GET('/api/supplies/starter', { params: { query: { stock } } })),
  })
  return { memos, supplies }
}

/**
 * Плашка над списком услуг: есть что заполнить по умолчанию — памятки услугам, стандартные
 * материалы на склад и «что обычно уходит». Нечего — плашки нет.
 */
export function StarterCard({ onOpen }: { onOpen: () => void }) {
  const { memos, supplies } = useStarter()
  const memoCount = memos.data?.length ?? 0
  const serviceCount = supplies.data?.services?.length ?? 0
  const missing = supplies.data?.missing?.length ?? 0
  if (!memoCount && !serviceCount) return null
  const parts = [
    memoCount ? `памятки (услуг: ${memoCount})` : '',
    serviceCount ? `что обычно уходит (услуг: ${serviceCount})` : '',
    missing ? `стандартные материалы на склад (${missing})` : '',
  ].filter(Boolean)
  return (
    <section className="card-block starter-card" aria-label="Стартовая настройка">
      <div>
        <h2>🧰 Заполнить по умолчанию</h2>
        <p className="hint">Можно сразу поставить: {parts.join(', ')}. Только пустое — что вы уже настроили, не меняется.</p>
      </div>
      <button type="button" className="btn primary" onClick={onOpen}>Посмотреть и заполнить</button>
    </section>
  )
}

/** Панель «Стартовая настройка»: что именно поставим, галочки, «Заполнить». */
export function StarterPanel({ onClose }: { onClose: () => void }) {
  useClose(onClose)
  const client = useQueryClient()
  const [withMemos, setWithMemos] = useState(true)
  const [withSupplies, setWithSupplies] = useState(true)
  const [withStock, setWithStock] = useState(true)
  const { memos, supplies } = useStarter(withStock)
  const [done, setDone] = useState('')
  const apply = useMutation<string, ApiError>({
    mutationFn: async () => {
      const parts: string[] = []
      if (withMemos && memos.data?.length) {
        const r = await unwrap(api.POST('/api/care-memos/starter'))
        parts.push(`памятки поставлены (услуг: ${r.services ?? 0})`)
      }
      if (withSupplies) {
        const r = await unwrap(api.POST('/api/supplies/starter', { body: { stock: withStock } }))
        if (r.created) parts.push(`новых материалов на складе: ${r.created}`)
        parts.push(`«что обычно уходит» задано (услуг: ${r.services ?? 0})`)
      }
      return parts.join(', ')
    },
    onSuccess: (text) => {
      setDone(text ? `Готово: ${text}.` : 'Готово.')
      for (const key of ['starter', 'care-memos', 'care-memo-links', 'supplies', 'service-supplies', 'appointment-supplies-suggested']) {
        void client.invalidateQueries({ queryKey: [key] })
      }
    },
  })
  const memoList = memos.data ?? []
  const missing = supplies.data?.missing ?? []
  const services = supplies.data?.services ?? []
  const nothing = !memoList.length && !services.length && !missing.length

  return (
    <aside className="panel" aria-label="Заполнить по умолчанию">
      <header className="panel-head">
        <div>
          <h2>🧰 Заполнить по умолчанию</h2>
          <span className="hint">Ставим только туда, где пусто. Всё можно поменять потом в карточке услуги.</span>
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      {(memos.isPending || supplies.isPending) && <p className="hint">Загрузка…</p>}
      {(memos.error || supplies.error) && <p className="error">{(memos.error ?? supplies.error)!.message}</p>}
      {done && <p className="tone-ok" role="status">{done}</p>}
      {!done && nothing && memos.isSuccess && supplies.isSuccess && <p className="hint">Всё уже настроено — заполнять нечего.</p>}

      {memoList.length > 0 && (
        <section className="starter-block" aria-label="Памятки">
          <label className="check"><input type="checkbox" checked={withMemos} onChange={(e) => setWithMemos(e.target.checked)} />
            <strong>📋 Памятки после процедуры</strong> · услуг: {memoList.length}</label>
          <p className="hint">После приёма их можно распечатать или отправить пациенту в бот.</p>
          <ul className="starter-list">
            {memoList.map((m) => <li key={m.serviceId}>{m.service} <span className="hint">→ {m.memo}</span></li>)}
          </ul>
        </section>
      )}

      {(services.length > 0 || missing.length > 0) && (
        <section className="starter-block" aria-label="Материалы">
          <label className="check"><input type="checkbox" checked={withSupplies} onChange={(e) => setWithSupplies(e.target.checked)} />
            <strong>🦷 Что обычно уходит</strong> · услуг: {services.length}</label>
          <p className="hint">В карточке приёма врач увидит готовый список и спишет его со склада одной кнопкой — сам, после проверки.
            Само ничего не списывается.</p>
          {withSupplies && (
            <label className="check"><input type="checkbox" checked={withStock} onChange={(e) => setWithStock(e.target.checked)} />
              Завести недостающие стандартные материалы на склад{missing.length ? ` (${missing.length})` : ''} — с остатком 0,
              впишете, когда придут</label>
          )}
          {withSupplies && withStock && missing.length > 0 && (
            <p className="hint">Новые: {missing.map((m) => `${m.name} (${m.unit})`).join(', ')}.</p>
          )}
          {withSupplies && (
            <ul className="starter-list">
              {services.map((s) => (
                <li key={s.id}>{s.name}
                  <span className="hint"> → {(s.items ?? []).map((i) => `${i.name} ${i.quantity} ${i.unit}`).join(', ')}</span></li>
              ))}
            </ul>
          )}
        </section>
      )}

      {apply.error && <p className="error" role="alert">{apply.error.message}</p>}
      {!nothing && (
        <div className="actions">
          <button type="button" className="btn primary" disabled={apply.isPending || (!withMemos && !withSupplies)}
            onClick={() => apply.mutate()}>{apply.isPending ? 'Заполняем…' : 'Заполнить'}</button>
          <button type="button" className="btn ghost" onClick={onClose}>Закрыть</button>
        </div>
      )}
    </aside>
  )
}
