import { Hono } from 'hono'
import { asyncHandler } from '../middleware/errorHandler.ts'
import { CrawlerService } from '../services/crawler.ts'
import { adminRateLimiter, ApiError } from '../utils/validation.ts'

const router = new Hono()
const crawler = new CrawlerService()

// 存储运行中的爬取任务
const runningCrawls = new Set<string>()

/**
 * 认证中间件
 */
router.use('*', async (c, next) => {
  const apiKey = c.req.header('X-API-Key')
  const validKey = Deno.env.get('ADMIN_API_KEY')

  if (!validKey) {
    throw new ApiError(500, '服务器配置错误', 'CONFIG_ERROR')
  }

  if (!apiKey || apiKey !== validKey) {
    throw new ApiError(401, '未授权访问', 'UNAUTHORIZED')
  }

  // 速率限制
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'admin'
  if (!adminRateLimiter.check(`admin:${ip}`)) {
    throw new ApiError(429, '请求过于频繁,请稍后再试', 'RATE_LIMIT_EXCEEDED')
  }

  await next()
})

/**
 * 手动触发爬取任务
 */
router.post(
  '/crawl',
  asyncHandler(async (c) => {
    if (runningCrawls.size > 0) {
      throw new ApiError(409, '已有爬取任务正在运行,请等待完成', 'CRAWL_IN_PROGRESS')
    }

    const taskId = crypto.randomUUID()
    runningCrawls.add(taskId)

    console.log('📥 收到手动爬取请求')

    // 异步执行爬取任务
    crawler
      .crawl()
      .then((result) => {
        console.log('✅ 爬取任务完成:', result)
      })
      .catch((error) => {
        console.error('❌ 爬取任务失败:', error)
      })
      .finally(() => {
        runningCrawls.delete(taskId)
      })

    return c.json({
      success: true,
      message: '爬取任务已启动',
      taskId,
    })
  }),
)

export default router
