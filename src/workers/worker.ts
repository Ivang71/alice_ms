import { chromium } from 'playwright-extra'
import type { Route } from 'playwright'
import { chromeArgs } from '../config/chromeArgs.js'
import { getProxy } from '../config/proxy.js'
import { COUNTRY_TO_LOCALE, pickRandomCountry } from '../config/countries.js'
import { debug, error } from '../core/logger.js'
import { searchAlice, searchAliceWithContext } from '../execution/alice.js'
import type { TaskQueue } from '../core/taskQueue.js'

const IDLE_RELOAD_MS = 45 * 60 * 1000

export class BrowserWorker {
  private browser: any | null = null
  private idleContext: any | null = null
  private idlePage: any | null = null
  private idleReloadTimeout: NodeJS.Timeout | null = null
  private lastTaskAt = Date.now()
  private country!: string
  private locale!: string
  private acceptLanguage!: string
  constructor(private queue: TaskQueue<any>, private id: number) {
    this.updateRegion()
  }
  private updateRegion() {
    this.country = pickRandomCountry()
    this.locale = COUNTRY_TO_LOCALE[this.country]
    const lang = this.locale.split('-')[0]
    this.acceptLanguage = `${this.locale},${lang};q=0.9`
  }
  async start() {
    await this.launch()
    for (;;) {
      const task = await this.queue.next()
      try {
        this.lastTaskAt = Date.now()
        this.clearIdleReload()
        if (!this.browser) await this.launch()
        debug('worker_search_start', { worker: this.id, country: this.country, q: task.value.query })
        const text = await this.performSearch(task.value.query, task.value.timeoutMs, task.value.signal, task.value.getAiAnswer)
        task.resolve(text)
      } catch (err) {
        task.reject(err)
      } finally {
        try {
          await this.resetBrowser()
        } catch (e) {
          error('worker_reset_error', { worker: this.id, error: (e as any)?.message || e })
        }
      }
    }
  }
  private async performSearch(query: string, timeoutMs: number, signal: AbortSignal | undefined, getAiAnswer: boolean): Promise<string> {
    try {
      if (this.idleContext && this.idlePage) {
        try {
          await this.idleContext.unroute('**/*')
        } catch {}
        const ctx = this.idleContext
        const pg = this.idlePage
        this.idleContext = null
        this.idlePage = null
        const text = await searchAliceWithContext(ctx, pg, this.locale, this.acceptLanguage, query, timeoutMs, signal, getAiAnswer)
        debug('worker_search_ok', { worker: this.id, length: text.length })
        return text
      } else {
        const text = await searchAlice(this.browser, this.locale, this.acceptLanguage, query, timeoutMs, signal, getAiAnswer)
        debug('worker_search_ok', { worker: this.id, length: text.length })
        return text
      }
    } catch (err) {
      if ((err as any)?.message === 'aborted') throw err
      error('worker_search_error_relaunch', { worker: this.id })
      await this.relaunch()
      try {
        const text = await searchAlice(this.browser, this.locale, this.acceptLanguage, query, timeoutMs, signal, getAiAnswer)
        debug('worker_search_ok_after_relaunch', { worker: this.id, length: text.length })
        return text
      } catch (e) {
        if ((e as any)?.message === 'aborted') throw e
        error('worker_search_error_fail', { worker: this.id, error: (e as any)?.message || e })
        throw e
      }
    }
  }
  private async launch() {
    const options: Parameters<typeof chromium.launch>[0] = { headless: process.env.HEADLESS !== '0', devtools: true, args: chromeArgs(), proxy: getProxy(this.country) }
    debug('worker_launch', { worker: this.id, country: this.country })
    this.browser = await chromium.launch(options)
    await this.prepareIdle()
  }
  private async relaunch() {
    await this.closeBrowser()
    this.updateRegion()
    debug('worker_relaunch', { worker: this.id, country: this.country })
    await this.launch()
  }
  private async prepareIdle() {
    if (!this.browser) return
    try {
      if (this.idleContext) {
        try { await this.idleContext.close() } catch {}
        this.idleContext = null
        this.idlePage = null
      }
      const context = await this.browser.newContext({
        ignoreHTTPSErrors: true,
        locale: this.locale,
        extraHTTPHeaders: { 'Accept-Language': this.acceptLanguage }
      })
      const page = await context.newPage()
      await page.goto('https://alice.yandex.ru/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(2000).catch(() => {})
      await context.route('**/*', (route: Route) => route.abort())
      this.idleContext = context
      this.idlePage = page
      this.scheduleIdleReload()
    } catch (e) {
      error('worker_idle_prepare_error', { worker: this.id, error: (e as any)?.message || e })
    }
  }
  private async resetBrowser() {
    if (!this.browser) return
    await this.closeBrowser()
    await this.launch()
  }
  private async closeBrowser() {
    this.clearIdleReload()
    if (this.idleContext) {
      try { await this.idleContext.close() } catch {}
      this.idleContext = null
      this.idlePage = null
    }
    if (!this.browser) return
    try {
      await this.browser.close()
    } catch {}
    this.browser = null
  }
  private scheduleIdleReload() {
    if (!this.browser) return
    if (this.idleReloadTimeout) clearTimeout(this.idleReloadTimeout)
    this.idleReloadTimeout = setTimeout(async () => {
      const now = Date.now()
      if (!this.browser || !this.idleContext || !this.idlePage) return
      if (now - this.lastTaskAt < IDLE_RELOAD_MS) {
        this.scheduleIdleReload()
        return
      }
      try {
        await this.idleContext.unroute('**/*').catch(() => {})
        await this.idlePage.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
        await this.idlePage.waitForTimeout(2000).catch(() => {})
        await this.idleContext.route('**/*', (route: Route) => route.abort())
      } catch (e) {
        error('worker_idle_reload_error', { worker: this.id, error: (e as any)?.message || e })
      }
      this.scheduleIdleReload()
    }, IDLE_RELOAD_MS)
  }
  private clearIdleReload() {
    if (this.idleReloadTimeout) {
      clearTimeout(this.idleReloadTimeout)
      this.idleReloadTimeout = null
    }
  }
}

export function startWorkers<T>(n: number, queue: TaskQueue<T>) {
  for (let i = 0; i < n; i++) {
    const w = new BrowserWorker(queue as unknown as TaskQueue<any>, i)
    w.start().catch(() => {})
  }
}


