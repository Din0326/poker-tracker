import { Page } from '../../components/Page'
import { Placeholder } from '../../components/Placeholder'
import { strings } from '../../strings'

// 場次詳情（7.2，P3 實作）
export function SessionDetailPage() {
  return (
    <Page title={strings.pages.sessionDetail} backTo="/sessions">
      <Placeholder phase="P3" />
    </Page>
  )
}
