-- 创建优化的壁纸数据库结构
-- 执行时间: 2026-01-01
-- 特点: 极简结构 + 仅支持 search 查询优化

-- ============================================================
-- 1. 启用必要的 PostgreSQL 扩展
-- ============================================================

-- pg_trgm: 三元组扩展,支持模糊搜索和相似度查询
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- 2. 创建壁纸主表 (极简版)
-- ============================================================

CREATE TABLE wallpapers (
  -- 主键
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- 业务字段
  moewalls_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  name_zh TEXT,                               -- 名称中文翻译
  description TEXT,
  cover_url TEXT NOT NULL,                    -- 封面图
  preview_url TEXT NOT NULL,                  -- 预览图
  video_url TEXT NOT NULL,                    -- 视频地址

  -- 标签数组
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  tags_zh TEXT[] DEFAULT ARRAY[]::TEXT[],     -- 标签中文翻译

  -- 状态
  status TEXT DEFAULT 'active' NOT NULL CHECK (status IN ('active', 'inactive')),

  -- 时间戳
  crawled_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 表注释
COMMENT ON TABLE wallpapers IS '壁纸主表';
COMMENT ON COLUMN wallpapers.name IS '名称(原文)';
COMMENT ON COLUMN wallpapers.name_zh IS '名称(中文翻译)';
COMMENT ON COLUMN wallpapers.tags IS '标签数组(原文)';
COMMENT ON COLUMN wallpapers.tags_zh IS '标签数组(中文翻译)';

-- 添加 search_vector 列 (使用触发器维护)
ALTER TABLE wallpapers ADD COLUMN search_vector TSVECTOR;
COMMENT ON COLUMN wallpapers.search_vector IS '全文搜索向量: 同时搜索原文和中文翻译';

-- ============================================================
-- 3. 创建爬取日志表
-- ============================================================

CREATE TABLE crawl_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'partial')),
  wallpapers_count INTEGER DEFAULT 0,
  new_count INTEGER DEFAULT 0,
  updated_count INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE crawl_logs IS '爬虫任务执行日志';

-- ============================================================
-- 4. 创建高性能索引 (仅搜索相关)
-- ============================================================

-- 基础查询索引
CREATE INDEX idx_wallpapers_moewalls_id ON wallpapers(moewalls_id);
CREATE INDEX idx_wallpapers_status ON wallpapers(status) WHERE status = 'active';

-- 全文搜索索引 (GIN 索引,极速搜索) ⭐ 核心索引
CREATE INDEX idx_wallpapers_search_vector ON wallpapers USING GIN(search_vector);

-- 标签数组索引 (GIN 索引,支持数组查询)
CREATE INDEX idx_wallpapers_tags ON wallpapers USING GIN(tags);

-- 模糊搜索索引 (三元组索引,支持 LIKE 和相似度查询)
CREATE INDEX idx_wallpapers_name_trgm ON wallpapers USING GIN(name gin_trgm_ops);

-- 爬取日志索引
CREATE INDEX idx_crawl_logs_started_at ON crawl_logs(started_at DESC);

-- ============================================================
-- 5. 创建自动更新触发器
-- ============================================================

-- updated_at 自动更新函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- search_vector 自动更新函数 (包含原文和中文翻译)
CREATE OR REPLACE FUNCTION update_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    -- 原文字段 (权重 A 最高)
    setweight(to_tsvector('simple', coalesce(NEW.name, '')), 'A') ||
    -- 中文翻译字段 (权重 A 最高)
    setweight(to_tsvector('simple', coalesce(NEW.name_zh, '')), 'A') ||
    -- 描述 (权重 B)
    setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'B') ||
    -- 原文标签 (权重 C)
    setweight(to_tsvector('simple', coalesce(array_to_string(NEW.tags, ' '), '')), 'C') ||
    -- 中文标签 (权重 C)
    setweight(to_tsvector('simple', coalesce(array_to_string(NEW.tags_zh, ' '), '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 为 wallpapers 表添加 updated_at 触发器
CREATE TRIGGER update_wallpapers_updated_at
  BEFORE UPDATE ON wallpapers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 为 wallpapers 表添加 search_vector 触发器
CREATE TRIGGER update_wallpapers_search_vector
  BEFORE INSERT OR UPDATE ON wallpapers
  FOR EACH ROW
  EXECUTE FUNCTION update_search_vector();

-- ============================================================
-- 6. 启用行级安全 (RLS)
-- ============================================================

ALTER TABLE wallpapers ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_logs ENABLE ROW LEVEL SECURITY;

-- 壁纸表策略: 只允许读取 active 状态的壁纸
CREATE POLICY "Allow read active wallpapers" ON wallpapers
  FOR SELECT USING (status = 'active');

-- 爬取日志策略: 所有人可读 (生产环境建议改为仅管理员)
CREATE POLICY "Allow read crawl logs" ON crawl_logs
  FOR SELECT USING (true);

-- ============================================================
-- 7. 性能优化配置
-- ============================================================

-- 分析表以优化查询计划
ANALYZE wallpapers;
ANALYZE crawl_logs;
