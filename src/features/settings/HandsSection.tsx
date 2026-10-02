import { ChevronRight } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { FieldError } from '../../components/FieldError'
import { inputClass, secondaryButtonClass } from '../../components/controlStyles'
import { heroNameIssue, type HeroNameIssue } from '../../domain/hands'
import { describedBy } from '../../lib/aria'
import { useAppData } from '../../lib/appData'
import { showGlobalToast } from '../../lib/globalToast'
import { strings } from '../../strings'
import { HAND_IMPORT_PATH } from '../hands/handPaths'
import { ERROR_TOAST_MS, SUCCESS_TOAST_MS } from './manageShared'
import { SettingsSection, cardClass } from './SettingsSection'

const t = strings.settings

function issueText(issue: HeroNameIssue | null): string | undefined {
  if (issue === 'invalid') return t.heroNameInvalid
  if (issue === 'reserved') return t.heroNameReserved
  return undefined
}

// SPEC-v2-hands 10.6、7.3：設定頁「手牌」區塊（顯示設定之後、資料備份之前）。
// 匯出名稱存入 Settings.handHeroName（未設定時視為 Hero），儲存後即時生效於之後的匯出。
// 驗證時機同 v1 5.4：按「儲存」時檢查；已顯示錯誤後修改即時重新檢查。
// 「匯入 GG 手牌（實驗功能）」入口（5.1、10.6）→ #/hands/import（8.2）。
export function HandsSection({ initial }: { initial: string }) {
  const { repos } = useAppData()
  const [name, setName] = useState(initial)
  const [showError, setShowError] = useState(false)
  const [saving, setSaving] = useState(false)
  const error = showError ? issueText(heroNameIssue(name)) : undefined

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (heroNameIssue(name) !== null) {
      setShowError(true)
      return
    }
    setSaving(true)
    try {
      await repos.settings.set('handHeroName', name)
      setShowError(false)
      showGlobalToast({ text: t.heroNameSaved, durationMs: SUCCESS_TOAST_MS })
    } catch {
      showGlobalToast({ text: t.actionFailed, durationMs: ERROR_TOAST_MS })
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsSection id="settings-hands" title={t.handsSection}>
      <form noValidate onSubmit={(e) => void save(e)} className={`${cardClass} px-4 py-3`}>
        <label htmlFor="settings-hero-name" className="mb-1 block font-semibold">
          {t.heroName}
        </label>
        <div className="flex gap-2">
          <input
            id="settings-hero-name"
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy('settings-hero-name-hint', error && 'settings-hero-name-error')}
            className={`${inputClass} flex-1`}
          />
          <button type="submit" disabled={saving} className={`${secondaryButtonClass} shrink-0`}>
            {t.heroNameSave}
          </button>
        </div>
        <FieldError id="settings-hero-name-error" message={error} />
        <p id="settings-hero-name-hint" className="mt-2 text-sm text-(--color-text-muted)">
          {t.heroNameHint}
        </p>
      </form>
      <Link to={HAND_IMPORT_PATH} className={`mt-3 flex min-h-12 items-center gap-2 px-4 ${cardClass}`}>
        <span className="flex-1">{strings.hands.ggImport.settingsEntry}</span>
        <ChevronRight aria-hidden="true" size={20} className="text-(--color-text-muted)" />
      </Link>
    </SettingsSection>
  )
}
