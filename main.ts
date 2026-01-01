import { Hono } from 'hono'
import { createClient } from '@supabase/supabase-js'
import router from './src/routes/index.ts'
import { scheduler } from './src/scheduler.ts'
import { errorHandler } from './src/middleware/errorHandler.ts'
import { ApiError } from './src/utils/validation.ts'

// 初始化 Supabase 客户端
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!

export const supabase = createClient(supabaseUrl, supabaseKey)

// 创建 Hono 应用
const app = new Hono()

// 全局错误处理中间件 (必须在最前面)
app.use('*', errorHandler)

// 简单的日志中间件
app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  const ms = Date.now() - start
  console.log(`${c.req.method} ${c.req.url} - ${ms}ms`)
})

// CORS 中间件
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*')
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key')

  if (c.req.method === 'OPTIONS') {
    return new Response('', { status: 204 })
  }

  await next()
})

// 健康检查路由
app.get('/', (c) => {
  return c.json({
    message: 'Flowall API is running',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  })
})

// 挂载 API 路由
app.route('/api/v1', router)

// 404 处理
app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: 'Not Found',
    },
    404,
  )
})

// Hono 内置错误处理 (兜底)
app.onError((err, c) => {
  console.error('Unhandled Error:', err)

  // 如果是 ApiError,返回对应的状态码
  if (err instanceof ApiError) {
    return c.json(
      {
        success: false,
        error: err.message,
        code: err.code,
      },
      err.statusCode as 500,
    )
  }

  return c.json(
    {
      success: false,
      error: '服务器内部错误',
    },
    500,
  )
})

// 启动定时任务 (默认关闭，需要环境变量 ENABLE_SCHEDULER=true 开启)
const enableScheduler = Deno.env.get('ENABLE_SCHEDULER') === 'true'
if (enableScheduler) {
  const scheduleHour = Number(Deno.env.get('SCHEDULE_HOUR')) || 2
  const scheduleMinute = Number(Deno.env.get('SCHEDULE_MINUTE')) || 0
  scheduler.start(scheduleHour, scheduleMinute)
  console.log(`⏰ 定时任务已启动: 每天 ${scheduleHour.toString().padStart(2, '0')}:${scheduleMinute.toString().padStart(2, '0')}`)
} else {
  console.log('⚠️ 定时任务已禁用 (设置 ENABLE_SCHEDULER=true 启用)')
}

// 优雅关闭处理
// 后台运行时忽略 SIGINT(Ctrl+C),只响应 SIGTERM(kill 命令)
Deno.addSignalListener('SIGTERM', () => {
  console.log('\n👋 收到关闭信号,正在优雅关闭服务...')
  scheduler.stop()
  Deno.exit(0)
})

// 如果是前台运行(开发模式),也支持 Ctrl+C 关闭
if (Deno.stdin.isTerminal()) {
  Deno.addSignalListener('SIGINT', () => {
    console.log('\n👋 收到中断信号,正在关闭服务...')
    scheduler.stop()
    Deno.exit(0)
  })
}

// 启动服务器
const port = Number(Deno.env.get('PORT')) || 8000

console.log(`🚀 Server is running on http://localhost:${port}`)

Deno.serve({ port }, app.fetch)
