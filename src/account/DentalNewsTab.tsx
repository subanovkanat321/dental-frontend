import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { shortDate } from '../lib/time'
import { EmptyState } from '../layout/EmptyState'

type Me = Schemas['BookingViewsMe']

/**
 * «Новости стоматологии»: заголовки профессиональных изданий, статья — на их сайте; подборка
 * недели в бот по пятницам — включить или выключить. Владельцу — источники (RSS/Atom).
 */
export function DentalNewsTab({ me }: { me: Me }) {
  const client = useQueryClient()
  const feed = useQuery({ queryKey: ['dental-news'], queryFn: () => unwrap(api.GET('/api/dental-news')) })
  const digest = useMutation<Schemas['DentalNewsControllerDigest'], ApiError, boolean>({
    mutationFn: (on) => unwrap(api.PUT('/api/dental-news/digest', { body: { on } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['dental-news'] }),
  })
  return (
    <>
      <section className="card-block">
        <h2>Новости стоматологии</h2>
        <p className="hint">Заголовки профессиональных изданий. Нажмите — статья откроется на их сайте.</p>
        {feed.data && (
          <label className="check"><input type="checkbox" checked={Boolean(feed.data.digest)} disabled={digest.isPending}
            onChange={(e) => digest.mutate(e.target.checked)} /> Присылать в бот подборку недели — по пятницам вечером</label>
        )}
        {digest.error && <p className="error" role="alert">{digest.error.message}</p>}
        {feed.error && <p className="error">{feed.error.message}</p>}
        {feed.isPending ? <p className="hint">Загрузка…</p> : feed.data?.articles?.length ? (
          <ul className="news-list">
            {feed.data.articles.map((a) => (
              <li key={a.id} className="news-item">
                <a href={a.link} target="_blank" rel="noopener noreferrer" className="strong">{a.title}</a>
                <span className="hint">{a.source}{a.publishedAt ? ` · ${shortDate(a.publishedAt)}` : ''}</span>
              </li>
            ))}
          </ul>
        ) : <EmptyState compact icon="📚" title="Статей пока нет.">Сервер забирает ленты раз в 3 часа.</EmptyState>}
      </section>
      {me.owner && <Feeds />}
    </>
  )
}

function Feeds() {
  const client = useQueryClient()
  const feeds = useQuery({ queryKey: ['news-feeds'], queryFn: () => unwrap(api.GET('/api/platform/news-feeds')) })
  const [url, setUrl] = useState('')
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['news-feeds'] })
    void client.invalidateQueries({ queryKey: ['dental-news'] })
  }
  const add = useMutation<Schemas['DentalNewsServiceFeed'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/news-feeds', { body: { url } })),
    onSuccess: () => {
      setUrl('')
      refresh()
    },
  })
  const remove = useMutation<unknown, ApiError, number>({
    mutationFn: (id) => unwrap(api.DELETE('/api/platform/news-feeds/{id}', { params: { path: { id } } })),
    onSuccess: refresh,
  })
  return (
    <section className="card-block">
      <h2>Источники · видите только вы</h2>
      <p className="hint">Ленты для врачей всех клиник. Сервер обновляет их раз в 3 часа.</p>
      {feeds.data?.length ? (
        <table className="table" aria-label="Источники новостей">
          <tbody>{feeds.data.map((f) => (
            <tr key={f.id}>
              <td className="strong">{f.title}</td>
              <td className="hint">{f.url} · статей: {f.articles}{f.lastError ? <span className="tone-bad"> · {f.lastError}</span> : null}</td>
              <td className="r"><button type="button" className="btn small ghost" disabled={remove.isPending}
                onClick={() => window.confirm(`Убрать источник «${f.title}»?`) && remove.mutate(f.id!)}>Убрать</button></td>
            </tr>
          ))}</tbody>
        </table>
      ) : null}
      <form className="form narrow" aria-label="Новый источник" onSubmit={(e) => { e.preventDefault(); add.mutate() }}>
        <label className="field"><span>Новый источник</span>
          <input type="url" required value={url} placeholder="Адрес сайта или его RSS, например https://stomport.ru" onChange={(e) => { add.reset(); setUrl(e.target.value) }} /></label>
        {add.error && <p className="error" role="alert">{add.error.fieldErrors.url ?? add.error.message}</p>}
        {add.isSuccess && <p className="tone-ok" role="status">Добавлен «{add.data.title}» · статей: {add.data.articles}</p>}
        <button type="submit" className="btn" disabled={add.isPending}>Проверить и добавить</button>
      </form>
    </section>
  )
}
