import { useCallback, useEffect, useState } from 'react'
import { Page } from '../../components/Page'
import { secondaryButtonClass } from '../../components/controlStyles'
import { InUseError, type MoveDirection } from '../../db'
import type { Venue } from '../../domain'
import { useAppData } from '../../lib/appData'
import { showGlobalToast } from '../../lib/globalToast'
import { strings } from '../../strings'
import { AddVenueSheet } from '../record/AddVenueSheet'
import { refreshSessions } from '../sessions/sessionsStore'
import { DangerConfirmSheet, ManageActionSheet, ManageList, type ManageAction, type ManageItem } from './ManageList'
import { AddButton, ERROR_TOAST_MS } from './manageShared'

const t = strings.manage

type Row = ManageItem & { venue: Venue }
type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; rows: Row[] }
type Sheet = { kind: 'add' } | { kind: 'actions'; row: Row } | { kind: 'rename'; row: Row } | { kind: 'delete'; row: Row }

// 場地管理（8.1）：新增、改名、上移 / 下移、封存 / 取消封存；使用場次數為 0 時才可刪除
export function VenuesPage() {
  const { repos } = useAppData()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [busy, setBusy] = useState(false)

  const fetchRows = useCallback(async (): Promise<Row[]> => {
    const venues = await repos.venues.list()
    const usage = await Promise.all(venues.map((v) => repos.venues.usageCount(v.id)))
    return venues.map((venue, i) => ({
      id: venue.id,
      label: venue.name,
      archived: venue.archived,
      usage: usage[i] ?? 0,
      venue,
    }))
  }, [repos])
  // 讀取失敗時：已有資料則保留，否則顯示錯誤狀態
  const applyRows = useCallback(
    (p: Promise<Row[]>) =>
      p.then(
        (rows) => setState({ status: 'ready', rows }),
        () => setState((s) => (s.status === 'ready' ? s : { status: 'error' })),
      ),
    [],
  )
  const load = useCallback(() => applyRows(fetchRows()), [applyRows, fetchRows])

  useEffect(() => {
    void applyRows(fetchRows())
  }, [applyRows, fetchRows])

  /** 執行一個變更：完成後重新讀取列表，並更新紀錄列表 / 報表的快取（名稱、封存狀態） */
  const run = async (op: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await op()
    } catch (err) {
      showGlobalToast({
        text: err instanceof InUseError ? t.inUseError : strings.settings.actionFailed,
        durationMs: ERROR_TOAST_MS,
      })
    } finally {
      await load()
      void refreshSessions(repos)
      setBusy(false)
    }
  }

  const move = (item: ManageItem, direction: MoveDirection) => void run(() => repos.venues.move(item.id, direction))

  const actionsFor = (row: Row): ManageAction[] => {
    const list: ManageAction[] = [{ key: 'rename', label: t.rename, onPress: () => setSheet({ kind: 'rename', row }) }]
    list.push(
      row.archived
        ? {
            key: 'unarchive',
            label: t.unarchive,
            onPress: () => {
              setSheet(null)
              void run(() => repos.venues.unarchive(row.id))
            },
          }
        : {
            key: 'archive',
            label: t.archive,
            onPress: () => {
              setSheet(null)
              void run(() => repos.venues.archive(row.id))
            },
          },
    )
    // 3.6：被參照的場地不提供刪除（不顯示）
    if (row.usage === 0) {
      list.push({ key: 'delete', label: t.delete, danger: true, onPress: () => setSheet({ kind: 'delete', row }) })
    }
    return list
  }

  const actionRow = sheet?.kind === 'actions' ? sheet.row : null
  const hint = actionRow
    ? actionRow.usage > 0
      ? t.inUseHint(actionRow.usage)
      : actionRow.archived
        ? t.archivedHint
        : null
    : null

  let body
  if (state.status === 'loading') {
    body = (
      <p role="status" className="py-10 text-center text-(--color-text-muted)">
        {strings.common.loading}
      </p>
    )
  } else if (state.status === 'error') {
    body = (
      <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
        <p>{strings.common.loadFailed}</p>
        <button
          type="button"
          onClick={() => {
            setState({ status: 'loading' })
            void load()
          }}
          className={secondaryButtonClass}
        >
          {strings.common.retry}
        </button>
      </div>
    )
  } else {
    body = (
      <ManageList
        items={state.rows}
        busy={busy}
        emptyText={t.venues.empty}
        onAdd={() => setSheet({ kind: 'add' })}
        onMove={move}
        onMore={(item) => setSheet({ kind: 'actions', row: item as Row })}
      />
    )
  }

  const deleteRow = sheet?.kind === 'delete' ? sheet.row : null
  const renameRow = sheet?.kind === 'rename' ? sheet.row : null

  return (
    <Page
      title={strings.pages.venues}
      backTo="/settings"
      action={state.status === 'ready' && state.rows.length > 0 ? <AddButton onClick={() => setSheet({ kind: 'add' })} /> : null}
    >
      {body}
      <AddVenueSheet
        open={sheet?.kind === 'add' || renameRow !== null}
        venue={renameRow?.venue}
        onClose={() => setSheet(null)}
        onCreated={() => {
          setSheet(null)
          void load()
          void refreshSessions(repos)
        }}
      />
      <ManageActionSheet
        item={actionRow}
        hint={hint}
        actions={actionRow ? actionsFor(actionRow) : []}
        onClose={() => setSheet(null)}
      />
      <DangerConfirmSheet
        open={deleteRow !== null}
        title={deleteRow ? t.venues.deleteTitle(deleteRow.label) : ''}
        confirmLabel={t.delete}
        busy={busy}
        onClose={() => setSheet(null)}
        onConfirm={() => {
          if (!deleteRow) return
          setSheet(null)
          void run(() => repos.venues.delete(deleteRow.id))
        }}
      />
    </Page>
  )
}
