import { chromium } from 'playwright-extra'
import stealth from 'puppeteer-extra-plugin-stealth'
import { startWorkers } from './workers/worker.js'
import { queue, orchestrateSearch } from './core/orchestrator.js'
import { startServer } from './server/httpServer.js'
import { error } from './core/logger.js'

chromium.use(stealth())

const PORT = Number(process.env.PORT || 3000)
const NUMBER_OF_WORKERS = Math.max(1, Number(process.env.NUMBER_OF_WORKERS || 2))
const CACHE_WARM_INTERVAL_MS = 60 * 60 * 1000

startWorkers(NUMBER_OF_WORKERS, queue)
startServer(PORT)

const runWarmup = async () => {
  try {
    await orchestrateSearch("cache warmup", true)
  } catch (e) {
    error('cache_warmup_error', { error: (e as any)?.message || e })
  }
}
runWarmup()
setInterval(runWarmup, CACHE_WARM_INTERVAL_MS)

process.on('unhandledRejection', err => {
  // error('unhandledRejection', err)
})
process.on('uncaughtException', err => {
  // error('uncaughtException', err)
})

