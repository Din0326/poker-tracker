// SPEC-v2-hands 5.3「自動捲動」（v2.4）：完整模式新增行動、復原上一步、確認公牌、進入結果步驟後，
// 把「最新一筆行動」到「底池資訊」的區塊捲到頂端標題列之下、固定行動列與鍵盤之上。
// - 回看時不捲：操作當下距頁面底部超過可視高度的 1/3 時不捲動（isNearPageBottom）
// - 動效：200ms ease-out，以 requestAnimationFrame 自行計算（原生 smooth 的時長由瀏覽器決定，可能超過 v1 9.3 的 250ms）；
//   使用者觸控、滾輪或按鍵時立即停止。prefers-reduced-motion 時直接跳到位置（behavior: 'auto'）
import { OBSCURES_BOTTOM_ATTR } from './viewport'

/** 距頁面底部不超過「可視高度 × 此比例」才視為在底部附近 */
export const AUTO_SCROLL_NEAR_BOTTOM_RATIO = 1 / 3
/** 捲動動畫時長（≤ 250ms，v1 9.3） */
export const AUTO_SCROLL_DURATION_MS = 200
/** 目標區塊與標題列、固定列之間保留的間距 */
export const AUTO_SCROLL_MARGIN = 12

/** 操作當下是否在頁面底部附近（距底部 ≤ 可視高度的 1/3）；超過代表使用者正在往上回看 */
export function isNearPageBottom(): boolean {
  const distance = document.documentElement.scrollHeight - window.scrollY - window.innerHeight
  return distance <= window.innerHeight * AUTO_SCROLL_NEAR_BOTTOM_RATIO
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/** 可見範圍（viewport 座標）：頂端標題列之下、底部固定列（含分頁列）與鍵盤之上 */
function visibleArea(): { top: number; bottom: number } {
  const vv = window.visualViewport
  const viewTop = vv ? vv.offsetTop : 0
  let bottom = vv ? vv.offsetTop + vv.height : window.innerHeight
  for (const bar of document.querySelectorAll(`[${OBSCURES_BOTTOM_ATTR}]`)) {
    const r = bar.getBoundingClientRect()
    if (r.height > 0 && r.top < bottom && r.bottom > viewTop) bottom = Math.min(bottom, r.top)
  }
  const header = document.querySelector('header')
  const top = Math.max(viewTop, header ? header.getBoundingClientRect().bottom : 0)
  return { top, bottom }
}

/**
 * 讓 [top, bottom] 區塊完整顯示在可見範圍所需的垂直捲動量（正值往下捲）；已完整可見時為 0。
 * 區塊比可見範圍高時，以 top（最新一筆行動）對齊可見範圍上緣。
 */
export function revealDelta(top: Element, bottom: Element): number {
  const area = visibleArea()
  const t = top.getBoundingClientRect().top
  const b = bottom.getBoundingClientRect().bottom
  if (b > area.bottom - AUTO_SCROLL_MARGIN) return Math.min(b - area.bottom + AUTO_SCROLL_MARGIN, t - area.top - AUTO_SCROLL_MARGIN)
  if (t < area.top + AUTO_SCROLL_MARGIN) return t - area.top - AUTO_SCROLL_MARGIN
  return 0
}

let cancelRunning: (() => void) | null = null

const easeOutCubic = (x: number) => 1 - (1 - x) ** 3

/**
 * 捲動視窗 delta 像素：reducedMotion 時以 window.scrollTo({ behavior: 'auto' }) 直接跳到位置；
 * 否則以 200ms ease-out 動畫，使用者觸控、滾輪或按鍵時停止。新的捲動會取消進行中的動畫。
 */
export function scrollWindowBy(delta: number, reducedMotion: boolean, onDone?: () => void): void {
  cancelRunning?.()
  if (delta === 0) return
  const start = window.scrollY
  const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
  const target = Math.min(max, Math.max(0, start + delta))
  if (target === start) {
    onDone?.()
    return
  }
  if (reducedMotion) {
    window.scrollTo({ top: target, behavior: 'auto' })
    onDone?.()
    return
  }
  let frame = 0
  const stopEvents = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
  const cancel = () => {
    cancelAnimationFrame(frame)
    for (const e of stopEvents) window.removeEventListener(e, cancel)
    if (cancelRunning === cancel) cancelRunning = null
  }
  for (const e of stopEvents) window.addEventListener(e, cancel, { passive: true })
  cancelRunning = cancel
  const t0 = performance.now()
  const step = (now: number) => {
    const progress = Math.min(1, (now - t0) / AUTO_SCROLL_DURATION_MS)
    window.scrollTo({ top: start + (target - start) * easeOutCubic(progress), behavior: 'auto' })
    if (progress < 1) frame = requestAnimationFrame(step)
    else {
      cancel()
      onDone?.()
    }
  }
  frame = requestAnimationFrame(step)
}

/**
 * 5.3：把 [top, bottom] 區塊捲到可見範圍（已可見時不捲）。
 * 捲完後下一個 frame 再確認一次：頁面底部內距（隨固定行動列高度更新）若在捲動期間才變大，
 * 第一次捲動可能被頁面高度限制而差幾個像素，此時直接補捲到位（不再播放動畫，避免二段動效）。
 */
export function revealLatest(top: Element, bottom: Element, options: { reducedMotion: boolean }): void {
  scrollWindowBy(revealDelta(top, bottom), options.reducedMotion, () => {
    requestAnimationFrame(() => {
      if (!top.isConnected || !bottom.isConnected) return
      const rest = revealDelta(top, bottom)
      if (Math.abs(rest) >= 1) scrollWindowBy(rest, true)
    })
  })
}
