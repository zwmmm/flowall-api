import { Hono } from 'hono'
import { supabase } from '../../main.ts'
import type { WallpaperWithTags } from '../types/wallpaper.ts'
import {
  ApiError,
  globalRateLimiter,
  sanitizeSearchQuery,
  sanitizeTags,
  validatePagination,
  validateSort,
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
    const tags = sanitizeTags(c.req.query('tags'))
    const sort = validateSort(c.req.query('sort'))

    const offset = (page - 1) * limit

    // 构建查询
    let dbQuery = supabase
      .from('wallpapers_with_tags')
      .select('*', { count: 'exact' })
      .eq('status', 'active')

    // 搜索过滤
    if (search) {
      dbQuery = dbQuery.textSearch('description', search, {
        type: 'websearch',
        config: 'simple',
      })
    }

    // 标签过滤
    if (tags.length > 0) {
      dbQuery = dbQuery.contains('tags', tags)
    }

    // 排序
    switch (sort) {
      case 'latest':
        dbQuery = dbQuery.order('crawled_at', { ascending: false })
        break
      case 'popular':
        dbQuery = dbQuery.order('view_count', { ascending: false })
        break
      case 'rating':
        dbQuery = dbQuery.order('rating', { ascending: false })
        break
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
        items: data as WallpaperWithTags[],
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

    // 验证 UUID 格式

    const { data, error } = await supabase
      .from('wallpapers_with_tags')
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

    // 异步增加浏览量 (不阻塞响应)
    Promise.resolve(
      supabase
        .from('wallpapers')
        .update({ view_count: (data.view_count || 0) + 1 })
        .eq('id', id),
    ).catch(() => {
      // 忽略错误,不影响主流程
    })

    return c.json({
      success: true,
      data: data as WallpaperWithTags,
    })
  }),
)

/**
 * 获取随机壁纸
 */
router.get(
  '/random',
  asyncHandler(async (c) => {
    const rawLimit = Number(c.req.query('limit')) || 1
    const limit = Math.min(20, Math.max(1, Math.floor(rawLimit)))

    const { data, error } = await supabase
      .rpc('get_random_wallpapers', { limit_count: limit })

    if (error) {
      console.error('RPC 调用错误:', error)
      throw new ApiError(500, '查询失败', 'DB_RPC_ERROR')
    }

    return c.json({
      success: true,
      data: data as WallpaperWithTags[],
    })
  }),
)

/**
 * 记录下载
 */
router.post(
  '/:id/download',
  asyncHandler(async (c) => {
    const id = c.req.param('id')

    // 增加下载量
    const { error } = await supabase.rpc('increment_download_count', {
      wallpaper_id: id,
    })

    if (error) {
      console.error('更新下载量失败:', error)
    }

    return c.json({
      success: true,
      message: '已记录',
    })
  }),
)

export default router
