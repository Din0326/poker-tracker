// 全 App 畫面文字集中於此（第 2 節開發規範）；元件內不得寫死中文
export const strings = {
  app: {
    name: '德州記帳',
  },
  common: {
    back: '返回',
    close: '關閉',
  },
  tabs: {
    record: '新增',
    sessions: '紀錄',
    report: '報表',
    settings: '設定',
    navLabel: '主要分頁',
  },
  pages: {
    record: '新增場次',
    sessions: '紀錄',
    sessionDetail: '場次詳情',
    sessionEdit: '編輯場次',
    report: '報表',
    settings: '設定',
    venues: '場地管理',
    stakes: '盲注管理',
  },
  placeholder: {
    comingIn: (phase: string) => `此功能將於 ${phase} 實作`,
  },
  settings: {
    listsSection: '常用清單',
  },
  installBanner: {
    message: '建議加入主畫面，資料才不會與瀏覽器分開',
  },
  update: {
    available: '有新版本',
    reload: '重新載入',
  },
  // 4.4 數值顯示用的符號與樣板（src/domain/format.ts 使用）
  format: {
    /** 分母為 0 等無法計算時 */
    empty: '—',
    /** 正式減號 U+2212 */
    minus: '−',
    plus: '+',
    currency: '$',
    percent: '%',
    hourlySuffix: '/hr',
    bbPerHourSuffix: ' bb/hr',
    hours: (value: string) => `${value} 小時`,
    /** 贏率、ITM%：`13/26（50.0%）` */
    fraction: (numerator: number, denominator: number, percent: string) =>
      `${numerator}/${denominator}（${percent}%）`,
    /** 平均名次百分位：`前 23.5%（n=12）` */
    placePercentile: (percent: string, n: number) => `前 ${percent}%（n=${n}）`,
    /** 盲注顯示名稱 `sb/bb`（3.4） */
    stake: (sb: number, bb: number) => `${sb}/${bb}`,
  },
} as const
