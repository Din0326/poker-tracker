import { useState } from 'react'
import { secondaryButtonClass } from '../../components/controlStyles'
import { useAppData } from '../../lib/appData'
import { strings } from '../../strings'

// 開發用（11.1）：產生 5,000 筆隨機場次。只在開發模式渲染；
// seed 產生器以 dynamic import 載入且包在 import.meta.env.DEV 條件內，正式建置會整段移除，不進 bundle。
export function DevSeedSection() {
  const { db } = useAppData()
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'failed'>('idle')
  const [count, setCount] = useState(0)

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
      setCount(data.sessions.length)
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
      <button
        type="button"
        disabled={status === 'running'}
        onClick={() => void run()}
        className={`${secondaryButtonClass} w-full`}
      >
        {status === 'running' ? d.seeding : d.seed}
      </button>
      {status === 'done' && (
        <p role="status" className="mt-2 text-sm text-(--color-text-muted)">
          {d.seeded(count.toLocaleString('en-US'))}
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
