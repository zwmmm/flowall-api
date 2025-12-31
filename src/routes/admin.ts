import { Hono } from 'hono'
import { asyncHandler } from '../middleware/errorHandler.ts'
import { CrawlerService } from '../services/crawler.ts'
import { adminRateLimiter, ApiError } from '../utils/validation.ts'

const router = new Hono()
const crawler = new CrawlerService()

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
    const status = crawler.getStatus()
    if (status.isRunning) {
      throw new ApiError(409, '已有爬取任务正在运行,请等待完成', 'CRAWL_IN_PROGRESS')
    }

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

    return c.json({
      success: true,
      message: '爬取任务已启动',
    })
  }),
)

/**
 * 终止正在运行的爬取任务
 */
router.post(
  '/crawl/abort',
  asyncHandler(async (c) => {
    const aborted = crawler.abort()

    if (!aborted) {
      throw new ApiError(400, '没有正在运行的爬取任务', 'NO_RUNNING_TASK')
    }

    return c.json({
      success: true,
      message: '已发送终止信号,任务将在当前批次完成后停止',
    })
  }),
)

/**
 * 查询爬取任务状态
 */
router.get(
  '/crawl/status',
  asyncHandler(async (c) => {
    const status = crawler.getStatus()

    return c.json({
      success: true,
      data: status,
    })
  }),
)

export default router
