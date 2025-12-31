# 数据库 Migration 说明

## 🔧 Migration 002: 添加 cover_url 字段

### 问题
爬虫服务需要 `cover_url` 字段来存储壁纸封面图,但数据库表中缺少此字段。

### 解决方案
添加 `cover_url` 字段到 `wallpapers` 表。

## 📋 Migration 内容

```sql
-- 1. 添加 cover_url 字段
alter table wallpapers add column cover_url text;

-- 2. 数据迁移: 将现有 preview_url 复制到 cover_url
update wallpapers set cover_url = preview_url where cover_url is null;

-- 3. 设置字段为 not null
alter table wallpapers alter column cover_url set not null;

-- 4. 更新视图
create or replace view wallpapers_with_tags as ...
```

## 🚀 应用 Migration

### 方法 1: Supabase Dashboard (推荐)

1. 登录 [Supabase Dashboard](https://app.supabase.com)
2. 选择你的项目
3. 进入 **SQL Editor**
4. 打开文件: `supabase/migrations/002_add_cover_url.sql`
5. 复制所有 SQL 内容
6. 粘贴到 SQL Editor
7. 点击 **Run** 执行

### 方法 2: 使用脚本 (需要 Service Key)

```bash
# 1. 设置环境变量
export SUPABASE_URL="your_supabase_url"
export SUPABASE_SERVICE_KEY="your_service_key"

# 2. 执行脚本
./scripts/apply-migration.sh
```

**注意:** Service Key 是敏感信息,不要提交到 Git!

### 方法 3: 使用 Supabase CLI

```bash
# 如果你有 Supabase CLI
supabase db push
```

## ✅ 验证 Migration

执行完成后,验证字段是否添加成功:

```sql
-- 查询表结构
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'wallpapers'
order by ordinal_position;
```

应该看到 `cover_url` 字段,类型为 `text`,不可为空。

## 📊 影响范围

- **表结构**: 添加 `cover_url` 字段
- **现有数据**: 自动从 `preview_url` 复制初始值
- **视图**: 更新 `wallpapers_with_tags` 视图
- **API**: 需要更新 TypeScript 类型定义

## 🔄 回滚 (如需)

如果需要回滚此 Migration:

```sql
-- 删除 cover_url 字段
alter table wallpapers drop column cover_url;

-- 恢复原视图
create or replace view wallpapers_with_tags as
select
  w.id,
  w.moewalls_id,
  w.name,
  w.description,
  w.preview_url,
  w.video_url,
  w.status,
  w.crawled_at,
  w.created_at,
  w.updated_at,
  coalesce(
    json_agg(
      json_build_object('id', t.id, 'name', t.name, 'slug', t.slug)
      order by t.name
    ) filter (where t.id is not null),
    '[]'
  ) as tags
from wallpapers w
left join wallpaper_tag_relations wtr on w.id = wtr.wallpaper_id
left join wallpaper_tags t on wtr.tag_id = t.id
group by w.id;
```

## 📝 TypeScript 类型更新

Migration 完成后,确保 TypeScript 类型定义包含 `cover_url`:

```typescript
// src/types/wallpaper.ts
export interface Wallpaper {
  id: string
  moewalls_id: string
  name: string
  description?: string
  cover_url: string      // ← 新增字段
  preview_url: string
  video_url: string
  status: 'active' | 'inactive'
  crawled_at: string
  created_at: string
  updated_at: string
}
```

## ✨ 后续步骤

1. ✅ 应用 Migration
2. ✅ 验证数据库字段
3. ✅ 确认爬虫服务正常运行
4. ✅ 测试壁纸数据插入

完成后,爬虫服务将能够正常存储壁纸封面图! 🎉
