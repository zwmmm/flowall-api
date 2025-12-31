import * as cheerio from 'https://esm.sh/cheerio@1.0.0-rc.12'
import { supabase } from '../../main.ts'
import type { MoewallsRawData, Wallpaper } from '../types/wallpaper.ts'

export class CrawlerService {
  private readonly AI_API_KEYS: string[] = [] // Gemini API Keys 数组
  private readonly AI_BASE_URL: string // Gemini API 基础 URL (支持代理)
  private readonly AI_MODEL: string // 使用的模型名称
  private currentKeyIndex = 0 // 当前使用的 key 索引
  private readonly REQUEST_DELAY = 2000 // 请求间隔 2s
  private readonly MOBILE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'

  // 队列配置
  private readonly CONSUMER_COUNT = 3 // 并发消费者数量
  private readonly BATCH_INSERT_SIZE = 10 // 批量插入大小

  // 终止信号
  private abortController: AbortController | null = null
  private isRunning = false

  // AI 请求限速 (1秒/请求)
  private lastAiRequestTime = 0
  private readonly AI_REQUEST_INTERVAL = 1000 // 1秒

  // API Key 熔断机制
  private readonly keyCircuitBreaker = new Map<string, number>() // key -> 熔断解除时间戳
  private readonly CIRCUIT_BREAK_DURATION = 60 * 1000 // 熔断时长: 1分钟

  constructor() {
    // 从环境变量读取多个 Gemini API Keys (逗号分隔)
    const keysEnv = Deno.env.get('GEMINI_API_KEYS')
    if (keysEnv) {
      this.AI_API_KEYS = keysEnv.split(',').map((k) => k.trim()).filter((k) => k.length > 0)
      console.log(`🔑 加载了 ${this.AI_API_KEYS.length} 个 Gemini API Keys`)
    }

    // 读取 Gemini API 配置 (支持代理)
    this.AI_BASE_URL = Deno.env.get('GEMINI_BASE_URL') ||
      'https://generativelanguage.googleapis.com/v1'
    this.AI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-1.5-flash'
    console.log(`🤖 AI 配置: ${this.AI_BASE_URL} | 模型: ${this.AI_MODEL}`)
  }

  /**
   * 轮询获取下一个可用的 API Key (跳过熔断中的 Key)
   */
  private getNextApiKey(): string | null {
    if (this.AI_API_KEYS.length === 0) return null

    const now = Date.now()
    let attempts = 0

    // 尝试找到一个未被熔断的 Key
    while (attempts < this.AI_API_KEYS.length) {
      const key = this.AI_API_KEYS[this.currentKeyIndex]
      const breakUntil = this.keyCircuitBreaker.get(key)

      // 检查熔断状态
      if (!breakUntil || now >= breakUntil) {
        // Key 可用或熔断已解除
        if (breakUntil && now >= breakUntil) {
          this.keyCircuitBreaker.delete(key) // 清除熔断记录
          console.log(`🔓 [熔断恢复] Key ${this.maskApiKey(key)} 已恢复可用`)
        }

        // 轮转到下一个 Key
        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.AI_API_KEYS.length
        return key
      }

      // 当前 Key 被熔断,尝试下一个
      this.currentKeyIndex = (this.currentKeyIndex + 1) % this.AI_API_KEYS.length
      attempts++
    }

    // 所有 Key 都被熔断
    console.error('❌ [熔断] 所有 API Keys 都已熔断')
    return null
  }

  /**
   * 触发 API Key 熔断
   */
  private circuitBreakKey(key: string): void {
    const breakUntil = Date.now() + this.CIRCUIT_BREAK_DURATION
    this.keyCircuitBreaker.set(key, breakUntil)
    console.warn(
      `🔒 [熔断] Key ${this.maskApiKey(key)} 已熔断 ${this.CIRCUIT_BREAK_DURATION / 1000} 秒`,
    )
  }

  /**
   * 脱敏显示 API Key (仅显示前6位)
   */
  private maskApiKey(key: string): string {
    return key.substring(0, 6) + '***'
  }

  /**
   * 执行爬取任务 (生产者-消费者模式)
   */
  async crawl(): Promise<{ new_count: number; updated_count: number; failed_count: number }> {
    if (this.isRunning) {
      throw new Error('已有爬取任务正在运行')
    }

    this.isRunning = true
    this.abortController = new AbortController()
    console.log('🕷️ 开始爬取 moewalls.com (生产者-消费者模式)...')

    const stats = { newCount: 0, updatedCount: 0, failedCount: 0, skippedCount: 0 }
    const urlQueue: string[] = [] // URL 队列
    let producerDone = false // 生产者是否完成
    const processedBatch: MoewallsRawData[] = [] // 待插入批次

    // 创建爬取日志记录
    const { data: logEntry, error: logError } = await supabase
      .from('crawl_logs')
      .insert({
        status: 'success',
        wallpapers_count: 0,
        new_count: 0,
        updated_count: 0,
      })
      .select('id')
      .single()

    const logId = logEntry?.id

    if (logError) {
      console.error('创建爬取日志失败:', logError)
    }

    try {
      // 🔧 生产者: 持续爬取列表页,将 URL 放入队列
      const producer = (async () => {
        let page = 1
        let emptyCount = 0 // 连续空页数

        while (emptyCount < 3) { // 连续3页为空则停止
          // 检查终止信号
          if (this.abortController?.signal.aborted) {
            console.log('🛑 [生产者] 检测到终止信号,停止爬取')
            break
          }

          try {
            console.log(`📄 [生产者] 爬取第 ${page} 页...`)
            const urls = await this.fetchListPage(page)

            if (urls.length === 0) {
              emptyCount++
              console.log(`⚠️ [生产者] 第 ${page} 页无数据 (连续空页: ${emptyCount}/3)`)
            } else {
              emptyCount = 0
              urlQueue.push(...urls)
              console.log(
                `✅ [生产者] 第 ${page} 页获取 ${urls.length} 个URL (队列: ${urlQueue.length})`,
              )
            }

            page++
            await this.delay(this.REQUEST_DELAY)
          } catch (error) {
            console.error(`❌ [生产者] 第 ${page} 页失败:`, error)
            emptyCount++
          }
        }

        producerDone = true
        console.log(
          `🏁 [生产者] 完成,共收集 ${
            urlQueue.length + stats.skippedCount + stats.newCount + stats.updatedCount
          } 个URL`,
        )
      })()

      // 🔧 消费者: 从队列取 URL,爬取详情并处理
      const createConsumer = async (id: number) => {
        while (true) {
          // 检查终止信号
          if (this.abortController?.signal.aborted) {
            console.log(`🛑 [消费者${id}] 检测到终止信号,停止工作`)
            break
          }

          // 队列为空且生产者已完成,退出
          if (urlQueue.length === 0 && producerDone) break

          // 队列为空但生产者未完成,等待
          if (urlQueue.length === 0) {
            await this.delay(500)
            continue
          }

          const url = urlQueue.shift()!

          try {
            // 1. 提取 ID
            const urlParts = url.replace(/\/$/, '').split('/')
            const moewallsId = urlParts[urlParts.length - 1]

            // 2. 查询数据库,已存在则跳过
            const { data: existing } = await supabase
              .from('wallpapers')
              .select('id')
              .eq('moewalls_id', moewallsId)
              .maybeSingle()

            if (existing) {
              stats.skippedCount++
              console.log(`⏭️ [消费者${id}] 已存在,跳过: ${moewallsId}`)
              continue
            }

            // 3. 爬取详情页
            const wallpaper = await this.fetchDetailPage(url)
            processedBatch.push(wallpaper)

            console.log(
              `✅ [消费者${id}] 爬取成功: ${wallpaper.name} (待插入: ${processedBatch.length})`,
            )

            // 4. 批量插入数据库
            if (processedBatch.length >= this.BATCH_INSERT_SIZE) {
              await this.batchInsert(processedBatch, stats)
            }

            await this.delay(this.REQUEST_DELAY)
          } catch (error) {
            stats.failedCount++
            console.error(`❌ [消费者${id}] 处理失败:`, error)
          }
        }

        console.log(`🏁 [消费者${id}] 完成`)
      }

      // 启动生产者和多个消费者
      await Promise.all([
        producer,
        ...Array.from({ length: this.CONSUMER_COUNT }, (_, i) => createConsumer(i + 1)),
      ])

      // 插入剩余数据
      if (processedBatch.length > 0) {
        await this.batchInsert(processedBatch, stats)
      }

      const statusMsg = this.abortController?.signal.aborted
        ? '\n🛑 爬取已终止'
        : '\n🎉 爬取完成'
      console.log(
        `${statusMsg}: 新增 ${stats.newCount}, 更新 ${stats.updatedCount}, 跳过 ${stats.skippedCount}, 失败 ${stats.failedCount}`,
      )

      // 更新爬取日志
      if (logId) {
        const finalStatus = this.abortController?.signal.aborted
          ? 'partial'
          : stats.failedCount > 0
          ? 'partial'
          : 'success'

        await supabase
          .from('crawl_logs')
          .update({
            status: finalStatus,
            wallpapers_count: stats.newCount + stats.updatedCount,
            new_count: stats.newCount,
            updated_count: stats.updatedCount,
            completed_at: new Date().toISOString(),
          })
          .eq('id', logId)
      }

      return {
        new_count: stats.newCount,
        updated_count: stats.updatedCount,
        failed_count: stats.failedCount,
      }
    } catch (error) {
      // 记录失败日志
      if (logId) {
        await supabase
          .from('crawl_logs')
          .update({
            status: 'failed',
            error_message: error instanceof Error ? error.message : String(error),
            completed_at: new Date().toISOString(),
          })
          .eq('id', logId)
      }
      throw error
    } finally {
      this.isRunning = false
      this.abortController = null
    }
  }

  /**
   * 终止正在运行的爬取任务
   */
  abort(): boolean {
    if (!this.isRunning || !this.abortController) {
      return false
    }

    console.log('🛑 收到终止请求,正在停止爬取任务...')
    this.abortController.abort()
    return true
  }

  /**
   * 检查是否有任务正在运行
   */
  getStatus(): { isRunning: boolean } {
    return { isRunning: this.isRunning }
  }

  /**
   * 批量插入数据到数据库
   */
  private async batchInsert(
    batch: MoewallsRawData[],
    stats: { newCount: number; updatedCount: number; failedCount: number },
  ) {
    console.log(`💾 [批量插入] 开始插入 ${batch.length} 条数据...`)

    const batchCopy = [...batch]
    batch.length = 0 // 清空原数组

    for (const raw of batchCopy) {
      try {
        const result = await this.processWallpaper(raw)
        if (result === 'new') stats.newCount++
        if (result === 'updated') stats.updatedCount++
      } catch (error) {
        stats.failedCount++
        console.error('❌ [批量插入] 处理失败:', error)
      }
    }

    console.log(
      `✅ [批量插入] 完成 (新增: ${stats.newCount}, 更新: ${stats.updatedCount}, 失败: ${stats.failedCount})`,
    )
  }

  /**
   * 爬取列表页获取详情页链接
   */
  private async fetchListPage(page: number): Promise<string[]> {
    const url = `https://moewalls.com/page/${page}/`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': this.MOBILE_UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const html = await response.text()
      const $ = cheerio.load(html)

      // 提取所有壁纸详情页链接
      const urls: string[] = []
      // 修正选择器: article 标签内的链接
      $('article.entry-tpl-grid .entry-featured-media a').each((_, el) => {
        const href = $(el).attr('href')
        if (
          href && href.includes('moewalls.com/') && !href.includes('/page/') &&
          !href.includes('/category/') && !href.includes('/resolution/')
        ) {
          urls.push(href)
        }
      })

      return urls
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('请求超时')
      }
      throw error
    }
  }

  /**
   * 爬取详情页获取壁纸数据
   */
  private async fetchDetailPage(url: string): Promise<MoewallsRawData> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': this.MOBILE_UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const html = await response.text()
      const $ = cheerio.load(html)

      // 提取壁纸 ID (从 URL 的最后一段提取)
      const urlParts = url.replace(/\/$/, '').split('/')
      const id = urlParts[urlParts.length - 1] || crypto.randomUUID()

      // 提取标题
      const name = $('h1.entry-title').text().trim() || 'Untitled'

      // 提取封面图 (从视频播放器的 poster 属性)
      let cover_url = $('video').attr('poster') || ''
      if (!cover_url) {
        // 备选方案: 从预览图获取
        cover_url = $('.entry-featured-media img').first().attr('src') || ''
      }
      // 确保 URL 是完整的
      if (cover_url && cover_url.startsWith('/')) {
        cover_url = `https://moewalls.com${cover_url}`
      }

      // 提取预览视频 (webm 格式的预览视频)
      let preview_url = $('video source[src*=".webm"]').attr('src') || ''
      if (!preview_url) {
        // 备选方案: 提取任何 source 标签
        preview_url = $('video source').first().attr('src') || ''
      }
      // 确保 URL 是完整的
      if (preview_url && preview_url.startsWith('/')) {
        preview_url = `https://moewalls.com${preview_url}`
      }

      // 提取下载链接
      const downloadBtn = $('button#moe-download')
      const dataUrl = downloadBtn.attr('data-url')
      if (!dataUrl) {
        throw new Error(`未找到下载链接: ${url}`)
      }
      const video_url = `https://go.moewalls.com/download.php?video=${dataUrl}`

      // 提取标签
      const tags: string[] = []
      $('.tag-items a, .entry-tags a').each((_, el) => {
        const tag = $(el).text().trim()
        if (tag) tags.push(tag)
      })

      return {
        id,
        name,
        cover_url,
        preview_url,
        video_url,
        tags,
      }
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('请求超时')
      }
      throw error
    }
  }

  /**
   * 处理单个壁纸
   */
  private async processWallpaper(
    raw: MoewallsRawData,
  ): Promise<'new' | 'updated' | 'skipped'> {
    // 输入验证
    if (!raw.id || !raw.preview_url || !raw.video_url) {
      throw new Error('Invalid wallpaper data: missing required fields')
    }

    // 1. 检查是否已存在
    const { data: existing } = await supabase
      .from('wallpapers')
      .select('id, description, name_zh, tags_zh')
      .eq('moewalls_id', raw.id)
      .single()

    // 2. 生成 AI 描述
    let description = existing?.description
    if (!description) {
      description = await this.generateDescriptionWithRetry(raw.name, raw.tags)
    }

    // 3. 翻译 name 和 tags (仅在不存在时翻译)
    let name_zh = existing?.name_zh
    let tags_zh = existing?.tags_zh

    if (!name_zh || !tags_zh || tags_zh.length === 0) {
      const translation = await this.translateContent(raw.name, raw.tags)
      name_zh = translation.name_zh || name_zh
      tags_zh = translation.tags_zh || tags_zh
    }

    // 4. 准备数据
    const wallpaperData: Partial<Wallpaper> = {
      moewalls_id: raw.id,
      name: raw.name,
      name_zh,
      description,
      cover_url: raw.cover_url,
      preview_url: raw.preview_url,
      video_url: raw.video_url,
      crawled_at: new Date().toISOString(),
    }

    let wallpaperId: string

    if (existing) {
      const { data, error } = await supabase
        .from('wallpapers')
        .update(wallpaperData)
        .eq('id', existing.id)
        .select('id')
        .single()

      if (error) throw new Error(`更新失败: ${error.message}`)
      wallpaperId = data.id
    } else {
      const { data, error } = await supabase
        .from('wallpapers')
        .insert(wallpaperData)
        .select('id')
        .single()

      if (error) throw new Error(`插入失败: ${error.message}`)
      wallpaperId = data.id
    }

    // 5. 处理标签 (包含中文翻译)
    await this.processTags(wallpaperId, raw.tags, tags_zh)

    return existing ? 'updated' : 'new'
  }

  /**
   * 生成描述 (带异常隔离)
   * AI 调用失败不影响主流程,自动降级为默认格式
   */
  private async generateDescriptionWithRetry(
    name: string,
    tags: string[],
  ): Promise<string> {
    // 降级策略: 未配置 AI 或调用失败时使用默认格式
    const fallbackDescription = `${name} - ${tags.join(', ')}`

    // 未配置 Gemini API Keys,直接返回默认格式
    if (this.AI_API_KEYS.length === 0) {
      return fallbackDescription
    }

    // 尝试调用 Gemini (最多2次)
    try {
      return await this.generateDescription(name, tags)
    } catch (error) {
      // AI 调用失败,记录日志但不抛出异常
      console.warn(
        `⚠️ [Gemini] 描述生成失败,使用默认格式:`,
        error instanceof Error ? error.message : error,
      )
      return fallbackDescription
    }
  }

  /**
   * 使用 Gemini AI 生成描述 (带重试、Key 轮询和熔断)
   */
  private async generateDescription(
    name: string,
    tags: string[],
  ): Promise<string> {
    const maxAttempts = Math.min(this.AI_API_KEYS.length, 3) // 最多尝试3次或所有Key数
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // 轮询获取下一个可用的 API Key (自动跳过熔断的 Key)
      const apiKey = this.getNextApiKey()
      if (!apiKey) {
        throw new Error('没有可用的 Gemini API Key (可能全部被熔断)')
      }

      // AI 请求限速: 确保与上次请求间隔至少 1 秒
      await this.throttleAiRequest()

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000) // 15s 超时

      try {
        const prompt = `请将以下壁纸信息转换为简洁的中文描述,用于搜索匹配:
名称: ${name}
标签: ${tags.join(', ')}

要求:
1. 翻译成中文
2. 描述风格、主题、特点
3. 控制在 50 字以内
4. 只返回描述文本,无需其他说明`

        // Gemini API endpoint (使用配置的代理和模型)
        const apiUrl = `${this.AI_BASE_URL}/models/${this.AI_MODEL}:generateContent?key=${apiKey}`

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: prompt,
              }],
            }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 200,
            },
          }),
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        // 检查 HTTP 错误
        if (!response.ok) {
          const errorBody = await response.text().catch(() => 'unknown error')
          const error = new Error(`Gemini API 错误 ${response.status}: ${errorBody}`)

          // 429 (配额超限) 或 401 (Key 无效) 触发熔断
          if (response.status === 429 || response.status === 401) {
            this.circuitBreakKey(apiKey)
          }

          throw error
        }

        const result = await response.json()
        const description = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim()

        if (!description) {
          throw new Error('Gemini 返回内容为空')
        }

        // 成功返回
        return description
      } catch (error) {
        clearTimeout(timeoutId)
        lastError = error instanceof Error ? error : new Error(String(error))

        // 记录错误并准备重试
        console.warn(
          `⚠️ [Gemini] Key ${this.maskApiKey(apiKey)} 失败 (${attempt}/${maxAttempts}): ${lastError.message}`,
        )

        // 如果还有重试机会,继续下一次尝试(将自动轮换 Key)
        if (attempt < maxAttempts) {
          await this.delay(500) // 短暂延迟后重试
        }
      }
    }

    throw lastError || new Error('Gemini 调用失败')
  }

  /**
   * 处理标签: 直接更新 wallpapers 表的 tags 和 tags_zh 字段
   */
  private async processTags(wallpaperId: string, tagNames: string[], tagsZh?: string[] | null) {
    const { error } = await supabase
      .from('wallpapers')
      .update({
        tags: tagNames,
        tags_zh: tagsZh || []
      })
      .eq('id', wallpaperId)

    if (error) {
      console.error('更新标签失败:', error)
    }
  }

  /**
   * 翻译内容 (name 和 tags)
   * 使用 Gemini API 进行翻译，失败时返回空
   */
  private async translateContent(
    name: string,
    tags: string[],
  ): Promise<{ name_zh?: string; tags_zh?: string[] }> {
    // 未配置 Gemini API Keys，跳过翻译
    if (this.AI_API_KEYS.length === 0) {
      console.log('⚠️ 未配置 AI API，跳过翻译')
      return {}
    }

    try {
      await this.throttleAiRequest()

      const apiKey = this.AI_API_KEYS[this.currentKeyIndex]
      const prompt = `请将以下英文内容翻译成简体中文，只返回翻译结果，不要任何解释：

标题: ${name}
标签: ${tags.join(', ')}

请按照以下格式返回（每行一个）：
标题翻译
标签1,标签2,标签3`

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: prompt }],
            }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 200,
            },
          }),
        },
      )

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()

      if (text) {
        const lines = text.split('\n').filter((line: string) => line.trim())
        const name_zh = lines[0]?.trim()
        const tags_zh = lines[1]?.split(',').map((t: string) => t.trim()).filter((t: string) => t)

        console.log(`✅ 翻译成功: ${name} → ${name_zh}`)
        return { name_zh, tags_zh }
      }

      return {}
    } catch (error) {
      console.error('❌ 翻译失败:', error)
      return {}
    }
  }

  /**
   * 延迟工具函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * AI 请求限速: 确保请求间隔至少 1 秒
   */
  private async throttleAiRequest(): Promise<void> {
    const now = Date.now()
    const timeSinceLastRequest = now - this.lastAiRequestTime

    if (timeSinceLastRequest < this.AI_REQUEST_INTERVAL) {
      const waitTime = this.AI_REQUEST_INTERVAL - timeSinceLastRequest
      await this.delay(waitTime)
    }

    this.lastAiRequestTime = Date.now()
  }
}
