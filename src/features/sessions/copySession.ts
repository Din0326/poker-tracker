// 7.4 複製為新紀錄（純函式）：把來源場次轉成新增頁的預填值，寫成草稿（5.6）後由新增頁照既有邏輯還原。
import type { Session, Stake, Venue } from '../../domain'
import { localDate, toDraft, type RecordDraftData, type RecordFormValues } from '../record/formModel'

/** 只預填未封存且存在的場地 / 盲注；已封存或不存在時留空（7.4、R3） */
function activeOrEmpty(id: string | null, items: readonly { id: string; archived: boolean }[]): string {
  if (id === null) return ''
  return items.some((i) => i.id === id && !i.archived) ? id : ''
}

/**
 * 預填：類型、場地、盲注、名稱、全部買入列；開始時間為現在（今天、目前小時）；
 * 到手金額、時長、參賽人數、名次、備註留空。服務費 0 顯示為空白（留空視為 0），與編輯模式一致。
 */
export function sessionToCopyValues(
  s: Session,
  stakes: readonly Stake[],
  venues: readonly Venue[],
  now: Date,
): RecordFormValues {
  return {
    type: s.type,
    stakeId: s.type === 'cash' ? activeOrEmpty(s.stakeId, stakes) : '',
    buyIns: (s.type === 'cash' ? s.buyIns.slice(0, 1) : s.buyIns).map((b) => ({
      amount: String(b.amount),
      fee: b.fee === 0 ? '' : String(b.fee),
    })),
    cashOut: '',
    fieldSize: '',
    finishPlace: '',
    startDate: localDate(now),
    startHour: String(now.getHours()),
    durationH: '',
    durationM: '',
    venueId: activeOrEmpty(s.venueId, venues),
    name: s.name ?? '',
    note: '',
  }
}

/**
 * 複製用的草稿。venueTouched 設為 true：場地來自來源場次（視同使用者選定），
 * 在新增頁切換類型時保留，不改帶 lastVenueByType。
 */
export function sessionToCopyDraft(
  s: Session,
  stakes: readonly Stake[],
  venues: readonly Venue[],
  now: Date,
): RecordDraftData {
  return toDraft(sessionToCopyValues(s, stakes, venues, now), true)
}
