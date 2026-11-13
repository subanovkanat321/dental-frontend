import type { JoinCase } from './web'

/**
 * Блок кейса «Как работает в клинике» — на /join и в предпросмотре «Платформа → Настройки» (одна разметка:
 * владелец видит ровно то, что увидит клиника). Подпись клиники — только если её указали.
 */
export function CaseBlock({ story, className = 'site-case', heading = 'h2' }: { story: Pick<JoinCase, 'title' | 'text' | 'clinic' | 'metrics'>; className?: string; heading?: 'h2' | 'h3' }) {
  const H = heading
  const Sub = heading === 'h2' ? 'h3' : 'h4'
  const metrics = (story.metrics ?? []).filter((m) => m.value && m.label)
  return (
    <section className={className} aria-label="Как работает в клинике">
      <H>Как работает в клинике</H>
      <Sub>{story.title}</Sub>
      {story.clinic && <p className="hint">{story.clinic}</p>}
      <p>{story.text}</p>
      {metrics.length > 0 && (
        <ul className="site-case-metrics">
          {metrics.map((m) => <li key={`${m.value}${m.label}`}><b>{m.value}</b><span>{m.label}</span></li>)}
        </ul>
      )}
    </section>
  )
}
