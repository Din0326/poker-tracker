// 全 App 畫面文字集中於此（第 2 節開發規範）；元件內不得寫死中文
export const strings = {
  app: {
    name: 'Poker Road',
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
    /** 有出資者時（5.5） */
    savedMine: (profit: string) => `已儲存，你的盈利 ${profit}`,
    saveFailed: '儲存失敗，請再試一次',
    preview: {
      buyIn: '買入',
      entries: (n: number) => `（${n} 次）`,
      fee: '服務費',
      profit: '盈利',
      separator: ' · ',
      /** 全形括號後不再加空白：「（2 次）· 服務費」 */
      separatorAfterParen: '· ',
      /** 有出資者列時第一行的全額盈利「全額 +$40,000」 */
      full: '全額',
      /** 有出資者列時第二行「賣出 30% · 你的盈利 +$28,000」 */
      sold: (percent: string) => `賣出 ${percent}`,
      myProfit: '你的盈利',
    },
    // 5.3 賣股份區塊（v1.2）
    staking: {
      title: '賣股份',
      add: '＋ 賣股份',
      skipHint: '沒有賣股可略過',
      addBacker: '＋ 新增出資者',
      /** 展開時標題列右側摘要「已賣 30% · 你佔 70%」 */
      summary: (sold: string, mine: string) => `已賣 ${sold} · 你佔 ${mine}`,
      listLabel: '出資者列表',
      rowLabel: (n: number) => `出資者 ${n}`,
      name: '出資者名稱',
      namePlaceholder: '出資者名稱',
      share: '比例',
      markup: '加價倍數',
      percentSuffix: '%',
      markupPrefix: '×',
      remove: '刪除出資者',
      /** 每列第三行「付你 $1,000 · 分走 $5,000」 */
      rowAmounts: (pay: string, payout: string) => `付你 ${pay} · 分走 ${payout}`,
      suggestionsLabel: '出資者名稱建議',
      /** 新增列的加價倍數預填值 */
      defaultMarkup: '1.0',
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
      // 5.4 出資者規則（v1.2）
      backerNameRequired: '請填寫出資者名稱',
      backerNameTooLong: '出資者名稱最多 20 字',
      backerNameDuplicate: '出資者名稱重複',
      shareRequired: '請填寫比例',
      shareFormat: '比例最多到小數 1 位',
      shareRange: '比例需介於 0.1% 到 100% 之間',
      /** 錯誤顯示在賣股份區塊標題下方；目前合計依 4.4 比例格式 */
      shareTotal: (current: string) => `賣出比例合計不可超過 100%（目前 ${current}）`,
      markupRequired: '請填寫加價倍數',
      markupFormat: '加價倍數最多到小數 3 位',
      markupRange: '加價倍數需介於 1.0 到 3.0 之間',
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
  // 期間選擇（4.5；報表 6.1 與紀錄列表 7.1 共用）
  period: {
    label: '期間',
    options: {
      all: '全部',
      last6Months: '近半年',
      last3Months: '近三個月',
      custom: '自訂',
    },
    from: '起日',
    to: '迄日',
    fromAfterTo: '起日不可晚於迄日',
  },
  // 第 7 節場次列表與詳情
  sessions: {
    empty: {
      noRecords: '還沒有紀錄',
      addFirst: '去新增第一場',
      noMatch: '沒有符合條件的紀錄',
    },
    filters: {
      label: '篩選',
      type: '類型',
      typeAll: '全部',
      keyword: '關鍵字',
      keywordPlaceholder: '搜尋名稱或備註',
      clear: '清除篩選',
      /** 報表分組跳入的額外篩選標籤（7.1），例 `場地：6bet` */
      venueTag: (name: string) => `場地：${name}`,
      stakeTag: (label: string) => `盲注：${label}`,
      nameTag: (name: string) => `名稱：${name}`,
      /** 未指定場地、未命名（6.4） */
      unspecifiedVenue: '未指定',
      unnamed: '未命名',
      /** 網址帶入的場地或盲注 id 不存在時 */
      unknownRef: '（找不到）',
      removeTag: (label: string) => `移除篩選 ${label}`,
    },
    /** 列表頂端篩選結果彙總「共 26 場 · +$39,600」 */
    summary: (count: number, profit: string) => `共 ${count} 場 · ${profit}`,
    /** 月份標題「2026 年 9 月 · 8 場 · +$12,300」 */
    monthHeader: (year: number, month: number, count: number, profit: string) =>
      `${year} 年 ${month} 月 · ${count} 場 · ${profit}`,
    /** 單列日期 `09/27` */
    rowDate: (month: string, day: string) => `${month}/${day}`,
    /** 錦標賽進場 2 次以上的小標籤 `×2` */
    entriesBadge: (n: number) => `×${n}`,
    entriesBadgeLabel: (n: number) => `進場 ${n} 次`,
    /** 有出資者的場次小標籤 `賣30%`（7.1） */
    soldBadge: (percent: string) => `賣${percent}`,
    loadingMore: '載入更多…',
    detail: {
      notFound: '找不到這筆紀錄',
      backToList: '返回列表',
      basicSection: '基本資料',
      amountSection: '金額',
      derivedSection: '該場數字',
      noteSection: '備註',
      startAt: '開始時間',
      duration: '時長',
      venue: '場地',
      name: '名稱',
      stake: '盲注',
      buyInRow: (n: number) => `第 ${n} 次`,
      buyInDetail: (amount: string, fee: string) => `${amount}，服務費 ${fee}`,
      buyInTotal: '買入總額',
      feeTotal: '服務費總額',
      cashOut: '到手金額',
      hourly: '時薪',
      bbProfit: 'bb 盈利',
      /** 有出資者時的標籤（7.2） */
      myHourly: '你的時薪',
      myBbProfit: '你的 bb 盈利',
      /** 有出資者時頂部大字的標籤與下方小字「全額 +$40,000 · 賣出 30%」 */
      myProfitLabel: '你的盈利',
      fullSummary: (full: string, sold: string) => `全額 ${full} · 賣出 ${sold}`,
      // 7.2 賣股份區塊（只在有出資者時顯示）
      stakingSection: '賣股份',
      /** 一位出資者「A · 10% · ×1.2」 */
      backerLabel: (name: string, share: string, markup: string) => `${name} · ${share} · ${markup}`,
      /** 「付你 $1,200 · 分走 $5,000」 */
      backerAmounts: (pay: string, payout: string) => `付你 ${pay} · 分走 ${payout}`,
      /** 合計列「賣出 30% · 出資者付款合計 $3,600 · 分走獎金合計 $15,000」 */
      stakingTotal: (sold: string, pay: string, payout: string) =>
        `賣出 ${sold} · 出資者付款合計 ${pay} · 分走獎金合計 ${payout}`,
      fullResult: '全額結果',
      fullProfit: '全額盈利',
      /** 「你的份額（你佔 70%）」 */
      myShare: (percent: string) => `你的份額（你佔 ${percent}）`,
      myCost: '你的成本',
      myCashOut: '你的到手',
      myProfit: '你的盈利',
      finish: '名次',
      /** MTT 只填參賽人數、沒填名次時的列標籤 */
      fieldSize: '參賽人數',
      createdAt: (ts: string) => `建立時間 ${ts}`,
      updatedAt: (ts: string) => `最後修改 ${ts}`,
      archivedSuffix: '（已封存）',
      edit: '編輯',
      copy: '複製為新紀錄',
      delete: '刪除',
    },
    deleteSheet: {
      title: '刪除這筆紀錄？',
      /** 有出資者時盈利後加註「賣 30%」（7.5） */
      soldNote: (percent: string) => `賣 ${percent}`,
      confirm: '刪除',
      failed: '刪除失敗，請再試一次',
    },
    copySheet: {
      title: '覆蓋目前的草稿？',
      failed: '複製失敗，請再試一次',
    },
    editLeaveSheet: {
      title: '放棄變更？',
    },
    undo: {
      deleted: '已刪除',
      restore: '復原',
      restoreFailed: '復原失敗',
    },
  },
  // 第 6 節報表
  report: {
    tabsLabel: '分類',
    tabs: {
      all: '總體',
      cash: '現金桌',
      mtt: 'MTT',
      timed_mtt: '限時 MTT',
    },
    metricsLabel: '指標',
    /** 6.2 指標名稱（ABI 以表格 4.3 的完整名稱顯示） */
    metrics: {
      profit: '盈利',
      count: '場次數',
      winRate: '贏率',
      roi: 'ROI',
      hourly: '時薪',
      bbPerHour: 'bb/hr',
      itm: 'ITM%',
      placePercentile: '平均名次百分位',
      avgProfit: '平均每場盈利',
      abi: '平均單次買入（ABI）',
      avgEntries: '平均進場次數',
      totalHours: '總時數',
      totalBuyIn: '總投入',
      totalCashOut: '總到手',
      totalFee: '總服務費',
      feeRate: '服務費比例',
    },
    /** 總體頁指標卡下方的各類型小表 */
    breakdown: {
      label: '各類型',
      count: (n: number) => `${n} 場`,
      open: (type: string) => `切換到${type}頁籤`,
    },
    noRecordsInPeriod: '這個期間沒有紀錄',
    /** 6 節：有賣股場次時指標卡下方的口徑說明 */
    stakingNote: '含賣股場次，盈利相關指標以你的份額計算',
    curve: {
      title: '累積盈利曲線',
      needTwo: '至少需要 2 場紀錄才能畫出曲線',
      /** tooltip 日期 `2026/09/27` */
      date: (y: string, m: string, d: string) => `${y}/${m}/${d}`,
      sessionProfit: '該場盈利',
      /** 該場有出資者時加註 `（賣 30%）`（6.3） */
      soldSuffix: (percent: string) => `（賣 ${percent}）`,
      cumulative: '累積盈利',
      /** 圖表的無障礙名稱 */
      chartLabel: (n: number, total: string) => `累積盈利曲線，共 ${n} 場，累積 ${total}`,
    },
    groups: {
      title: '分組統計',
      groupByLabel: '分組依據',
      options: {
        venue: '場地',
        stake: '盲注級別',
        name: '名稱',
      },
      unspecified: '未指定',
      unnamed: '未命名',
      archivedSuffix: '（已封存）',
      /** 場地或盲注參照不存在（資料異常，不應發生） */
      unknownRef: '（找不到）',
      columns: {
        count: '場次數',
        profit: '盈利',
        totalFee: '總服務費',
        hourly: '時薪',
        bbPerHour: 'bb/hr',
        roi: 'ROI',
        itm: 'ITM%',
      },
    },
  },
  // 第 8 節設定與資料管理
  settings: {
    listsSection: '常用清單',
    /** 常用清單入口右側的數量 */
    itemCount: (n: number) => `${n} 個`,
    displaySection: '顯示設定',
    profitColor: '盈虧顏色',
    profitSchemes: {
      redGain: '紅色為贏、綠色為輸',
      greenGain: '綠色為贏、紅色為輸',
    },
    profitSample: '範例',
    themeHint: '深淺色主題跟隨系統設定',
    backupSection: '資料備份',
    backupHint: '資料只存在這台裝置，請定期匯出備份檔',
    exportJson: '匯出備份（JSON）',
    importJson: '匯入備份（JSON）',
    exportCsv: '匯出 CSV',
    exporting: '匯出中…',
    lastBackup: '上次備份',
    neverBackedUp: '從未備份',
    exported: '已匯出備份',
    exportedCsv: '已匯出 CSV',
    exportFailed: '匯出失敗，請再試一次',
    /** 分享選單因失去使用者手勢被拒（NotAllowedError）：資料已備妥，再按一次即可 */
    exportRetry: '檔案已準備好，請再按一次匯出',
    preparing: '準備中…',
    importSheet: {
      title: '匯入備份？',
      current: '目前',
      backup: '備份檔',
      sessionCount: (n: number) => `${n} 場`,
      backupTime: (ts: string) => `備份時間 ${ts}`,
      warning: '匯入會取代目前所有資料，建議先匯出備份',
      confirm: '匯入',
      importing: '匯入中…',
    },
    imported: (n: number) => `已匯入 ${n} 場紀錄`,
    importFailed: '匯入失敗，目前資料未變更',
    importReadFailed: '無法讀取檔案，請再試一次',
    importError: {
      title: '無法匯入',
      unchanged: '目前資料未變更',
      /** 失敗原因（8.5 檢查順序） */
      reasons: {
        invalidJson: '檔案不是有效的 JSON',
        notObject: '檔案內容不是備份格式',
        wrongApp: '這不是 Poker Road 的備份檔',
        invalidSchemaVersion: '備份檔的版本號不正確',
        schemaTooNew: '備份檔來自較新版本的 App，請先更新 App 再匯入',
        invalidStructure: '備份檔缺少必要內容或含有無法辨識的內容',
        invalidRecord: '資料未通過檢查',
        duplicateId: 'id 重複',
        duplicateVenueName: '場地名稱重複',
        duplicateStake: '盲注重複',
        missingReference: '參照的資料不存在於備份檔內',
      },
      /** 第一筆有問題的資料位置，例「sessions 第 13 筆（id: …）」 */
      recordAt: (collection: string, index: number, id: string | null) =>
        id === null ? `${collection} 第 ${index} 筆` : `${collection} 第 ${index} 筆（id: ${id}）`,
      settingAt: (key: string) => `settings.${key}`,
      fieldAt: (field: string) => `欄位 ${field}`,
      /** 出資者欄位的位置，例「出資者第 2 位 比例」（8.5） */
      backerAt: (n: number, field: string | null) => (field === null ? `出資者第 ${n} 位` : `出資者第 ${n} 位 ${field}`),
      backersField: '出資者',
      backerFields: {
        name: '名稱',
        sharePermille: '比例',
        markupPermille: '加價倍數',
      },
      /** 位置與說明的組合，例「sessions 第 13 筆（id: …）：buyIns[0].fee 服務費不可大於買入」 */
      detail: (location: string, field: string | null, message: string) =>
        field === null ? `${location}：${message}` : `${location}：${field} ${message}`,
      /** 欄位問題說明 */
      issues: {
        required: '缺少必填欄位',
        invalidType: '型別不正確',
        tooSmall: '數值或長度過小',
        tooBig: '數值或長度超出上限',
        invalidFormat: '格式不正確',
        invalidValue: '值不在允許範圍內',
        unknownKey: '含有無法辨識的欄位',
        notInteger: '必須是整數',
        invalid: '內容不正確',
        invalidStartAt: '開始時間格式不正確',
        feeExceedsAmount: '服務費不可大於買入',
        cashBuyInCount: '現金桌只能有一筆買入',
        cashStakeRequired: '現金桌必須有盲注級別',
        stakeNotAllowed: '錦標賽不可有盲注級別',
        fieldSizeNotAllowed: '只有 MTT 可以有參賽人數',
        finishPlaceNotAllowed: '只有 MTT 可以有名次',
        finishPlaceRequiresFieldSize: '填名次時必須有參賽人數',
        finishPlaceExceedsFieldSize: '名次需介於 1 到參賽人數之間',
        notTrimmed: '前後不可有空白',
        emptyText: '不可為空字串',
        textTooLong: '字數超過上限',
        bbLessThanSb: '大盲不可小於小盲',
        duplicateBackerName: '出資者名稱重複',
        backerShareTotalExceeded: '賣出比例合計超過 100%',
        duplicateId: (id: string) => `id ${id} 重複`,
        duplicateVenueName: (name: string) => `場地名稱「${name}」重複`,
        duplicateStake: (label: string) => `盲注 ${label} 重複`,
        missingVenue: (id: string) => `venueId ${id} 不存在`,
        missingStake: (id: string) => `stakeId ${id} 不存在`,
      },
    },
    systemSection: '資料與系統資訊',
    runMode: '執行模式',
    runModes: {
      standalone: '主畫面 App',
      browser: '瀏覽器分頁',
    },
    persistentStorage: '持久儲存',
    persisted: '已取得',
    notPersisted: '未取得',
    dataCount: '資料量',
    dataCountValue: (sessions: number, venues: number, stakes: number) =>
      `${sessions} 場 · ${venues} 個場地 · ${stakes} 個盲注`,
    appVersion: 'App 版本',
    clearSection: '危險操作',
    clearAll: '清除所有資料',
    clearSheet: {
      title: '清除所有資料？',
      warning: '所有紀錄、場地、盲注與設定都會被刪除，無法復原。建議先匯出備份。',
      inputLabel: '請輸入「刪除」以確認',
      keyword: '刪除',
      confirm: '清除所有資料',
      clearing: '清除中…',
    },
    cleared: '已清除所有資料',
    clearFailed: '清除失敗，請再試一次',
    actionFailed: '操作失敗，請再試一次',
  },
  // 8.1 場地管理、8.2 盲注管理
  manage: {
    add: '新增',
    usage: (n: number) => `${n} 場`,
    moveUp: (label: string) => `上移 ${label}`,
    moveDown: (label: string) => `下移 ${label}`,
    more: (label: string) => `更多操作：${label}`,
    archivedSection: (n: number) => `已封存（${n}）`,
    noActive: '沒有使用中的項目',
    archive: '封存',
    unarchive: '取消封存',
    delete: '刪除',
    rename: '改名',
    editStake: '修改小盲、大盲',
    /** 操作 sheet 內的說明：被參照時只能封存 */
    inUseHint: (n: number) => `已被 ${n} 場紀錄使用，無法刪除，只能封存`,
    stakeInUseHint: (n: number) => `已被 ${n} 場紀錄使用，無法修改或刪除，只能封存`,
    archivedHint: '已封存：不會出現在新增頁選單，歷史紀錄與報表照常顯示',
    venues: {
      empty: '還沒有場地',
      deleteTitle: (name: string) => `刪除場地「${name}」？`,
      renameTitle: '場地改名',
    },
    stakes: {
      empty: '還沒有盲注',
      deleteTitle: (label: string) => `刪除盲注 ${label}？`,
      editTitle: '修改盲注',
    },
    inUseError: '已被紀錄使用，無法執行',
  },
  // 8.6 CSV 標題列（欄位順序即匯出順序）
  csv: {
    headers: [
      '日期',
      '開始時',
      '類型',
      '場地',
      '盲注',
      '名稱',
      '進場次數',
      '買入總額',
      '服務費總額',
      '到手金額',
      '全額盈利',
      '賣出比例',
      '出資者付款總額',
      '分走獎金總額',
      '你的盈利',
      '出資者',
      '時長（分）',
      '參賽人數',
      '名次',
      '備註',
    ],
    /** 出資者欄的一位：`A 10%×1.2`（8.6） */
    backerItem: (name: string, share: string, markup: string) => `${name} ${share}${markup}`,
    /** 出資者之間以全形分號連接 */
    backerSeparator: '；',
  },
  // 8.7 備份提醒
  backupReminder: {
    label: '備份提醒',
    message: '建議備份資料',
    action: '前往備份',
  },
  // 開發用（11.1）：只在開發模式（import.meta.env.DEV）顯示，正式版不出現
  dev: {
    section: '開發工具',
    seed: '產生 5,000 筆測試資料',
    seeding: '產生中…',
    seeded: (n: string) => `已產生 ${n} 筆測試資料`,
    seedFailed: '產生失敗',
  },
  installBanner: {
    message: '建議加入主畫面，資料才不會與瀏覽器分開',
  },
  update: {
    available: '有新版本',
    reload: '重新載入',
  },
  // 3.7 資料庫升級（version 1 → 2）失敗時的錯誤狀態
  dbUpgrade: {
    failed: '資料升級失敗，請關閉 App 後重新開啟；你的資料沒有遺失',
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
    /** 加價倍數前綴：`×1.2`（4.4） */
    markupPrefix: '×',
    bbPerHourSuffix: ' bb/hr',
    hours: (value: string) => `${value} 小時`,
    /** 贏率、ITM%：`13/26（50.0%）` */
    fraction: (numerator: number, denominator: number, percent: string) =>
      `${numerator}/${denominator}（${percent}%）`,
    /** 平均名次百分位：`前 23.5%（n=12）` */
    placePercentile: (percent: string, n: number) => `前 ${percent}%（n=${n}）`,
    /** 盲注顯示名稱 `sb/bb`（3.4） */
    stake: (sb: number, bb: number) => `${sb}/${bb}`,
    /** 時長 `4 小時 30 分`（7.2） */
    duration: (hours: number, minutes: number) => `${hours} 小時 ${minutes} 分`,
    /** 單場 bb 盈利後綴：`+20.0 bb` */
    bbSuffix: ' bb',
    /** MTT 名次：`第 12 名 / 180 人（前 6.7%）` */
    finishPlace: (place: number, fieldSize: number, percent: string) =>
      `第 ${place} 名 / ${fieldSize} 人（前 ${percent}%）`,
    /** MTT 只填參賽人數、沒填名次：`共 180 人` */
    fieldSizeOnly: (fieldSize: number) => `共 ${fieldSize} 人`,
    /** 標題組合：現金桌 `場地 · 50/100` */
    titleJoin: (a: string, b: string) => `${a} · ${b}`,
  },
} as const
