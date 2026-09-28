import { useParams } from 'react-router'
import { Page } from '../../components/Page'
import { Placeholder } from '../../components/Placeholder'
import { strings } from '../../strings'

// 編輯場次（5.7，P3 實作）；返回上一層為該場次詳情
export function SessionEditPage() {
  const { id = '' } = useParams()
  return (
    <Page title={strings.pages.sessionEdit} backTo={`/sessions/${encodeURIComponent(id)}`}>
      <Placeholder phase="P3" />
    </Page>
  )
}
