// 元件測試共用設定：IndexedDB 以 fake-indexeddb 模擬；每個測試後卸載元件
import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
