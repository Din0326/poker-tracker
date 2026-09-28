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
} as const
