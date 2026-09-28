import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize } from 'node:path'

// 離線測試用的一次性靜態伺服器：提供 dist/，測試中途關掉即可模擬「完全連不到伺服器」。
// WebKit 的 context.setOffline() 會連 service worker 的回應一起擋掉，無法用來驗證離線可用。
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
}

export type StaticServer = { url: string; close: () => Promise<void> }

export async function startStaticServer(root = 'dist'): Promise<StaticServer> {
  const server: Server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    const file = join(root, normalize(pathname === '/' ? '/index.html' : pathname))
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': contentTypes[extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
