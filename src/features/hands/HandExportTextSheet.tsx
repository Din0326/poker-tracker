import { useState } from 'react'
import { BottomSheet } from '../../components/BottomSheet'
import { primaryButtonClass, secondaryButtonClass } from '../../components/controlStyles'
import { strings } from '../../strings'

const t = strings.hands.export

/**
 * SPEC-v2-hands 6.2「查看匯出文字」：bottom sheet 顯示這手的 PokerStars 文字（等寬字型、可捲動、「複製」按鈕）。
 * 文字由呼叫端以 domain/hands/export 產生，內容與匯出檔相同。
 */
export function HandExportTextSheet({ text, onClose }: { text: string; onClose: () => void }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  // 在 click 的同步路徑中呼叫 clipboard（iOS 需要使用者手勢）
  const copy = () => {
    let job: Promise<void>
    try {
      job = navigator.clipboard.writeText(text)
    } catch {
      setCopyState('failed')
      return
    }
    job.then(
      () => setCopyState('copied'),
      () => setCopyState('failed'),
    )
  }

  return (
    <BottomSheet open title={t.textTitle} onClose={onClose}>
      <pre
        data-testid="export-text"
        tabIndex={0}
        aria-label={t.textLabel}
        className="max-h-[50dvh] overflow-auto rounded-(--radius-control) border border-(--color-border) bg-(--color-surface-raised) p-3 font-mono text-xs leading-5 whitespace-pre text-(--color-text)"
      >
        {text}
      </pre>
      <p role="status" data-testid="export-copy-status" className={`mt-2 min-h-5 text-sm ${copyState === 'failed' ? 'text-(--color-danger)' : 'text-(--color-text-muted)'}`}>
        {copyState === 'copied' ? t.copied : copyState === 'failed' ? t.copyFailed : ''}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <button type="button" onClick={onClose} className={secondaryButtonClass}>
          {strings.common.close}
        </button>
        <button type="button" onClick={copy} className={primaryButtonClass}>
          {t.copy}
        </button>
      </div>
    </BottomSheet>
  )
}
