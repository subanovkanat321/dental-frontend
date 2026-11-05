import { useState } from 'react'

import type { Schemas } from '../api/client'
import { ClinicPage } from '../clinic/ClinicPage'
import { isAssistant } from '../lib/roles'
import { ItemTabs } from './ItemTabs'

type Me = Schemas['BookingViewsMe']
type Tab = 'sources' | 'promo'

const TITLE = 'Откуда приходят пациенты'

/**
 * «Настройки → Откуда приходят пациенты»: варианты «откуда узнал» (карточка и вопрос в боте) и
 * промокоды рекламы — оба про то, какая реклама работает. Ассистенту промокодов нет (как раньше:
 * записи с кодом ставят врач и регистратура).
 */
export function SourcesPage({ me, onBack, initial }: { me: Me; onBack: () => void; initial: Tab }) {
  const list: [Tab, string][] = isAssistant(me) ? [['sources', 'Откуда узнают']] : [['sources', 'Откуда узнают'], ['promo', 'Промокоды']]
  const [chosen, setTab] = useState<Tab>(initial)
  const tab = list.some(([key]) => key === chosen) ? chosen : 'sources'
  const tabs = list.length > 1 ? <ItemTabs label={TITLE} value={tab} onChange={setTab} tabs={list} /> : null
  return <ClinicPage key={tab} me={me} only={tab} title={TITLE} onBack={onBack} tabs={tabs} />
}
