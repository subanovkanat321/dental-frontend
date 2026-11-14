import { Component, type ErrorInfo, type ReactNode } from 'react'

import { reportError } from '../lib/clientErrors'
import { isStaleChunk, reloadForStaleChunk } from '../lib/staleChunk'

/**
 * Предохранитель раздела: если экран упал, вместо белого экрана — «Что-то пошло не так» и
 * «Обновить», остальное приложение работает. Вышла новая версия, а вкладка старая — один раз
 * перезагружаемся сами: врач получит новую версию, не заметив обновления.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown }

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // Новая версия, кусок кода старой пропал — один раз перезагрузка (lib/staleChunk); уже перезагружались —
    // «Обновить». Нет сети — это не новая версия: не перезагружаемся в офлайн, показываем «Обновить»
    if (isStaleChunk(error) && navigator.onLine !== false) {
      reloadForStaleChunk(error)
      return
    }
    // Без данных пациентов: только текст ошибки и где она случилась
    const component = info.componentStack?.split('\n')[1]?.trim()
    console.error('Экран упал:', error instanceof Error ? error.message : error, component)
    // Владельцу в бот (lib/clientErrors): только имя компонента, без props
    reportError(error, { component: component?.replace(/^(in|at)\s+/, '').split(/[\s(@]/)[0] })
  }

  render() {
    if (this.state.error == null) return this.props.children
    return (
      <div className="card-block crash" role="alert">
        <h2>Что-то пошло не так</h2>
        <p className="hint">Этот экран не открылся. Данные не потеряны — обновите приложение. Если повторится, напишите в «Помощь» внизу меню → «Написать в Tish».</p>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => window.location.reload()}>Обновить</button>
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>Попробовать ещё раз</button>
        </div>
      </div>
    )
  }
}
