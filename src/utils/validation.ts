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

// 排序参数验证
export const sortSchema = z.enum(['latest', 'popular', 'rating']).default('latest')

// 搜索查询验证
export const searchQuerySchema = z.string().max(100).transform((val: string) =>
  val.trim().replace(/[<>]/g, '')
).optional()

// 标签验证
export const tagsSchema = z.string().transform((val: string) =>
  val.split(',')
    .map((tag: string) => tag.trim())
    .filter((tag: string) => tag.length > 0 && tag.length <= 50)
    .slice(0, 10)
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
 * 验证排序参数
 */
export function validateSort(sort?: string): 'latest' | 'popular' | 'rating' {
  const result = sortSchema.safeParse(sort)
  return result.success ? result.data : 'latest'
}

/**
 * 清洗搜索查询
 */
export function sanitizeSearchQuery(query?: string): string {
  if (!query) return ''
  const result = searchQuerySchema.safeParse(query)
  return result.success ? result.data || '' : ''
}

/**
 * 清洗标签数组
 */
export function sanitizeTags(tagsStr?: string): string[] {
  if (!tagsStr) return []
  const result = tagsSchema.safeParse(tagsStr)
  return result.success ? result.data || [] : []
}
