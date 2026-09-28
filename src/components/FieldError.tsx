// 欄位下方的錯誤訊息（9.4）；id 供欄位的 aria-describedby 關聯
export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null
  return (
    <p id={id} className="mt-1 text-sm text-(--color-danger)">
      {message}
    </p>
  )
}
