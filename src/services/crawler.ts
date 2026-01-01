import * as cheerio from 'https://esm.sh/cheerio@1.0.0-rc.12'
import pLimit from 'npm:p-limit@6.1.0'
import { supabase } from '../../main.ts'
import type { MoewallsRawData, Wallpaper } from '../types/wallpaper.ts'

/**
 * 爬虫配置
 */
interface CrawlerConfig {
  detailPageConcurrency: number // 详情页并发数
  aiConcurrency: number // AI 请求并发数
  batchSize: number // 每批处理的 URL 数
  maxRetries: number // 最大重试次数
  retryDelayBase: number // 重试延迟基数（毫秒）
}

/**
 * 统计信息
 */
interface CrawlStats {
  newCount: number
  updatedCount: number
  failedCount: number
  skippedCount: number
}

export class CrawlerService {
  private readonly AI_API_KEY: string
  private readonly AI_BASE_URL: string
  private readonly AI_MODEL: string

  private readonly MOBILE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'

  // 终止信号
  private abortController: AbortController | null = null
  private isRunning = false

  // 并发控制器
  private detailLimiter: ReturnType<typeof pLimit>
  private aiLimiter: ReturnType<typeof pLimit>

  // 配置 - 保守方案
  private config: CrawlerConfig = {
    detailPageConcurrency: 8, // 详情页并发数
    aiConcurrency: 5, // AI 请求并发数
    batchSize: 50, // 每批处理的 URL 数
    maxRetries: 5, // 最大重试次数
    retryDelayBase: 1000, // 重试延迟基数（毫秒）
  }

  constructor() {
    // 从环境变量读取 AI API 配置
    this.AI_API_KEY = Deno.env.get('AI_API_KEY') || ''
    this.AI_BASE_URL = Deno.env.get('AI_BASE_URL') ||
      'https://api.siliconflow.cn/v1/chat/completions'
    this.AI_MODEL = Deno.env.get('AI_MODEL') || 'deepseek-ai/DeepSeek-V3.2'

    // 初始化并发控制器
    this.detailLimiter = pLimit(this.config.detailPageConcurrency)
    this.aiLimiter = pLimit(this.config.aiConcurrency)

    if (this.AI_API_KEY) {
      console.log(`🤖 AI 配置: ${this.AI_BASE_URL} | 模型: ${this.AI_MODEL}`)
    } else {
      console.warn('⚠️ 未配置 AI_API_KEY，将使用降级策略')
    }

    console.log(`⚙️ 爬虫配置 (并发模式):`)
    console.log(`   - 详情页并发: ${this.config.detailPageConcurrency}`)
    console.log(`   - AI 并发: ${this.config.aiConcurrency}`)
    console.log(`   - 批处理大小: ${this.config.batchSize}`)
  }

  /**
   * 执行爬取任务 (并发模式)
   */
  async crawl(): Promise<{ new_count: number; updated_count: number; failed_count: number }> {
    if (this.isRunning) {
      throw new Error('已有爬取任务正在运行')
    }

    this.isRunning = true
    this.abortController = new AbortController()
    console.log('🕷️ 开始爬取 moewalls.com (并发模式)...')

    const stats: CrawlStats = {
      newCount: 0,
      updatedCount: 0,
      failedCount: 0,
      skippedCount: 0,
    }

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
      // 第一阶段: 收集所有 URL
      console.log('📋 阶段 1: 收集所有 URL...')
      const allUrls = await this.collectAllUrls()
      console.log(`✅ 共收集到 ${allUrls.length} 个 URL`)

      if (allUrls.length === 0) {
        console.log('⚠️ 未找到任何 URL，结束爬取')
        return { new_count: 0, updated_count: 0, failed_count: 0 }
      }

      // 第二阶段: 批量并发处理 URL
      console.log('🚀 阶段 2: 批量并发处理...')
      await this.processBatches(allUrls, stats)

      const statusMsg = this.abortController?.signal.aborted ? '\n🛑 爬取已终止' : '\n🎉 爬取完成'
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
   * 阶段 1: 串行收集所有列表页的 URL
   */
  private async collectAllUrls(): Promise<string[]> {
    const allUrls: string[] = []
    let page = 1
    let emptyCount = 0

    while (emptyCount < 3) {
      if (this.abortController?.signal.aborted) {
        console.log('🛑 收集 URL 时检测到终止信号')
        break
      }

      try {
        console.log(`📄 正在获取第 ${page} 页...`)
        const urls = await this.retryWithBackoff(
          () => this.fetchListPage(page),
          `列表页 ${page}`,
        )

        if (urls.length === 0) {
          emptyCount++
          console.log(`⚠️ 第 ${page} 页无数据 (连续空页: ${emptyCount}/3)`)
        } else {
          emptyCount = 0
          allUrls.push(...urls)
          console.log(`✅ 第 ${page} 页: ${urls.length} 个 URL (总计: ${allUrls.length})`)
        }

        page++
        await this.delay(500) // 页面间隔 500ms
      } catch (error) {
        console.error(`❌ 第 ${page} 页获取失败:`, error)
        emptyCount++
        page++
      }
    }

    return allUrls
  }

  /**
   * 阶段 2: 批量并发处理 URL
   */
  private async processBatches(urls: string[], stats: CrawlStats): Promise<void> {
    const { batchSize } = this.config

    for (let i = 0; i < urls.length; i += batchSize) {
      if (this.abortController?.signal.aborted) {
        console.log('🛑 批处理时检测到终止信号')
        break
      }

      const batch = urls.slice(i, Math.min(i + batchSize, urls.length))
      const batchNum = Math.floor(i / batchSize) + 1
      const totalBatches = Math.ceil(urls.length / batchSize)

      console.log(`\n📦 批次 ${batchNum}/${totalBatches}: 处理 ${batch.length} 个 URL`)

      // 并发处理当前批次
      const results = await Promise.allSettled(
        batch.map((url) => this.processUrl(url, stats)),
      )

      // 统计本批次结果
      const batchSuccess = results.filter((r) => r.status === 'fulfilled').length
      const batchFailed = results.filter((r) => r.status === 'rejected').length

      console.log(
        `✅ 批次 ${batchNum} 完成: 成功 ${batchSuccess}, 失败 ${batchFailed} | 总计: +${stats.newCount} ↻${stats.updatedCount} ⊘${stats.skippedCount} ❌${stats.failedCount}`,
      )

      // 输出内存使用情况
      this.logMemoryUsage()

      // 批次间短暂延迟
      if (i + batchSize < urls.length) {
        await this.delay(300)
      }
    }
  }

  /**
   * 处理单个 URL
   */
  private async processUrl(url: string, stats: CrawlStats): Promise<void> {
    // 提取 ID
    const urlParts = url.replace(/\/$/, '').split('/')
    const moewallsId = urlParts[urlParts.length - 1]

    try {
      // 快速检查是否已存在
      const { data: existing } = await supabase
        .from('wallpapers')
        .select('id')
        .eq('moewalls_id', moewallsId)
        .maybeSingle()

      if (existing) {
        stats.skippedCount++
        return
      }

      // 使用详情页并发限制器 + 重试
      const wallpaper = await this.detailLimiter(async () => {
        return await this.retryWithBackoff(
          () => this.fetchDetailPage(url),
          `详情页 ${moewallsId}`,
        )
      })

      // 处理并保存
      const result = await this.processWallpaper(wallpaper)

      if (result === 'new') stats.newCount++
      if (result === 'updated') stats.updatedCount++
    } catch (error) {
      stats.failedCount++
      console.error(`❌ 处理失败 ${moewallsId}:`, error instanceof Error ? error.message : error)
      throw error
    }
  }

  /**
   * 带指数退避的重试机制
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    context: string,
  ): Promise<T> {
    const { maxRetries, retryDelayBase } = this.config
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn()
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        if (attempt < maxRetries - 1) {
          const delay = retryDelayBase * Math.pow(2, attempt) // 指数退避
          console.warn(
            `⚠️ [${context}] 第 ${attempt + 1}/${maxRetries} 次尝试失败，${delay}ms 后重试...`,
          )
          await this.delay(delay)
        }
      }
    }

    throw new Error(`[${context}] 重试 ${maxRetries} 次后仍然失败: ${lastError?.message}`)
  }

  /**
   * 输出内存使用情况
   */
  private logMemoryUsage(): void {
    if (typeof Deno !== 'undefined' && Deno.memoryUsage) {
      const mem = Deno.memoryUsage()
      const heapUsed = (mem.heapUsed / 1024 / 1024).toFixed(2)
      const heapTotal = (mem.heapTotal / 1024 / 1024).toFixed(2)
      const rss = (mem.rss / 1024 / 1024).toFixed(2)
      console.log(`💾 [内存] 堆: ${heapUsed}MB / ${heapTotal}MB | RSS: ${rss}MB`)
    }
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
      $('article.entry-tpl-grid .entry-featured-media a').each((_, el) => {
        const href = $(el).attr('href')
        if (
          href && href.includes('moewalls.com/') && !href.includes('/page/') &&
          !href.includes('/category/') && !href.includes('/resolution/')
        ) {
          urls.push(href)
        }
      })

      // 释放 Cheerio 占用的内存
      // @ts-ignore - Cheerio 内部清理
      $.root().empty()

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

      // 提取封面图
      let cover_url = $('video').attr('poster') || ''
      if (!cover_url) {
        cover_url = $('.entry-featured-media img').first().attr('src') || ''
      }
      if (cover_url && cover_url.startsWith('/')) {
        cover_url = `https://moewalls.com${cover_url}`
      }

      // 提取预览视频
      let preview_url = $('video source[src*=".webm"]').attr('src') || ''
      if (!preview_url) {
        preview_url = $('video source').first().attr('src') || ''
      }
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

      // 释放 Cheerio 占用的内存
      // @ts-ignore - Cheerio 内部清理
      $.root().empty()

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
      .maybeSingle()

    // 2. 生成 AI 内容 (描述 + 翻译)，仅在不存在时调用
    let description = existing?.description
    let name_zh = existing?.name_zh
    let tags_zh = existing?.tags_zh

    if (!description || !name_zh || !tags_zh || tags_zh.length === 0) {
      const aiContent = await this.generateAIContent(raw.name, raw.tags)
      description = aiContent.description || description
      name_zh = aiContent.name_zh || name_zh
      tags_zh = aiContent.tags_zh || tags_zh
    }

    // 3. 准备数据
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

    // 4. 处理标签 (包含中文翻译)
    await this.processTags(wallpaperId, raw.tags, tags_zh)

    return existing ? 'updated' : 'new'
  }

  /**
   * 生成 AI 内容 (描述 + 中文翻译) - 使用 AI 并发限制
   */
  private async generateAIContent(
    name: string,
    tags: string[],
  ): Promise<{
    description?: string
    name_zh?: string
    tags_zh?: string[]
  }> {
    // 降级策略
    const fallback = {
      description: `${name} - ${tags.join(', ')}`,
      name_zh: undefined,
      tags_zh: undefined,
    }

    // 未配置 AI API Key
    if (!this.AI_API_KEY) {
      return fallback
    }

    // 使用 AI 并发限制器
    return await this.aiLimiter(async () => {
      return await this.retryWithBackoff(
        async () => {
          const systemPrompt = `你是一个专业的壁纸描述生成助手。请根据壁纸信息生成中文内容，以 JSON 格式返回（不要包含 markdown 代码块标记）。`

          const userPrompt = `原始标题: ${name}
标签: ${tags.join(', ')}

请返回 JSON 格式：
{
  "name_zh": "中文标题翻译",
  "description": "面向搜索的生动描述，突出壁纸特点和视觉效果。",
  "tags_zh": ["中文标签1", "中文标签2", ...]
}

要求：
1. name_zh: 简洁优雅的中文标题
2. description: 生动形象的描述，吸引用户
3. tags_zh: 准确翻译所有标签`

          const response = await fetch(this.AI_BASE_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.AI_API_KEY}`,
            },
            body: JSON.stringify({
              model: this.AI_MODEL,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
              ],
              temperature: 0.7,
              max_tokens: 500,
            }),
          })

          if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`AI API error: ${response.status} - ${errorText}`)
          }

          const data = await response.json()
          const text = data.choices?.[0]?.message?.content?.trim()

          if (!text) {
            throw new Error('AI 返回空内容')
          }

          // 清理可能的 markdown 代码块标记
          const cleanedText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
          const result = JSON.parse(cleanedText)

          return {
            description: result.description || fallback.description,
            name_zh: result.name_zh,
            tags_zh: Array.isArray(result.tags_zh) ? result.tags_zh : undefined,
          }
        },
        `AI 内容生成 ${name}`,
      ).catch((error) => {
        console.error(`❌ AI 内容生成失败，使用降级策略:`, error.message)
        return fallback
      })
    })
  }

  /**
   * 处理标签: 直接更新 wallpapers 表的 tags 和 tags_zh 字段
   */
  private async processTags(wallpaperId: string, tagNames: string[], tagsZh?: string[] | null) {
    const { error } = await supabase
      .from('wallpapers')
      .update({
        tags: tagNames,
        tags_zh: tagsZh || [],
      })
      .eq('id', wallpaperId)

    if (error) {
      console.error('更新标签失败:', error)
    }
  }

  /**
   * 延迟工具函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
