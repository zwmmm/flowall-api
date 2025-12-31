// 壁纸类型定义
export interface Wallpaper {
  id: string
  moewalls_id: string
  name: string
  description: string | null
  cover_url: string // 封面图
  preview_url: string
  video_url: string
  status: 'active' | 'inactive'
  view_count?: number
  download_count?: number
  rating?: number
  crawled_at: string
  created_at: string
  updated_at: string
}

// 标签类型定义
export interface Tag {
  id: string
  name: string
  slug: string
  created_at: string
}

// 带标签的壁纸
export interface WallpaperWithTags extends Wallpaper {
  tags: Tag[]
}

// 壁纸-标签关联
export interface WallpaperTagRelation {
  wallpaper_id: string
  tag_id: string
  created_at: string
}

// API 响应类型
export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface WallpaperListResponse {
  items: WallpaperWithTags[]
  pagination: PaginationMeta
}

// 查询参数类型
export interface WallpaperQueryParams {
  page?: number
  limit?: number
  search?: string
  tags?: string
  sort?: 'latest' | 'popular' | 'rating'
}

// 爬取到的原始数据
export interface MoewallsRawData {
  id: string
  name: string
  cover_url: string // 封面图
  preview_url: string
  video_url: string
  tags: string[]
}
