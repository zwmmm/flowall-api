# Flowall API

动态壁纸爬虫 API - 自动从 moewalls.com 爬取动态壁纸数据

## 技术栈

- **Runtime**: Deno 2.x
- **Framework**: Hono.js 4.x
- **Database**: Supabase (PostgreSQL)
- **Language**: TypeScript
- **Crawler**: Cheerio (HTML 解析)

## 功能特性

- ✅ 自动爬取 moewalls.com 动态壁纸
- ✅ AI 生成中文描述 (用于搜索)
- ✅ 定时任务 (每日自动爬取)
- ✅ RESTful API (壁纸列表、详情、标签)
- ✅ 管理 API (手动爬取、查看日志、系统统计)
- ✅ 速率限制、输入验证、错误处理
- ✅ 全文搜索、标签过滤、多种排序

## 快速开始

### 1. 环境准备

创建 `.env` 文件:

```bash
# Supabase 配置
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# 管理 API Key
ADMIN_API_KEY=your-admin-secret-key

# AI API 配置 (可选,用于生成中文描述)
AI_API_URL=https://api.openai.com/v1/chat/completions
AI_API_KEY=your-openai-key

# 定时任务配置
ENABLE_SCHEDULER=true
SCHEDULE_HOUR=2
SCHEDULE_MINUTE=0

# 服务器配置
PORT=8000
```

### 2. 数据库迁移

在 Supabase SQL Editor 中执行以下迁移文件:

1. `supabase/migrations/001_create_wallpapers_schema.sql`
2. `supabase/migrations/002_add_enhanced_fields.sql`
3. `supabase/migrations/003_add_helper_functions.sql`

### 3. 启动服务

```bash
deno task dev
# 或
deno run --allow-net --allow-env --allow-read main.ts
```

### 4. 测试爬虫

**重要**: 测试爬虫需要先启动 API 服务器

```bash
# 终端 1: 启动 API 服务器
deno task dev

# 终端 2: 执行爬虫测试
deno task crawl
```

测试脚本会:

1. 通过 HTTP API 触发爬取任务
2. 轮询检查爬取状态
3. 显示爬取结果和系统统计

## API 文档

### 公开接口

#### 1. 获取壁纸列表

```http
GET /api/v1/wallpapers?page=1&limit=20&sort=latest&search=风景&tags=自然,山水
```

**查询参数:**

- `page`: 页码 (默认 1)
- `limit`: 每页数量 (默认 20, 最大 100)
- `sort`: 排序方式 (`latest` | `popular` | `rating`)
- `search`: 搜索关键词
- `tags`: 标签过滤 (逗号分隔)

**响应:**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "moewalls_id": "wallpaper-slug",
        "name": "Wallpaper Title",
        "description": "AI 生成的中文描述",
        "preview_url": "https://...",
        "video_url": "https://...",
        "tags": ["自然", "风景"],
        "view_count": 123,
        "download_count": 45,
        "rating": 4.5,
        "resolution": "1920x1080",
        "crawled_at": "2025-01-01T00:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 100,
      "totalPages": 5
    }
  }
}
```

#### 2. 获取壁纸详情

```http
GET /api/v1/wallpapers/:id
```

#### 3. 获取随机壁纸

```http
GET /api/v1/wallpapers/random?limit=10
```

#### 4. 记录下载

```http
POST /api/v1/wallpapers/:id/download
```

#### 5. 获取标签列表

```http
GET /api/v1/tags?page=1&limit=50
```

### 管理接口 (需要 API Key)

所有管理接口需要在请求头中携带:

```
X-API-Key: your-admin-secret-key
```

#### 1. 手动触发爬取

```http
POST /api/v1/admin/crawl
```

**响应:**

```json
{
  "success": true,
  "message": "爬取任务已启动",
  "taskId": "uuid"
}
```

#### 2. 获取爬取状态

```http
GET /api/v1/admin/crawl/status
```

#### 3. 获取爬取日志

```http
GET /api/v1/admin/crawl/logs?page=1&limit=10
```

#### 4. 获取系统统计

```http
GET /api/v1/admin/stats
```

**响应:**

```json
{
  "success": true,
  "data": {
    "wallpapers_count": 1000,
    "tags_count": 150,
    "total_views": 50000,
    "total_downloads": 10000,
    "last_crawl": {
      "status": "success",
      "wallpapers_count": 50,
      "completed_at": "2025-01-01T02:00:00Z"
    },
    "is_crawling": false
  }
}
```

#### 5. 清理无效数据

```http
POST /api/v1/admin/cleanup
```

## 爬虫工作原理

### 1. 列表页爬取

- 访问 `https://moewalls.com/page/{page}/`
- 使用 iPhone 移动端 User-Agent
- 提取所有壁纸详情页链接
- 默认爬取前 5 页 (可配置)

### 2. 详情页爬取

- 串行访问每个详情页 (防止被封)
- 提取数据:
  - 标题 (h1.post-title)
  - 预览图 (.post-content img)
  - 下载链接 (#moe-download data-url)
  - 标签 (.post-tags a)
  - 分辨率 (从 meta 提取)

### 3. 下载链接构建

```typescript
const downloadBtn = $('#moe-download')
const dataUrl = downloadBtn.attr('data-url')
const video_url = `https://go.moewalls.com/download.php?video=${dataUrl}`
```

### 4. AI 描述生成

- 调用 OpenAI API
- 将英文标题和标签翻译为中文描述
- 用于全文搜索匹配
- 如果 AI API 失败,使用默认格式: `标题 - 标签`

### 5. 防封策略

- ✅ 使用移动端 UA
- ✅ 串行处理 (CONCURRENT_LIMIT = 1)
- ✅ 请求间隔 2s (REQUEST_DELAY = 2000ms)
- ✅ 重试机制 (MAX_RETRIES = 3)
- ✅ 超时控制 (30s)

## 定时任务

默认每天凌晨 2 点自动执行爬取任务。可通过环境变量配置:

```bash
ENABLE_SCHEDULER=true    # 启用定时任务
SCHEDULE_HOUR=2          # 小时 (0-23)
SCHEDULE_MINUTE=0        # 分钟 (0-59)
```

## 开发建议

### 可用命令

```bash
# 启动开发服务器
deno task dev

# 启动生产服务器
deno task start

# 执行爬虫任务
deno task crawl

# 类型检查
deno task check

# 代码格式化
deno task fmt

# 代码检查
deno task lint
```

### 类型检查

```bash
deno check main.ts
```

### 代码格式化

```bash
deno fmt
```

### 代码检查

```bash
deno lint
```

## 架构设计

### 数据库表结构

- `wallpapers`: 壁纸主表
- `wallpaper_tags`: 标签表
- `wallpaper_tag_relations`: 壁纸-标签关系表
- `crawl_logs`: 爬取日志表

### 视图

- `wallpapers_with_tags`: 壁纸 + 标签聚合视图 (用于 API 查询)

### 函数

- `get_random_wallpapers()`: 随机获取壁纸
- `increment_download_count()`: 原子增加下载量
- `cleanup_unused_tags()`: 清理无关联标签

### 中间件

- `errorHandler`: 统一错误处理
- `asyncHandler`: 异步路由包装器
- `rateLimiter`: 速率限制

### 服务

- `CrawlerService`: 爬虫服务 (重试、并发控制、超时)

## 安全性

- ✅ API Key 认证 (管理接口)
- ✅ 速率限制 (全局 100/min, 管理 20/min)
- ✅ 输入验证 (UUID、分页、搜索、标签)
- ✅ SQL 注入防护 (Supabase 客户端)
- ✅ XSS 防护 (清洗输入)
- ✅ 错误信息脱敏

## 性能优化

- ✅ 数据库索引 (GIN 全文搜索, B-tree)
- ✅ 物化视图 (wallpapers_with_tags)
- ✅ 批量操作 (标签批量插入)
- ✅ 异步更新 (浏览量不阻塞响应)
- ✅ 分页查询 (避免全表扫描)

## 故障排查

### 爬虫不工作

1. 检查网络连接
2. 检查 moewalls.com 是否可访问
3. 检查 CSS 选择器是否失效 (网站改版)
4. 查看爬取日志: `GET /api/v1/admin/crawl/logs`

### AI 描述生成失败

1. 检查 `AI_API_URL` 和 `AI_API_KEY` 配置
2. 确认 API 余额充足
3. 爬虫会降级使用默认格式,不影响主流程

### 数据库连接失败

1. 检查 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY`
2. 确认 Supabase 项目状态正常
3. 检查 RLS 策略是否正确

## License

MIT
