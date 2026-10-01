import { useState } from 'react'
import { secondaryButtonClass } from '../../components/controlStyles'
import { useAppData } from '../../lib/appData'
import { strings } from '../../strings'

type Status = 'idle' | 'running' | 'done' | 'failed'

// 開發用（11.1）：產生 5,000 筆隨機場次、10,000 手隨機手牌（SPEC-v2-hands 11.1）。只在開發模式渲染；
// seed 產生器以 dynamic import 載入且包在 import.meta.env.DEV 條件內，正式建置會整段移除，不進 bundle。
export function DevSeedSection() {
  const { db } = useAppData()
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')

  const run = async () => {
    if (!import.meta.env.DEV) return
    setStatus('running')
    try {
      const { generateSeedData } = await import('../../dev/seed')
      const data = generateSeedData()
      await db.transaction('rw', [db.sessions, db.venues, db.stakes], async () => {
        await db.venues.bulkPut(data.venues)
        await db.stakes.bulkPut(data.stakes)
        await db.sessions.bulkPut(data.sessions)
      })
      setMessage(d.seeded(data.sessions.length.toLocaleString('en-US')))
      setStatus('done')
    } catch {
      setStatus('failed')
    }
  }

  // 手牌關聯到現有的場次（依類型相容規則）；exportSeq 依 7.4 接續配發，與寫入、lastHandSeq 更新在同一個 transaction
  const runHands = async () => {
    if (!import.meta.env.DEV) return
    setStatus('running')
    try {
      const { generateHandSeedData } = await import('../../dev/handSeed')
      const generated = generateHandSeedData({ sessions: await db.sessions.toArray() })
      const count = await db.transaction('rw', [db.hands, db.sessions, db.settings], async () => {
        const last = (await db.settings.get('lastHandSeq'))?.value
        const maxInTable = (await db.hands.orderBy('exportSeq').last())?.exportSeq ?? 0
        const start = Math.max(typeof last === 'number' ? last : 0, maxInTable) + 1
        const hands = generated.map((h, i) => ({ ...h, exportSeq: start + i }))
        await db.hands.bulkAdd(hands)
        await db.settings.put({ key: 'lastHandSeq', value: start + hands.length - 1 })
        return hands.length
      })
      setMessage(d.seededHands(count.toLocaleString('en-US')))
      setStatus('done')
    } catch {
      setStatus('failed')
    }
  }

  const d = strings.dev
  return (
    <section aria-labelledby="settings-dev" className="mt-6">
      <h2 id="settings-dev" className="px-1 pb-2 text-sm text-(--color-text-muted)">
        {d.section}
      </h2>
      <div className="flex flex-col gap-3">
        <button
          type="button"
          disabled={status === 'running'}
          onClick={() => void run()}
          className={`${secondaryButtonClass} w-full`}
        >
          {status === 'running' ? d.seeding : d.seed}
        </button>
        <button
          type="button"
          disabled={status === 'running'}
          onClick={() => void runHands()}
          className={`${secondaryButtonClass} w-full`}
        >
          {status === 'running' ? d.seeding : d.seedHands}
        </button>
      </div>
      {status === 'done' && (
        <p role="status" className="mt-2 text-sm text-(--color-text-muted)">
          {message}
        </p>
      )}
      {status === 'failed' && (
        <p role="alert" className="mt-2 text-sm text-(--color-danger)">
          {d.seedFailed}
        </p>
      )}
    </section>
  )
}
