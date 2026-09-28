// 全 App 畫面文字集中於此（第 2 節開發規範）；元件內不得寫死中文
export const strings = {
  app: {
    name: '德州記帳',
  },
  common: {
    back: '返回',
    close: '關閉',
    cancel: '取消',
    save: '儲存',
    confirm: '確定',
    loading: '載入中…',
    loadFailed: '讀取資料失敗',
    retry: '重試',
  },
  sessionTypes: {
    cash: '現金桌',
    mtt: 'MTT',
    timed_mtt: '限時 MTT',
  },
  // 第 5 節新增場次表單
  record: {
    clear: '清除',
    typeLabel: '類型',
    typeLocked: '類型無法修改，如需更改請刪除後重新新增',
    switchToCashConfirm: '現金桌只有一筆買入，切換後只保留第一筆，確定嗎？',
    fields: {
      stake: '盲注級別',
      buyIn: '買入（含服務費）',
      fee: '服務費',
      feeHint: '已含在買入內，僅記錄',
      cashOut: '到手金額',
      fieldSize: '參賽人數',
      finishPlace: '名次',
      startAt: '開始時間',
      startDate: '開始日期',
      startHour: '開始小時',
      duration: '時長',
      durationHours: '時長（小時）',
      durationMinutes: '時長（分鐘）',
      venue: '場地',
      name: '名稱',
      note: '備註',
    },
    buyInsLabel: '買入列表',
    buyInIndex: (n: number) => `第 ${n} 次`,
    removeBuyIn: (n: number) => `刪除第 ${n} 次買入`,
    addBuyIn: '＋ 再買入',
    /** MTT 名次列「第 [ ] 名 / 共 [ ] 人」 */
    placePrefix: '第',
    placeSuffix: '名',
    placeSeparator: '/',
    fieldSizePrefix: '共',
    fieldSizeSuffix: '人',
    hourOption: (h: number) => `${h} 時`,
    durationHourOption: (h: number) => `${h} 時`,
    durationMinuteOption: (m: number) => `${m} 分`,
    notSelected: '—',
    selectPlaceholder: '請選擇',
    /** 開始時間顯示格式 `2026/09/27 20 時` */
    startAtDisplay: (y: string, m: string, d: string, h: number) => `${y}/${m}/${d} ${h} 時`,
    charCount: (n: number, max: number) => `${n}/${max}`,
    noStakes: '請先新增盲注',
    addStakeOption: '＋ 新增盲注',
    addVenueOption: '＋ 新增場地',
    venueNone: '不指定',
    archivedSuffix: '（已封存）',
    save: '儲存',
    saving: '儲存中…',
    saved: (profit: string) => `已儲存，盈利 ${profit}`,
    saveFailed: '儲存失敗，請再試一次',
    preview: {
      buyIn: '買入',
      entries: (n: number) => `（${n} 次）`,
      fee: '服務費',
      profit: '盈利',
      separator: ' · ',
      /** 全形括號後不再加空白：「（2 次）· 服務費」 */
      separatorAfterParen: '· ',
    },
    // 5.4 驗證錯誤訊息
    errors: {
      stakeRequired: '請選擇盲注級別',
      buyInRequired: '請填寫買入金額',
      feeExceedsBuyIn: '服務費不可大於買入',
      cashOutRequired: '請填寫到手金額，沒拿回請填 0',
      amountTooLarge: '金額超出上限',
      durationRange: '請選擇 5 分鐘到 72 小時之間的時長',
      startAtFuture: '開始時間不可是未來',
      startDateRequired: '請選擇開始日期',
      fieldSizeMin: '參賽人數至少 2 人',
      finishPlaceNeedsFieldSize: '填名次時請一併填寫參賽人數',
      finishPlaceRange: '名次需介於 1 到參賽人數之間',
      textTooLong: '字數超過上限',
    },
  },
  // 5.3 行內新增盲注與場地
  addStake: {
    title: '新增盲注',
    sb: '小盲',
    bb: '大盲',
    errors: {
      sbMin: '小盲至少 1',
      bbLessThanSb: '大盲不可小於小盲',
      duplicate: '這組盲注已存在',
    },
  },
  addVenue: {
    title: '新增場地',
    name: '場地名稱',
    errors: {
      required: '請輸入場地名稱',
      tooLong: '場地名稱最多 30 字',
      duplicate: '場地名稱已存在',
    },
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
