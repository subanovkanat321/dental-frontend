import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { EmptyState } from '../layout/EmptyState'
import { Loading } from '../layout/Loading'
import { HeadTools, SubHelp } from '../layout/PageHead'
import { formatPhone, shortDate } from '../lib/time'
import { BotInviteSheet } from '../schedule/BotInvite'
import { coverageText, invitedHint } from '../schedule/botInvite'
import { CalmRow } from './CalmList'

type Row = Schemas['BotCoverageControllerNoBotRow']

/**
 * «Пациенты → Без бота» (2026-11-20): действующие пациенты (были за год или записаны), которым бот о записи не напишет, —
 * сначала те, у кого скоро приём. У каждого — «📲 Пригласить»: окно с личной ссылкой и текстом (BotInviteSheet). По одному:
 * WhatsApp массово не отправить. Кто «в боте» и кто «действующий» — решает сервер (BotCoverageController).
 */
export function NoBotTab({ onOpen }: { onOpen: (patientId: number) => void }) {
  const [onlyNew, setOnlyNew] = useState(false)
  const [inviting, setInviting] = useState<Row | null>(null)
  const list = useQuery({
    queryKey: ['no-bot', onlyNew],
    queryFn: () => unwrap(api.GET('/api/patients/no-bot', { params: { query: { invited: !onlyNew } } })),
  })
  return (
    <div className="calm-stack no-bot">
      <SubHelp title="Без бота">Пациенты, которым бот не может написать о записи: напоминаете им в WhatsApp или звонком. Пригласите в бот —
        напоминания станут бесплатными, пациент сам ответит «Приду» или перенесёт. «📲 Пригласить» — личная ссылка в WhatsApp или SMS.
        Считаются пациенты с приёмом за последний год или записью вперёд.</SubHelp>
      <HeadTools>
        <label className="check"><input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> Ещё не приглашали</label>
        {list.data && list.data.coverage.total > 0 && (
          <span className="head-note" aria-label="Пациенты в боте">В боте: <b className="num">{coverageText(list.data.coverage)}</b></span>
        )}
      </HeadTools>
      {list.isPending && <Loading />}
      {list.error && <p className="error">{list.error.message}</p>}
      {list.data && !list.data.items.length && (
        <EmptyState fill title={onlyNew ? 'Всех уже пригласили' : 'Все пациенты в боте'}>
          {onlyNew ? 'Снимите галочку — будут видны и приглашённые, кто ещё не подключился.' : 'Напоминания им уходят в Telegram — бесплатно.'}
        </EmptyState>
      )}
      {list.data && list.data.items.length > 0 && (
        <ul className="calm-list" aria-label="Без бота">
          {list.data.items.map((r) => (
            <CalmRow key={r.id} open={() => onOpen(r.id)} name={r.fullName}
              sub={[r.phone ? formatPhone(r.phone) : 'без телефона', r.guardianName ? `представитель: ${r.guardianName}` : null]
                .filter(Boolean).join(' · ')}
              meta={(
                <>
                  {r.nextVisit ? <span className="calm-meta-strong">записан {shortDate(r.nextVisit, true)}</span>
                    : <span>{r.lastVisit ? `был ${shortDate(r.lastVisit)}` : 'ещё не был'}</span>}
                  {r.invitedAt && <span className="hint small">{invitedHint(r.invitedAt)}</span>}
                </>
              )}
              action={(
                <button type="button" className="btn small" aria-label={`Пригласить в бот: ${r.fullName}`} onClick={() => setInviting(r)}>
                  📲 {r.invitedAt ? 'Ещё раз' : 'Пригласить'}</button>
              )} />
          ))}
        </ul>
      )}
      {inviting && (
        <BotInviteSheet onClose={() => setInviting(null)} patient={{
          id: inviting.id, fullName: inviting.fullName, telegram: false, botInvitedAt: inviting.invitedAt,
          // Номер в строке — уже «куда писать» (представителя, если есть): он же номер для WhatsApp/SMS
          phone: inviting.phone,
          guardian: inviting.guardianName ? { fullName: inviting.guardianName } : undefined,
        }} />
      )}
    </div>
  )
}
