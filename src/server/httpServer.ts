import { createServer } from 'http'
import fs from 'fs'
import { URL } from 'url'
import { debug, error, info, isDebug } from '../core/logger.js'
import { orchestrateSearch } from '../core/orchestrator.js'
import { stats } from '../core/stats.js'
import { isValidApiKey } from '../config/apiKeys.js'

export function startServer(port: number) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '', `http://${req.headers.host}`)
      const apiKeyHeader = (req.headers['x-api-key'] as string | undefined) || undefined
      const apiKeyQuery = url.searchParams.get('api_key') || undefined
      const apiKey = apiKeyHeader || apiKeyQuery
      if (!isValidApiKey(apiKey)) {
        debug('auth_failed', { ip: req.socket.remoteAddress, keyPresent: !!apiKey })
        res.statusCode = 401
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'unauthorized' }))
        return
      }
      if (req.method !== 'GET' || url.pathname !== '/search') {
        debug('request_unhandled', { method: req.method, url: req.url })
        res.statusCode = 404
        res.end()
        return
      }
      const q = (url.searchParams.get('q') || '').trim()
      const getAiAnswerParam = url.searchParams.get('getAiAnswer')
      const getAiAnswer = getAiAnswerParam == null ? true : !/^(0|false)$/i.test(getAiAnswerParam)
      if (!q) {
        debug('request_missing_q', { rawQ: url.searchParams.get('q') })
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'missing q' }))
        return
      }
      debug('request_received', { q, getAiAnswer })
      try {
        const result = await orchestrateSearch(q, getAiAnswer)
        const len = result ? result.length : 0
        debug('request_respond', { textLen: len })
        if (len === 0) debug('request_respond_empty', { q, getAiAnswer })
        stats.success++
        if (isDebug) {
          try { await fs.promises.writeFile('last.json', JSON.stringify(result, null, '\t')) } catch (e) { error('last_write_error', (e as any)?.message || e) }
        }
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end(result)
      } catch (e) {
        stats.failure++
        error('request_error', { error: (e as any)?.stack || (e as any)?.message || e })
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'internal' }))
      }
    } catch (e) {
      error('request_error', { error: (e as any)?.stack || (e as any)?.message || e })
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'internal' }))
    }
  })
  server.listen(port)
  info('server_listening', { port })
}


