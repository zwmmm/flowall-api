// 壁纸类型定义
export interface Wallpaper {
  id: string
  moewalls_id: string
  name: string
  name_zh?: string | null // 名称中文翻译
  description: string | null
  cover_url: string
  preview_url: string
  video_url: string
  status: 'active' | 'inactive'
  tags: string[] // 标签数组(原文)
  tags_zh?: string[] | null // 标签数组(中文翻译)
  crawled_at: string
  created_at: string
  updated_at: string
}

// API 响应类型
export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface WallpaperListResponse {
  items: Wallpaper[]
  pagination: PaginationMeta
}

// 查询参数类型 (仅支持 search)
export interface WallpaperQueryParams {
  page?: number
  limit?: number
  search?: string
}

// 爬取到的原始数据
export interface MoewallsRawData {
  id: string
  name: string
  cover_url: string
  preview_url: string
  video_url: string
  tags: string[]
}
