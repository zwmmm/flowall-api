import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'

/**
 * 自定义错误类
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * 速率限制器
 */
export class RateLimiter {
  private requests: Map<string, number[]> = new Map()

  constructor(
    private maxRequests: number,
    private windowMs: number,
  ) {}

  check(key: string): boolean {
    const now = Date.now()
    const requests = this.requests.get(key) || []

    // 清理过期请求
    const validRequests = requests.filter((time) => now - time < this.windowMs)

    if (validRequests.length >= this.maxRequests) {
      return false
    }

    validRequests.push(now)
    this.requests.set(key, validRequests)
    return true
  }
}

// 全局速率限制器
export const globalRateLimiter = new RateLimiter(100, 60000) // 100 请求/分钟
export const adminRateLimiter = new RateLimiter(20, 60000) // 20 请求/分钟

/**
 * Zod Schemas
 */

// 分页参数验证
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// 搜索查询验证
export const searchQuerySchema = z.string().max(100).transform((val: string) =>
  val.trim().replace(/[<>]/g, '')
).optional()

/**
 * 验证分页参数
 */
export function validatePagination(
  page: number,
  limit: number,
): { page: number; limit: number } {
  const result = paginationSchema.safeParse({ page, limit })
  if (!result.success) {
    return { page: 1, limit: 20 }
  }
  return result.data
}

/**
 * 清洗搜索查询
 */
export function sanitizeSearchQuery(query?: string): string {
  if (!query) return ''
  const result = searchQuerySchema.safeParse(query)
  return result.success ? result.data || '' : ''
}
