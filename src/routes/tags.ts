import { Hono } from 'hono'
import { supabase } from '../../main.ts'
import { asyncHandler } from '../middleware/errorHandler.ts'
import { ApiError } from '../utils/validation.ts'

const router = new Hono()

/**
 * 获取所有标签
 */
router.get(
  '/',
  asyncHandler(async (c) => {
    // 获取标签及其使用次数
    const { data, error } = await supabase
      .from('wallpaper_tags')
      .select(`
        id,
        name,
        slug,
        created_at,
        wallpaper_tag_relations(count)
      `)
      .order('name')

    if (error) {
      throw new ApiError(500, '查询失败', 'DB_QUERY_ERROR')
    }

    // 转换数据格式,添加使用次数
    const tags = data.map((tag) => ({
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
      created_at: tag.created_at,
      count: tag.wallpaper_tag_relations?.[0]?.count || 0,
    }))

    return c.json({
      success: true,
      data: tags,
    })
  }),
)

/**
 * 获取热门标签
 */
router.get(
  '/popular',
  asyncHandler(async (c) => {
    const limit = Math.min(Number(c.req.query('limit')) || 10, 50)

    const { data, error } = await supabase
      .rpc('get_popular_tags', { limit_count: limit })

    if (error) {
      throw new ApiError(500, '查询失败', 'DB_RPC_ERROR')
    }

    return c.json({
      success: true,
      data,
    })
  }),
)

export default router
