// 统一错误处理中间件
import type { Context, Next } from 'hono'
import { ApiError } from '../utils/validation.ts'

/**
 * 全局错误处理中间件
 * 捕获所有路由中抛出的错误并统一处理
 */
export async function errorHandler(c: Context, next: Next) {
  try {
    await next()
  } catch (err) {
    const error = err as Error
    console.error('Error:', error)

    // API 错误 - 业务逻辑错误
    if (error instanceof ApiError) {
      return c.json(
        {
          success: false,
          error: error.message,
          code: error.code,
        },
        error.statusCode as 500,
      )
    }

    // 标准 Error - 未预期的错误
    if (error instanceof Error) {
      return c.json(
        {
          success: false,
          error: '服务器内部错误',
        },
        500,
      )
    }

    // 其他类型错误
    return c.json(
      {
        success: false,
        error: '未知错误',
      },
      500,
    )
  }
}

/**
 * 异步路由处理器包装函数
 * 自动捕获 async 函数中的错误并传递给错误处理中间件
 */
export function asyncHandler(
  handler: (c: Context) => Promise<Response>,
) {
  return async (c: Context) => {
    return await handler(c)
  }
}
