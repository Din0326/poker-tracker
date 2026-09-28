import { Page } from '../../components/Page'
import { Placeholder } from '../../components/Placeholder'
import { strings } from '../../strings'

// 報表（第 6 節，P4 實作）
export function ReportPage() {
  return (
    <Page title={strings.pages.report}>
      <Placeholder phase="P4" />
    </Page>
  )
}
