// 新增 / 編輯場次表單的純邏輯（第 5 節）：表單值型別、預設值、類型切換、5.4 驗證、
// 轉換成 repository 的輸入、即時預覽、草稿（5.6）、賣股份出資者列（v1.2）。不含 React 與 DB，方便單元測試。
// 計算一律呼叫 src/domain 的函式，這裡只負責「表單字串 → 數值」的轉換。
import dayjs from 'dayjs'
import { z } from 'zod'
import type { SessionInput } from '../../db'
import {
  DEFAULT_MARKUP_PERMILLE,
  MAX_AMOUNT,
  MAX_BACKERS,
  MAX_BACKER_NAME_LENGTH,
  MAX_BUY_INS,
  MAX_DURATION_MIN,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_SHARE_PERMILLE,
  SESSION_TYPES,
  backerNameKey,
  backerPay,
  backerPayout,
  buyInTotal,
  charCount,
  entryCount,
  feeTotal,
  formatPermille,
  fullProfit,
  isValidStartAt,
  markupNumber,
  myProfit,
  parseMarkupInput,
  parseShareInput,
  permilleNumber,
  type Backer,
  type Session,
  type SessionType,
  type Stake,
  type Venue,
} from '../../domain'
import { strings } from '../../strings'

const e = strings.record.errors

/** 一列買入的原始輸入（只含數字的字串，不含千分位） */
export interface BuyInValues {
  amount: string
  fee: string
}

/**
 * 一位出資者的原始輸入（5.3）：名稱、比例（%）、加價倍數，皆為使用者輸入的原始字串
 * （比例、倍數只含數字與一個小數點）
 */
export interface BackerValues {
  name: string
  share: string
  markup: string
}

/** 表單原始輸入值；數字欄位一律為只含數字的字串，'' 代表未填 / 未選 */
export interface RecordFormValues {
  type: SessionType
  /** 現金桌盲注；'' 代表未選 */
  stakeId: string
  buyIns: BuyInValues[]
  cashOut: string
  /** 標準 MTT 參賽人數 */
  fieldSize: string
  /** 標準 MTT 名次 */
  finishPlace: string
  /** `YYYY-MM-DD` */
  startDate: string
  /** '0'–'23' */
  startHour: string
  /** '' 代表未選（—）；'0'–'72' */
  durationH: string
  /** '' 代表未選（—）；'0'–'55'，每 5 分鐘 */
  durationM: string
  /** '' 代表「不指定」 */
  venueId: string
  name: string
  note: string
  /** 賣股份出資者列（5.3）；0 列時區塊收合。屬共用欄位，切換類型時保留（5.1） */
  backers: BackerValues[]
}

/** 表單預帶值需要的設定（3.5） */
export interface RecordFormSettings {
  lastType: SessionType | undefined
  lastVenueByType: Partial<Record<SessionType, string | null>>
  lastStakeId: string | undefined
}

/** 小時選單 0–23、時長小時 0–72、時長分鐘 0–55 每 5 分鐘（5.3） */
export const START_HOURS = Array.from({ length: 24 }, (_, i) => i)
export const DURATION_HOURS = Array.from({ length: 73 }, (_, i) => i)
export const DURATION_MINUTES = Array.from({ length: 12 }, (_, i) => i * 5)

export const EMPTY_BUY_IN: BuyInValues = { amount: '', fee: '' }

/**
 * 比例合計錯誤的路徑（5.4）。刻意不掛在 backers 陣列本身：react-hook-form 會把陣列層級的錯誤
 * 與各列錯誤放在同一個物件，重新驗證時互相覆蓋；獨立的 key 可單獨重新驗證與顯示。
 */
export const BACKERS_TOTAL_ERROR_KEY = 'backersTotal'

/** 新增的出資者列：名稱與比例空白，加價倍數預填 1.0（5.3） */
export function newBackerRow(): BackerValues {
  return { name: '', share: '', markup: strings.record.staking.defaultMarkup }
}

/**
 * 空白列（5.4）：名稱與比例都空白、且倍數空白或等於 1.0。儲存時自動移除，不套用任何出資者規則。
 * 「等於 1.0」以數值判斷（1、1.0、1.000 皆是）。
 */
export function isBlankBacker(b: BackerValues): boolean {
  if (b.name.trim() !== '' || b.share.trim() !== '') return false
  if (b.markup.trim() === '') return true
  const m = parseMarkupInput(b.markup)
  return m.ok && m.value === DEFAULT_MARKUP_PERMILLE
}

/** 出資者列中比例欄有效值的合計（千分比）：區塊摘要、預覽、合計驗證共用（5.2、5.3、5.4） */
export function validShareTotal(backers: readonly BackerValues[]): number {
  let total = 0
  for (const b of backers) {
    const r = parseShareInput(b.share)
    if (r.ok) total += r.value
  }
  return total
}

/** 出資者列的比例與倍數轉為儲存值；任一欄無效時回傳 null（不含名稱檢查） */
export function toBackerShare(b: BackerValues): Pick<Backer, 'sharePermille' | 'markupPermille'> | null {
  const share = parseShareInput(b.share)
  const markup = parseMarkupInput(b.markup)
  return share.ok && markup.ok ? { sharePermille: share.value, markupPermille: markup.value } : null
}

/** 錦標賽（多筆買入）類型 */
export function isTournament(type: SessionType): boolean {
  return type !== 'cash'
}

/** 只含數字的字串轉為整數；'' 回傳 null */
export function parseDigits(value: string): number | null {
  if (value === '' || !/^\d+$/.test(value)) return null
  return Number(value)
}

/** 本地日期 `YYYY-MM-DD` */
export function localDate(now: Date): string {
  return dayjs(now).format('YYYY-MM-DD')
}

/** 現在時間（精度到小時）`YYYY-MM-DDTHH:00` */
export function currentStartAt(now: Date): string {
  return dayjs(now).format('YYYY-MM-DDTHH:00')
}

/** 日期與小時組成 startAt `YYYY-MM-DDTHH:00` */
export function buildStartAt(date: string, hour: string): string {
  return `${date}T${hour.padStart(2, '0')}:00`
}

/** 開始時間顯示文字 `2026/09/27 20 時`；日期不合法時回傳 null */
export function formatStartAt(date: string, hour: string): string | null {
  const startAt = buildStartAt(date, hour)
  if (!isValidStartAt(startAt)) return null
  const [y = '', m = '', d = ''] = date.split('-')
  return strings.record.startAtDisplay(y, m, d, Number(hour))
}

/** 只保留未封存且存在的 id；否則回傳 ''（lastStakeId、lastVenueByType 指向已封存項目時不預帶） */
function activeIdOrEmpty(id: string | null | undefined, items: readonly { id: string; archived: boolean }[]): string {
  if (!id) return ''
  return items.some((i) => i.id === id && !i.archived) ? id : ''
}

/** 某類型預帶的場地（5.3：依類型預帶 Settings.lastVenueByType） */
export function defaultVenueFor(type: SessionType, settings: RecordFormSettings, venues: readonly Venue[]): string {
  return activeIdOrEmpty(settings.lastVenueByType[type], venues)
}

/** 現金桌預帶的盲注（5.3：預設帶入 Settings.lastStakeId） */
export function defaultStake(settings: RecordFormSettings, stakes: readonly Stake[]): string {
  return activeIdOrEmpty(settings.lastStakeId, stakes)
}

/** 剛進新增頁時的預設值：類型、場地、盲注依 last* 設定，開始時間為今天、目前小時 */
export function createDefaults(
  settings: RecordFormSettings,
  stakes: readonly Stake[],
  venues: readonly Venue[],
  now: Date,
): RecordFormValues {
  const type = settings.lastType ?? 'cash'
  return {
    type,
    stakeId: type === 'cash' ? defaultStake(settings, stakes) : '',
    buyIns: [{ ...EMPTY_BUY_IN }],
    cashOut: '',
    fieldSize: '',
    finishPlace: '',
    startDate: localDate(now),
    startHour: String(now.getHours()),
    durationH: '',
    durationM: '',
    venueId: defaultVenueFor(type, settings, venues),
    name: '',
    note: '',
    backers: [],
  }
}

export interface SwitchTypeContext {
  settings: RecordFormSettings
  stakes: readonly Stake[]
  venues: readonly Venue[]
  /** 使用者是否手動改過場地；未改過時切換類型改帶新類型的 lastVenueByType（Q2） */
  venueTouched: boolean
}

/**
 * 5.1 切換類型：共用欄位保留（含出資者列），類型專屬欄位（cash 的盲注；mtt 的參賽人數、名次）清空。
 * 切到現金桌只保留第一筆買入（多筆時呼叫端須先確認）。
 * 切入現金桌時盲注帶入預設值（lastStakeId），與剛進頁面的行為一致。
 */
export function switchType(values: RecordFormValues, type: SessionType, ctx: SwitchTypeContext): RecordFormValues {
  if (values.type === type) return values
  const [first = { ...EMPTY_BUY_IN }] = values.buyIns
  return {
    ...values,
    type,
    stakeId: type === 'cash' ? defaultStake(ctx.settings, ctx.stakes) : '',
    buyIns: type === 'cash' ? [first] : values.buyIns,
    fieldSize: '',
    finishPlace: '',
    venueId: ctx.venueTouched ? values.venueId : defaultVenueFor(type, ctx.settings, ctx.venues),
  }
}

/** 切換到 type 前是否需要確認（5.1：錦標賽切到現金桌且買入 > 1 筆） */
export function needsSwitchConfirm(values: RecordFormValues, type: SessionType): boolean {
  return type === 'cash' && isTournament(values.type) && values.buyIns.length > 1
}

/**
 * 5.5 儲存後重置：類型、場地、盲注、日期與小時保留（Q3）；
 * 金額、時長、名稱、備註、參賽人數、名次清空；買入回到 1 列；出資者列全部清空（區塊回到收合）。
 */
export function resetAfterSave(values: RecordFormValues): RecordFormValues {
  return {
    ...values,
    buyIns: [{ ...EMPTY_BUY_IN }],
    cashOut: '',
    fieldSize: '',
    finishPlace: '',
    durationH: '',
    durationM: '',
    name: '',
    note: '',
    backers: [],
  }
}

/** 兩組表單值是否完全相同（用於判斷「表單有任何輸入」與編輯模式的未儲存變更） */
export function valuesEqual(a: RecordFormValues, b: RecordFormValues): boolean {
  const keys = Object.keys(a) as (keyof RecordFormValues)[]
  if (keys.length !== Object.keys(b).length) return false
  for (const key of keys) {
    if (key === 'buyIns') {
      if (a.buyIns.length !== b.buyIns.length) return false
      if (a.buyIns.some((x, i) => x.amount !== b.buyIns[i]?.amount || x.fee !== b.buyIns[i]?.fee)) return false
    } else if (key === 'backers') {
      // 出資者列的增刪與修改算作變更（5.7）
      if (a.backers.length !== b.backers.length) return false
      const changed = a.backers.some((x, i) => {
        const y = b.backers[i]
        return x.name !== y?.name || x.share !== y.share || x.markup !== y.markup
      })
      if (changed) return false
    } else if (a[key] !== b[key]) {
      return false
    }
  }
  return true
}

/** 金額是否為合法買入（1–99,999,999） */
function isValidAmount(n: number | null): n is number {
  return n !== null && n >= 1 && n <= MAX_AMOUNT
}

/**
 * 5.4 驗證規則。now 用於「開始時間不可是未來」（依小時比較）。
 * 錯誤訊息直接使用 strings.ts 的文字；時長錯誤掛在 durationH、開始時間錯誤掛在 startDate。
 */
export function createRecordSchema(now: Date) {
  const str = z.string()
  return z
    .object({
      type: z.enum(SESSION_TYPES),
      stakeId: str,
      buyIns: z.array(z.object({ amount: str, fee: str })),
      cashOut: str,
      fieldSize: str,
      finishPlace: str,
      startDate: str,
      startHour: str,
      durationH: str,
      durationM: str,
      venueId: str,
      name: str,
      note: str,
      backers: z.array(z.object({ name: str, share: str, markup: str })),
    })
    .superRefine((v, ctx) => {
      const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path })

      // 現金桌未選盲注
      if (v.type === 'cash' && v.stakeId === '') issue(e.stakeRequired, ['stakeId'])

      // 買入空白或為 0、服務費 > 該筆買入、金額超過上限
      v.buyIns.forEach((b, i) => {
        const amount = parseDigits(b.amount)
        if (amount === null || amount === 0) issue(e.buyInRequired, ['buyIns', i, 'amount'])
        else if (amount > MAX_AMOUNT) issue(e.amountTooLarge, ['buyIns', i, 'amount'])
        const fee = parseDigits(b.fee) ?? 0
        if (fee > MAX_AMOUNT) issue(e.amountTooLarge, ['buyIns', i, 'fee'])
        else if (isValidAmount(amount) && fee > amount) issue(e.feeExceedsBuyIn, ['buyIns', i, 'fee'])
      })

      // 到手金額空白、超過上限
      const cashOut = parseDigits(v.cashOut)
      if (cashOut === null) issue(e.cashOutRequired, ['cashOut'])
      else if (cashOut > MAX_AMOUNT) issue(e.amountTooLarge, ['cashOut'])

      // 時長：兩個選單都必選；0 時 0 分或超過 72 小時
      const h = parseDigits(v.durationH)
      const m = parseDigits(v.durationM)
      if (h === null || m === null) issue(e.durationRange, ['durationH'])
      else {
        const total = h * 60 + m
        if (total < 1 || total > MAX_DURATION_MIN) issue(e.durationRange, ['durationH'])
      }

      // 開始時間晚於現在（依小時比較）
      const startAt = buildStartAt(v.startDate, v.startHour)
      if (!isValidStartAt(startAt)) issue(e.startDateRequired, ['startDate'])
      else if (startAt > currentStartAt(now)) issue(e.startAtFuture, ['startDate'])

      // 標準 MTT：參賽人數、名次（選填）
      if (v.type === 'mtt') {
        const fieldSize = parseDigits(v.fieldSize)
        const place = parseDigits(v.finishPlace)
        if (fieldSize !== null && fieldSize < 2) issue(e.fieldSizeMin, ['fieldSize'])
        if (place !== null) {
          if (fieldSize === null) issue(e.finishPlaceNeedsFieldSize, ['finishPlace'])
          else if (place < 1 || place > fieldSize) issue(e.finishPlaceRange, ['finishPlace'])
        }
      }

      // 名稱、備註字數（Unicode code point）
      if (charCount(v.name) > MAX_NAME_LENGTH) issue(e.textTooLong, ['name'])
      if (charCount(v.note) > MAX_NOTE_LENGTH) issue(e.textTooLong, ['note'])

      // 出資者（5.4）：只套用在非空白列；空白列儲存時自動移除
      const shareMessages = { empty: e.shareRequired, format: e.shareFormat, range: e.shareRange }
      const markupMessages = { empty: e.markupRequired, format: e.markupFormat, range: e.markupRange }
      const seenNames = new Set<string>()
      v.backers.forEach((b, i) => {
        if (isBlankBacker(b)) return
        const name = b.name.trim()
        if (name === '') issue(e.backerNameRequired, ['backers', i, 'name'])
        else if (charCount(name) > MAX_BACKER_NAME_LENGTH) issue(e.backerNameTooLong, ['backers', i, 'name'])
        else {
          const key = backerNameKey(name)
          if (seenNames.has(key)) issue(e.backerNameDuplicate, ['backers', i, 'name'])
          seenNames.add(key)
        }
        const share = parseShareInput(b.share)
        if (!share.ok) issue(shareMessages[share.reason], ['backers', i, 'share'])
        const markup = parseMarkupInput(b.markup)
        if (!markup.ok) issue(markupMessages[markup.reason], ['backers', i, 'markup'])
      })
      // 比例合計超過 100%：錯誤掛在 BACKERS_TOTAL_ERROR_KEY（顯示在賣股份區塊標題下方）；合計恰為 100% 合法
      const total = validShareTotal(v.backers.filter((b) => !isBlankBacker(b)))
      if (total > MAX_SHARE_PERMILLE) issue(e.shareTotal(formatPermille(total)), [BACKERS_TOTAL_ERROR_KEY])
    })
}

/** 已通過驗證的表單值轉為 repository 的輸入（name / note 的正規化由 repository 處理） */
export function toSessionInput(v: RecordFormValues): SessionInput {
  const buyIns = (v.type === 'cash' ? v.buyIns.slice(0, 1) : v.buyIns).map((b) => ({
    amount: parseDigits(b.amount) ?? 0,
    fee: parseDigits(b.fee) ?? 0,
  }))
  return {
    type: v.type,
    startAt: buildStartAt(v.startDate, v.startHour),
    durationMin: (parseDigits(v.durationH) ?? 0) * 60 + (parseDigits(v.durationM) ?? 0),
    buyIns,
    cashOut: parseDigits(v.cashOut) ?? 0,
    stakeId: v.type === 'cash' ? v.stakeId : null,
    venueId: v.venueId === '' ? null : v.venueId,
    name: v.name,
    note: v.note,
    fieldSize: v.type === 'mtt' ? parseDigits(v.fieldSize) : null,
    finishPlace: v.type === 'mtt' ? parseDigits(v.finishPlace) : null,
    // 空白列自動移除；其餘列已通過驗證（名稱去除前後空白由 repository 處理）
    backers: v.backers.flatMap((b) => {
      const share = isBlankBacker(b) ? null : toBackerShare(b)
      return share ? [{ name: b.name, ...share }] : []
    }),
  }
}

/** 已儲存的出資者轉為表單列（編輯、複製）：比例 125 → '12.5'、倍數 1150 → '1.15' */
export function backersToValues(backers: readonly Backer[]): BackerValues[] {
  return backers.map((b) => ({
    name: b.name,
    share: permilleNumber(b.sharePermille),
    markup: markupNumber(b.markupPermille),
  }))
}

/** 既有場次轉為表單值（編輯模式）；服務費 0 顯示為空白（留空視為 0），與新增時一致 */
export function sessionToValues(s: Session): RecordFormValues {
  const hour = Number(s.startAt.slice(11, 13))
  return {
    type: s.type,
    stakeId: s.stakeId ?? '',
    buyIns: s.buyIns.map((b) => ({ amount: String(b.amount), fee: b.fee === 0 ? '' : String(b.fee) })),
    cashOut: String(s.cashOut),
    fieldSize: s.fieldSize === null ? '' : String(s.fieldSize),
    finishPlace: s.finishPlace === null ? '' : String(s.finishPlace),
    startDate: s.startAt.slice(0, 10),
    startHour: String(hour),
    durationH: String(Math.floor(s.durationMin / 60)),
    durationM: String(s.durationMin % 60),
    venueId: s.venueId ?? '',
    name: s.name ?? '',
    note: s.note ?? '',
    backers: backersToValues(s.backers),
  }
}

/** 底部即時預覽（5.2）；無法計算的項目為 null（顯示 —） */
export interface RecordPreview {
  buyInTotal: number | null
  entries: number
  feeTotal: number | null
  /** 全額盈利（沒有出資者列時即「盈利」，與 v1.1 相同） */
  profit: number | null
  /** 出資者列數（含空白列）；> 0 時預覽改為兩行 */
  backerRows: number
  /** 比例欄有效值的合計（千分比） */
  soldPermille: number
  /** 你的盈利：買入、到手金額與每一列的比例、倍數都有效（不含名稱）才計算 */
  myProfit: number | null
}

/**
 * 出資者列第三行（5.3）：付你 / 分走。
 * 買入無效時付款為 null、到手金額無效時分走為 null；該列比例或倍數無效時兩者皆為 null。
 */
export interface BackerRowPreview {
  pay: number | null
  payout: number | null
}

function parsedAmounts(v: RecordFormValues) {
  const rows = v.type === 'cash' ? v.buyIns.slice(0, 1) : v.buyIns
  const amounts = rows.map((b) => parseDigits(b.amount))
  const fees = rows.map((b) => parseDigits(b.fee) ?? 0)
  const buyIns = rows.map((_, i) => ({ amount: amounts[i] ?? 0, fee: fees[i] ?? 0 }))
  const buyInsValid = amounts.every(isValidAmount)
  const feesValid = fees.every((f) => f <= MAX_AMOUNT)
  const cashOut = parseDigits(v.cashOut)
  const cashOutValid = cashOut !== null && cashOut <= MAX_AMOUNT
  return { buyIns, buyInsValid, feesValid, cashOut: cashOut ?? 0, cashOutValid }
}

export function computeBackerRowPreview(v: RecordFormValues, index: number): BackerRowPreview {
  const row = v.backers[index]
  const share = row ? toBackerShare(row) : null
  if (!share) return { pay: null, payout: null }
  const a = parsedAmounts(v)
  return {
    pay: a.buyInsValid ? backerPay(buyInTotal({ buyIns: a.buyIns }), share) : null,
    payout: a.cashOutValid ? backerPayout(a.cashOut, share) : null,
  }
}

export function computePreview(v: RecordFormValues): RecordPreview {
  const { buyIns, buyInsValid, feesValid, cashOut, cashOutValid } = parsedAmounts(v)
  const amountsValid = buyInsValid && cashOutValid
  const backers: Backer[] = []
  for (const row of v.backers) {
    const share = toBackerShare(row)
    // 名稱不影響計算（以空字串代入）；任一列比例或倍數無效時不計算你的盈利
    if (share) backers.push({ name: '', ...share })
  }
  const sharesValid = backers.length === v.backers.length
  return {
    buyInTotal: buyInsValid ? buyInTotal({ buyIns }) : null,
    entries: entryCount({ buyIns }),
    feeTotal: feesValid ? feeTotal({ buyIns }) : null,
    profit: amountsValid ? fullProfit({ buyIns, cashOut }) : null,
    backerRows: v.backers.length,
    soldPermille: validShareTotal(v.backers),
    // 份額以 domain 的整數運算計算（4.6）
    myProfit: amountsValid && sharesValid ? myProfit({ buyIns, cashOut, backers }) : null,
  }
}

// ---- 5.6 草稿 ----

/** v2（v1.2）：新增出資者列；v1（v1.1）草稿沒有出資者資料，還原時視為 0 列 */
export const RECORD_DRAFT_VERSION = 2

const digitString = z.string().regex(/^\d*$/)
/** 比例、倍數輸入框只接受數字與小數點（5.3），草稿保存原始字串（含尚未通過驗證的值） */
const decimalString = z.string().regex(/^[\d.]*$/)

const draftValuesV1 = {
  stakeId: z.string(),
  buyIns: z
    .array(z.strictObject({ amount: digitString, fee: digitString }))
    .min(1)
    .max(MAX_BUY_INS),
  cashOut: digitString,
  fieldSize: digitString,
  finishPlace: digitString,
  startDate: z.string(),
  startHour: z.string().regex(/^(?:[0-9]|1[0-9]|2[0-3])$/),
  durationH: z.string().regex(/^(?:|[0-9]|[1-6][0-9]|7[0-2])$/),
  durationM: z.string().regex(/^(?:|0|5|[1-5][05])$/),
  venueId: z.string(),
  name: z.string(),
  note: z.string(),
}

const draftSchemaV1 = z.strictObject({
  version: z.literal(1),
  type: z.enum(SESSION_TYPES),
  venueTouched: z.boolean(),
  values: z.strictObject(draftValuesV1),
})

const draftSchema = z.strictObject({
  version: z.literal(RECORD_DRAFT_VERSION),
  type: z.enum(SESSION_TYPES),
  venueTouched: z.boolean(),
  values: z.strictObject({
    ...draftValuesV1,
    backers: z
      .array(z.strictObject({ name: z.string(), share: decimalString, markup: decimalString }))
      .max(MAX_BACKERS),
  }),
})

export type RecordDraftData = z.infer<typeof draftSchema>

export function toDraft(values: RecordFormValues, venueTouched: boolean): RecordDraftData {
  const { type, ...rest } = values
  return { version: RECORD_DRAFT_VERSION, type, venueTouched, values: rest }
}

/**
 * 解析 Settings.recordDraft；版本不符或格式錯誤回傳 null（丟棄草稿）。
 * v1（v1.1）草稿能通過 v1 格式時沿用，出資者視為 0 列（5.6）。
 * 草稿內的盲注、場地若已不在可選清單（已封存或不存在），改為未選 / 不指定。
 */
export function parseDraft(
  raw: unknown,
  stakes: readonly Stake[],
  venues: readonly Venue[],
): { values: RecordFormValues; venueTouched: boolean } | null {
  const current = draftSchema.safeParse(raw)
  let data: RecordDraftData
  if (current.success) {
    data = current.data
  } else {
    const legacy = draftSchemaV1.safeParse(raw)
    if (!legacy.success) return null
    data = {
      ...legacy.data,
      version: RECORD_DRAFT_VERSION,
      values: { ...legacy.data.values, backers: [] },
    }
  }
  const { type, values, venueTouched } = data
  if (type === 'cash' && values.buyIns.length !== 1) return null
  return {
    venueTouched,
    values: {
      ...values,
      type,
      buyIns: values.buyIns.map((b) => ({ ...b })),
      backers: values.backers.map((b) => ({ ...b })),
      stakeId: type === 'cash' ? activeIdOrEmpty(values.stakeId, stakes) : '',
      venueId: activeIdOrEmpty(values.venueId, venues),
    },
  }
}

