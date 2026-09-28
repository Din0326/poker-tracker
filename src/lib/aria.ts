// 無障礙屬性小工具

/** 組合 aria-describedby：略過空值，全部為空時回傳 undefined */
export function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const list = ids.filter((id): id is string => typeof id === 'string' && id !== '')
  return list.length > 0 ? list.join(' ') : undefined
}
