// 表單控制項共用的 Tailwind class（顏色一律取自 tokens.css）
// 字級 text-base（16px）以上，避免 iOS Safari 聚焦時自動放大畫面（5.3）

const control =
  'h-12 w-full min-w-0 rounded-(--radius-control) border border-(--color-border) bg-(--color-surface) text-base text-(--color-text) aria-invalid:border-(--color-danger) focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-(--color-accent) disabled:opacity-60'

export const inputClass = `${control} px-3 placeholder:text-(--color-text-muted)`

/** 原生 select：隱藏系統箭頭，由 SelectBox 疊上圖示 */
export const selectClass = `${control} appearance-none pl-3 pr-9`

export const textareaClass =
  'min-h-24 w-full min-w-0 rounded-(--radius-control) border border-(--color-border) bg-(--color-surface) px-3 py-2 text-base text-(--color-text) aria-invalid:border-(--color-danger) focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-(--color-accent) disabled:opacity-60'

export const primaryButtonClass =
  'flex min-h-12 items-center justify-center rounded-(--radius-control) bg-(--color-accent) px-4 text-base font-semibold text-(--color-on-accent) disabled:opacity-60'

export const dangerButtonClass =
  'flex min-h-12 items-center justify-center rounded-(--radius-control) bg-(--color-danger) px-4 text-base font-semibold text-(--color-on-danger) disabled:opacity-60'

export const secondaryButtonClass =
  'flex min-h-12 items-center justify-center rounded-(--radius-control) border border-(--color-border) bg-(--color-surface-raised) px-4 text-base font-semibold text-(--color-text) disabled:opacity-60'
