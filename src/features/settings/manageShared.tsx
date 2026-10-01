import { strings } from '../../strings'

/** 設定相關操作失敗提示的顯示時間（與新增頁失敗提示相同為 5 秒） */
export const ERROR_TOAST_MS = 5000
/** 成功提示的顯示時間 */
export const SUCCESS_TOAST_MS = 3000

/** 管理頁標題列右上角的「新增」按鈕 */
export function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-(--touch-min) min-w-(--touch-min) items-center justify-center rounded-(--radius-control) px-2 text-base text-(--color-accent)"
    >
      {strings.manage.add}
    </button>
  )
}
