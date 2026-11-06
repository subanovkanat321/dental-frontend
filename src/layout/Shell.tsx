import { lazy, Suspense, useRef, useState, type ReactNode } from 'react'

import { logout, type Schemas } from '../api/client'
import type { Page } from '../lib/route'
import { telegram } from '../lib/telegram'
import { AdminNotices } from './AdminNotices'
import { Icon } from './Icon'
import { useFitPanels } from './fitPanels'
import { isAssistant } from '../lib/roles'
import { SurveyInvite } from '../survey/SurveyInvite'
import { useNewQuestions } from '../api/questions'
import { useFullView } from '../lib/fullView'

type Me = Schemas['BookingViewsMe']

// Чат «Помощь» — отдельным кусочком: грузится, только когда его открыли
const HelpChatPanel = lazy(() => import('../account/HelpChat').then((m) => ({ default: m.HelpChatPanel })))

/** Где видна кнопка «💬 Помощь»: главные экраны клиники (в «Настройках» помощь — свой пункт). */
const HELP_PAGES: Page[] = ['schedule', 'patients', 'cash', 'stock']

/** Разделы клиники — сотрудникам; «Платформа» — команде Tish (владелец и менеджеры). */
const CLINIC_SECTIONS = [
  { key: 'schedule', title: 'Расписание' },
  { key: 'patients', title: 'Пациенты' },
  // 3D-атлас и презентации — показать пациенту на консультации; всем сотрудникам клиники
  { key: 'learn', title: 'Для пациента' },
  { key: 'cash', title: 'Касса' },
  { key: 'stock', title: 'Склад' },
  { key: 'settings', title: 'Настройки' },
] as const
const PLATFORM = { key: 'platform', title: 'Платформа' } as const

function sectionsOf(me: Me): readonly { key: Page; title: string }[] {
  // Ассистенту — без «Кассы»: денег он не видит
  const clinic = isAssistant(me) ? CLINIC_SECTIONS.filter((s) => s.key !== 'cash') : CLINIC_SECTIONS
  return [...(me.doctor ? clinic : []), ...(me.platform ? [PLATFORM] : [])]
}

/**
 * Телефон сотрудника клиники: внизу расписание, пациенты, касса, склад и «Настройки». «Для пациента»
 * и «Платформа» туда не влезли — они пунктами в «Настройках».
 */
const PHONE_IN_SETTINGS: readonly Page[] = ['learn', 'platform']

/** На телефоне внизу помещается 4 раздела и «Ещё»: остальное — в выезжающем меню. */
const MOBILE_MAIN = 4

/**
 * Раскладка CRM: меню слева (разделы — по ролям), рабочая область. На телефоне меню — полоса внизу:
 * расписание, пациенты, касса, склад и «Настройки» (шестерёнка); у команды платформы — ещё «Ещё».
 */
export function Shell({ me, page, onNavigate, children }: { me: Me; page: Page; onNavigate: (page: Page) => void; children: ReactNode }) {
  const clinic = me.doctor ? me.clinic?.brandName || me.clinic?.name || 'Клиника' : 'Команда Tish'
  const role = !me.doctor ? (me.owner ? 'владелец платформы' : 'менеджер платформы')
    : me.admin ? 'администратор' : me.reception ? 'регистратура' : isAssistant(me) ? 'ассистент' : 'врач'
  const sections = sectionsOf(me)
  // Вопросы пациентов ждут ответа — число у «Пациентов» (видно из любого раздела)
  const questions = useNewQuestions(Boolean(me.doctor)).data?.count ?? 0
  // «Для пациента» и «Платформа» у сотрудника клиники на телефоне — в «Настройках»: внизу пять кнопок без «Ещё»
  const extra = me.doctor ? sections.filter((x) => PHONE_IN_SETTINGS.includes(x.key))
    : sections.length > MOBILE_MAIN + 1 ? sections.slice(MOBILE_MAIN) : []
  const moreButton = extra.length > 0 && !me.doctor
  const [more, setMore] = useState(false)
  const [help, setHelp] = useState(false)
  // Компьютер: меню можно свернуть до полосы иконок — расписанию больше места (выбор запоминается)
  const [narrow, toggleNarrow] = useFullView('sidebar-narrow')
  // Панель справа — целиком в окне, прокрутка внутри неё (layout/fitPanels.ts)
  const workspace = useRef<HTMLElement>(null)
  useFitPanels(workspace)
  const go = (key: Page) => {
    setMore(false)
    onNavigate(key)
  }
  return (
    <div className={narrow ? 'shell narrow' : 'shell'}>
      <aside className="sidebar">
        {/* Логотип — на главную (расписание), как на любом сайте */}
        <button type="button" className="brand" aria-label="На главную — расписание" onClick={() => go('schedule')}>
          <img src={`${import.meta.env.BASE_URL}tishka-icon.svg`} alt="" width={24} height={36} />
          <span>Tish</span>
        </button>
        <div className="clinic">
          <strong>{clinic}</strong>
          <span>{me.fullName ? `${me.fullName} · ` : ''}{role}</span>
        </div>
        <nav aria-label="Разделы">
          {sections.map((s) => (
            <button key={s.key} type="button" className={['nav', s.key === page ? 'active' : '', extra.includes(s) ? 'extra' : ''].join(' ').trim()} data-section={s.key}
              aria-current={s.key === page ? 'page' : undefined} title={narrow ? s.title : undefined} onClick={() => go(s.key)}>
              <Icon name={s.key} /> <span>{s.title}</span>
              {s.key === 'patients' && questions > 0 && (
                <span className="nav-badge" aria-label={`Вопросов ждут ответа: ${questions}`}>{questions}</span>
              )}
            </button>
          ))}
          {moreButton && (
            <button type="button" className={extra.some((s) => s.key === page) || more ? 'nav more active' : 'nav more'}
              aria-expanded={more} onClick={() => setMore(!more)}>
              <Icon name="more" /> <span>Ещё</span>
            </button>
          )}
        </nav>
        <button type="button" className="nav sidebar-toggle" aria-expanded={!narrow} onClick={toggleNarrow}
          title={narrow ? 'Развернуть меню' : 'Свернуть меню'} aria-label={narrow ? 'Развернуть меню' : 'Свернуть меню'}>
          <span className="sidebar-toggle-ico" aria-hidden="true">{narrow ? '»' : '«'}</span> <span>Свернуть меню</span>
        </button>
        {!telegram() && (
          <button type="button" className="nav link-out" title={narrow ? 'Выйти' : undefined} onClick={() => void logout()}><Icon name="external" /> <span>Выйти</span></button>
        )}
      </aside>
      {more && (
        <div className="more-sheet" role="dialog" aria-label="Ещё разделы" onClick={() => setMore(false)}>
          <div className="more-card" onClick={(e) => e.stopPropagation()}>
            <p className="more-who"><strong>{clinic}</strong><span className="hint">{me.fullName ? `${me.fullName} · ` : ''}{role}</span></p>
            {extra.map((s) => (
              <button key={s.key} type="button" className={s.key === page ? 'more-item active' : 'more-item'} onClick={() => go(s.key)}>
                <Icon name={s.key} /> <span>{s.title}</span>
              </button>
            ))}
            {!telegram() && <button type="button" className="more-item" onClick={() => void logout()}><Icon name="external" /> <span>Выйти</span></button>}
          </div>
        </div>
      )}
      {/* Напоминания админу и приглашение в опрос — на главном экране, чтобы не занимать место в каждом разделе */}
      <main ref={workspace} className="workspace">{page === 'schedule' && <><AdminNotices me={me} /><SurveyInvite me={me} /></>}{children}</main>
      {/* «💬 Помощь» — спросить помощника Tish, не уходя с экрана (ИИ по базе знаний; не знает — команде Tish) */}
      {me.doctor && HELP_PAGES.includes(page) && !help && (
        <button type="button" className="help-fab" onClick={() => setHelp(true)} aria-label="Помощь: спросить помощника Tish">
          <span aria-hidden="true">💬</span> <span className="help-fab-text">Помощь</span>
        </button>
      )}
      {help && (
        <div className="help-float">
          <Suspense fallback={null}><HelpChatPanel onClose={() => setHelp(false)} /></Suspense>
        </div>
      )}
    </div>
  )
}
