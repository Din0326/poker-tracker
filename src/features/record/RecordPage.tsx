import { InstallBanner } from '../../components/InstallBanner'
import { Page } from '../../components/Page'
import { Placeholder } from '../../components/Placeholder'
import { strings } from '../../strings'

// 新增場次（第 5 節，P2 實作）
export function RecordPage() {
  return (
    <Page title={strings.pages.record}>
      <InstallBanner />
      <Placeholder phase="P2" />
    </Page>
  )
}
