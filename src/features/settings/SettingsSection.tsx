import type { ReactNode } from 'react'

// 設定頁的區塊：標題 + 內容（標題以 aria-labelledby 關聯成 region）
export function SettingsSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-6 scroll-mt-[calc(var(--header-height)+env(safe-area-inset-top)+8px)] first:mt-2">
      <h2 id={`${id}-title`} className="px-1 pb-2 text-sm text-(--color-text-muted)">
        {title}
      </h2>
      {children}
    </section>
  )
}

/** 區塊內的卡片外框 */
export const cardClass = 'rounded-(--radius-card) border border-(--color-border) bg-(--color-surface)'
