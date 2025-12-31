import { CrawlerService } from './services/crawler.ts'

/**
 * 定时任务调度器 (基于 Deno.cron)
 * 每天执行一次爬取任务
 */
export class Scheduler {
  private crawler: CrawlerService
  private isRunning = false

  constructor() {
    this.crawler = new CrawlerService()
  }

  /**
   * 启动定时任务
   * @param hour 小时 (0-23)
   * @param minute 分钟 (0-59)
   */
  start(hour = 2, minute = 0) {
    if (this.isRunning) {
      console.log('⚠️ 定时任务已在运行中')
      return
    }

    this.isRunning = true

    // 使用 Deno.cron 启动定时任务
    // cron 格式: 分 时 日 月 周
    const cronExpression = `${minute} ${hour} * * *`

    Deno.cron('Daily Wallpaper Crawler', cronExpression, async () => {
      console.log('🚀 开始执行定时爬取任务...')

      try {
        const result = await this.crawler.crawl()
        console.log('✅ 定时爬取完成:', result)
      } catch (error) {
        console.error('❌ 定时爬取失败:', error)
      }
    })

    console.log(`⏰ 定时任务已启动: 每天 ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} 执行爬取`)
  }

  /**
   * 停止定时任务
   * 注意: Deno.cron 无法手动停止,只能通过重启进程
   */
  stop() {
    this.isRunning = false
    console.log('🛑 定时任务停止 (Deno.cron 将在进程退出时自动停止)')
  }

  /**
   * 立即执行一次爬取 (用于测试)
   */
  async runNow() {
    console.log('🚀 手动触发爬取任务...')
    try {
      const result = await this.crawler.crawl()
      console.log('✅ 手动爬取完成:', result)
      return result
    } catch (error) {
      console.error('❌ 手动爬取失败:', error)
      throw error
    }
  }
}

// 创建全局调度器实例
export const scheduler = new Scheduler()
