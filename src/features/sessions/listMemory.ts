// 紀錄列表在 App 開啟期間的記憶（模組層級記憶體，App 重啟後回到預設）：
// - 篩選條件（Q2）：切到其他頁再回來不重置
// - 已載入的筆數（分批載入）：從詳情返回時渲染同樣多筆，捲動位置才能還原
// - 列表目前的 search（額外篩選標籤）：刪除後返回列表時帶回同樣的標籤
import { DEFAULT_FILTERS, type ListFilters } from './listFilters'

export const BATCH_SIZE = 100

export const listMemory: {
  filters: ListFilters
  visible: { key: string; count: number } | null
  search: string
} = {
  filters: DEFAULT_FILTERS,
  visible: null,
  search: '',
}
