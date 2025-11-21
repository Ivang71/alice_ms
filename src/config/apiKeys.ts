import fs from 'fs'
import path from 'path'

let cachedMtime = 0
let cachedKeys = new Set<string>()

function loadKeys(): Set<string> {
  const file = path.join(process.cwd(), 'api_keys.json')
  try {
    const stat = fs.statSync(file)
    if (stat.mtimeMs !== cachedMtime || !cachedKeys.size) {
      const raw = fs.readFileSync(file, 'utf8')
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return new Set()
      cachedKeys = new Set(parsed.filter(k => typeof k === 'string' && k.trim().length > 0))
      cachedMtime = stat.mtimeMs
    }
    return cachedKeys
  } catch {
    return new Set()
  }
}

export function isValidApiKey(key: string | undefined | null): boolean {
  if (!key) return false
  const keys = loadKeys()
  if (!keys.size) return false
  return keys.has(key)
}


