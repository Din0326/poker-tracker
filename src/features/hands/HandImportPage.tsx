import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router'
import { Page } from '../../components/Page'
import { primaryButtonClass, secondaryButtonClass } from '../../components/controlStyles'
import { GG_REJECT_SAMPLE_LIMIT, buildGgImportPreview, parsedSourceHandIds, type GgImportPreview, type GgRejectGroup } from '../../domain/hands'
import { useAppData } from '../../lib/appData'
import { showGlobalToast } from '../../lib/globalToast'
import { useGoBack } from '../../lib/useGoBack'
import { strings } from '../../strings'
import { SessionField, type SessionChoice } from './SessionField'
import { countText } from './handExportModel'
import { GG_FILE_ACCEPT, parseImportTexts, readImportFiles, toGgHandInput, type ReadFilesError } from './ggImportModel'
import { ggReasonGroupText, ggReasonText, ggSampleWho } from './ggImportText'
import { handsWriterFor } from './ggImportWriter'
import { HANDS_PATH } from './handPaths'
import { showGgHandsInList } from './handsListMemory'
import { invalidateHands } from './handsStore'
import { loadHandFormData } from './loadHandFormData'

const t = strings.hands.ggImport
const SUCCESS_TOAST_MS = 3000
const cardClass = 'rounded-(--radius-card) border border-(--color-border) bg-(--color-surface)'
const badgeClass = 'shrink-0 rounded-full border border-(--color-border) px-2 text-xs leading-5 text-(--color-text-muted)'

type Phase =
  | { kind: 'idle'; cancelled: boolean }
  | { kind: 'reading' }
  | { kind: 'parsing'; done: number; total: number }
  | { kind: 'error'; error: ReadFilesError }
  | { kind: 'preview'; preview: GgImportPreview; writing: boolean; failed: boolean }

/** 8.5 原因分組：「不支援 Run It Twice：12 手」，可展開看前 20 筆明細（原站手牌編號或「第 3 個檔案第 18 手」與原因） */
function RejectGroup({ group }: { group: GgRejectGroup }) {
  return (
    <li data-testid="import-reject-group" className="px-4 py-3">
      <p data-testid="import-reject-reason" className="num">
        {t.groupLine(ggReasonGroupText(group.reason), countText(group.count))}
      </p>
      <details className="group mt-1">
        <summary className="flex min-h-(--touch-min) cursor-pointer list-none items-center gap-1 text-sm font-semibold text-(--color-accent) [&::-webkit-details-marker]:hidden">
          <ChevronDown aria-hidden="true" size={16} className="transition-transform group-open:rotate-180" />
          {t.showSamples(countText(Math.min(group.count, GG_REJECT_SAMPLE_LIMIT)))}
        </summary>
        <ul className="num mt-1 space-y-1 text-sm text-(--color-text-muted)">
          {group.samples.map((s, i) => (
            <li key={i} data-testid="import-reject-sample" className="break-words">
              {t.sampleLine(ggSampleWho(s), ggReasonText(s.reason))}
            </li>
          ))}
        </ul>
      </details>
    </li>
  )
}

// SPEC-v2-hands 8.2 匯入 GG 手牌（實驗功能）。#/hands/import，「手牌」頁籤的推入式子頁（5.1）。
// 流程：選擇檔案 → 讀取（zip 解壓）→ 分批解析（進度、可取消，取消後不寫入）→ 預覽（可匯入 / 重複 / 無法匯入、
// 原因分組、關聯場次只列現金桌）→ 單一 transaction 寫入（任何錯誤整批還原）→ 前往手牌列表（篩選來源 = GG）。
export function HandImportPage() {
  const { db, repos } = useAppData()
  const navigate = useNavigate()
  const goBack = useGoBack(HANDS_PATH)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle', cancelled: false })
  const [sessions, setSessions] = useState<readonly SessionChoice[]>([])
  const [sessionId, setSessionId] = useState('')

  // 8.2「關聯場次」選單的資料（SessionField 依 gameType cash 只列現金桌場次，3.11、HQ20）
  useEffect(() => {
    let cancelled = false
    loadHandFormData(repos).then(
      (loaded) => !cancelled && setSessions(loaded.data.sessions),
      () => undefined,
    )
    return () => {
      cancelled = true
    }
  }, [repos])

  // 離開頁面時中止進行中的解析
  useEffect(() => () => abortRef.current?.abort(), [])

  const start = async (files: File[]) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setPhase({ kind: 'reading' })
    const read = await readImportFiles(files)
    if (controller.signal.aborted) return
    if (!read.ok) {
      setPhase({ kind: 'error', error: read.error })
      return
    }
    const items = await parseImportTexts(read.texts, {
      signal: controller.signal,
      onProgress: (p) => !controller.signal.aborted && setPhase({ kind: 'parsing', done: p.done, total: p.total }),
    })
    if (items === null || controller.signal.aborted) return
    let existing: Set<string>
    try {
      existing = await repos.hands.existingSourceHandIds(parsedSourceHandIds(items))
    } catch {
      setPhase({ kind: 'error', error: 'readFailed' })
      return
    }
    if (controller.signal.aborted) return
    setPhase({ kind: 'preview', preview: buildGgImportPreview(items, existing), writing: false, failed: false })
  }

  const onFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    // 清空，讓同一個檔案可以再選一次（HC21 重複匯入）
    e.target.value = ''
    if (files.length > 0) void start(files)
  }

  const cancel = () => {
    abortRef.current?.abort()
    setPhase({ kind: 'idle', cancelled: true })
  }

  const chooseFiles = () => inputRef.current?.click()

  const write = async (preview: GgImportPreview) => {
    setPhase({ kind: 'preview', preview, writing: true, failed: false })
    const link = sessionId === '' ? null : sessionId
    try {
      const written = await handsWriterFor(db, repos)(preview.importable.map((h) => toGgHandInput(h, link)))
      invalidateHands()
      showGgHandsInList()
      showGlobalToast({ text: t.done(countText(written)), durationMs: SUCCESS_TOAST_MS })
      void navigate(HANDS_PATH, { replace: true })
    } catch {
      setPhase({ kind: 'preview', preview, writing: false, failed: true })
    }
  }

  const fileInput = (
    <input ref={inputRef} type="file" accept={GG_FILE_ACCEPT} multiple onChange={onFiles} className="hidden" data-testid="import-file-input" tabIndex={-1} aria-hidden="true" />
  )
  const chooseButton = (label: string, primary: boolean) => (
    <button type="button" onClick={chooseFiles} className={`${primary ? primaryButtonClass : secondaryButtonClass} w-full`}>
      {label}
    </button>
  )

  let body
  switch (phase.kind) {
    case 'idle':
      body = (
        <div className="mt-4 flex flex-col gap-3">
          {chooseButton(t.chooseFiles, true)}
          <p className="text-center text-sm text-(--color-text-muted)">{t.fileHint}</p>
          {phase.cancelled && (
            <p role="status" data-testid="import-status" className="text-center">
              {t.cancelled}
            </p>
          )}
        </div>
      )
      break
    case 'reading':
      body = (
        <p role="status" data-testid="import-status" className="py-10 text-center text-(--color-text-muted)">
          {t.reading}
        </p>
      )
      break
    case 'parsing': {
      const text = t.parsing(countText(phase.done), countText(phase.total))
      body = (
        <div className="mt-6 flex flex-col gap-4">
          <p role="status" data-testid="import-progress" className="num text-center">
            {text}
          </p>
          <div
            role="progressbar"
            aria-label={t.progressLabel}
            aria-valuemin={0}
            aria-valuemax={phase.total}
            aria-valuenow={phase.done}
            aria-valuetext={text}
            className="h-2 overflow-hidden rounded-full bg-(--color-surface-raised)"
          >
            <div className="h-full bg-(--color-accent)" style={{ width: `${phase.total === 0 ? 0 : (phase.done / phase.total) * 100}%` }} />
          </div>
          <button type="button" onClick={cancel} className={`${secondaryButtonClass} w-full`}>
            {t.cancel}
          </button>
        </div>
      )
      break
    }
    case 'error':
      body = (
        <div className="mt-4 flex flex-col gap-4">
          <p role="alert" data-testid="import-error" className={`px-4 py-3 text-(--color-danger) ${cardClass}`}>
            {t.errors[phase.error]}
          </p>
          {chooseButton(t.chooseAgain, true)}
        </div>
      )
      break
    case 'preview': {
      const { preview, writing, failed } = phase
      const n = preview.importable.length
      body = (
        <div className="mt-4 flex flex-col gap-4">
          <p data-testid="import-summary" className={`num px-4 py-3 font-semibold ${cardClass}`}>
            {t.previewSummary(countText(n), countText(preview.duplicates), countText(preview.rejected))}
          </p>
          {preview.groups.length > 0 && (
            <section aria-labelledby="import-rejected-title">
              <h2 id="import-rejected-title" className="px-1 pb-2 text-sm text-(--color-text-muted)">
                {t.rejectedTitle}
              </h2>
              <ul className={`divide-y divide-(--color-border) ${cardClass}`}>
                {preview.groups.map((g) => (
                  <RejectGroup key={g.key} group={g} />
                ))}
              </ul>
            </section>
          )}
          {n > 0 && (
            <div>
              <SessionField id="import-session" value={sessionId} gameType="cash" sessions={sessions} onChange={setSessionId} error={undefined} disabled={writing} />
              <p className="mt-1 text-sm text-(--color-text-muted)">{t.sessionHint}</p>
            </div>
          )}
          {failed && (
            <p role="alert" data-testid="import-error" className="text-(--color-danger)">
              {t.failed}
            </p>
          )}
          {n > 0 ? (
            <button type="button" disabled={writing} onClick={() => void write(preview)} className={`${primaryButtonClass} w-full`}>
              {writing ? t.importing : t.importButton(countText(n))}
            </button>
          ) : (
            <button type="button" onClick={goBack} className={`${secondaryButtonClass} w-full`}>
              {t.back}
            </button>
          )}
          {!writing && chooseButton(t.chooseAgain, false)}
        </div>
      )
      break
    }
  }

  return (
    <Page
      title={strings.pages.handImport}
      backTo={HANDS_PATH}
      badge={
        <span data-testid="experimental-badge" className={badgeClass}>
          {t.experimental}
        </span>
      }
    >
      <p data-testid="import-intro" className="mt-2 text-sm text-(--color-text-muted)">
        {t.intro}
      </p>
      {fileInput}
      {body}
    </Page>
  )
}
