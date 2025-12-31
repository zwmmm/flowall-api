import { Hono } from 'hono'
import { supabase } from '../../main.ts'
import type { Wallpaper } from '../types/wallpaper.ts'
import {
  ApiError,
  globalRateLimiter,
  sanitizeSearchQuery,
  validatePagination,
} from '../utils/validation.ts'
import { asyncHandler } from '../middleware/errorHandler.ts'

const router = new Hono()

// 速率限制中间件
router.use('*', async (c, next) => {
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown'

  if (!globalRateLimiter.check(ip)) {
    throw new ApiError(429, '请求过于频繁,请稍后再试', 'RATE_LIMIT_EXCEEDED')
  }

  await next()
})

/**
 * 获取壁纸列表
 */
router.get(
  '/',
  asyncHandler(async (c) => {
    // 验证和清洗输入
    const rawPage = Number(c.req.query('page'))
    const rawLimit = Number(c.req.query('limit'))
    const { page, limit } = validatePagination(rawPage, rawLimit)

    const search = sanitizeSearchQuery(c.req.query('search'))

    const offset = (page - 1) * limit

    // 构建查询
    let dbQuery = supabase
      .from('wallpapers')
      .select('*', { count: 'exact' })
      .eq('status', 'active')

    // 搜索过滤 (使用 search_vector 全文搜索)
    if (search) {
      dbQuery = dbQuery.textSearch('search_vector', search, {
        type: 'websearch',
        config: 'simple',
      })
    }

    // 分页
    dbQuery = dbQuery.range(offset, offset + limit - 1)

    const { data, error, count } = await dbQuery

    if (error) {
      console.error('数据库查询错误:', error)
      throw new ApiError(500, '查询失败', 'DB_QUERY_ERROR')
    }

    return c.json({
      success: true,
      data: {
        items: data as Wallpaper[],
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit),
        },
      },
    })
  }),
)

/**
 * 获取单个壁纸详情
 */
router.get(
  '/:id',
  asyncHandler(async (c) => {
    const id = c.req.param('id')

    const { data, error } = await supabase
      .from('wallpapers')
      .select('*')
      .eq('id', id)
      .eq('status', 'active')
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        throw new ApiError(404, '壁纸不存在', 'NOT_FOUND')
      }
      throw new ApiError(500, '查询失败', 'DB_QUERY_ERROR')
    }

    return c.json({
      success: true,
      data: data as Wallpaper,
    })
  }),
)

export default router
