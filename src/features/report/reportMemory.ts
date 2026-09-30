// 報表在 App 開啟期間的記憶（6.1，模組層級記憶體，App 重啟後回到預設）：
// - 頁籤與期間：切到其他頁面再回來不重置
// - 分組依據：同一頁籤內保留（例：點分組到紀錄列表再返回）；切換頁籤時重設為該頁籤的第一個選項
import type { PeriodSelection } from '../../domain'
import type { GroupBy } from './grouping'
import type { ReportTab } from './reportModel'

export const DEFAULT_REPORT_PERIOD: PeriodSelection = { period: 'all', from: '', to: '' }

export const reportMemory: {
  tab: ReportTab
  period: PeriodSelection
  /** null 代表使用該頁籤的預設（第一個選項） */
  groupBy: GroupBy | null
} = {
  tab: 'all',
  period: DEFAULT_REPORT_PERIOD,
  groupBy: null,
}
