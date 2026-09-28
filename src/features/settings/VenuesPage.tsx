import { Page } from '../../components/Page'
import { Placeholder } from '../../components/Placeholder'
import { strings } from '../../strings'

// 場地管理（8.1，P5 實作）
export function VenuesPage() {
  return (
    <Page title={strings.pages.venues} backTo="/settings">
      <Placeholder phase="P5" />
    </Page>
  )
}
