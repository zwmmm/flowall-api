-- ⚠️ 危险操作: 清空所有数据
-- 此脚本将删除所有表中的数据,但保留表结构
-- 使用前请确保已备份重要数据!

-- 临时禁用外键约束检查 (如果需要)
-- set constraints all deferred;

-- 按照依赖关系顺序删除数据
-- 1. 首先删除关联表数据 (有外键约束的表)
truncate table wallpaper_tag_relations cascade;

-- 2. 删除主表数据
truncate table wallpapers cascade;
truncate table wallpaper_tags cascade;

-- 3. 删除日志表数据
truncate table crawl_logs cascade;

-- 重置序列 (如果有自增ID的话)
-- 注意: UUID 不需要重置序列

-- 输出清理结果
do $$
begin
  raise notice '✅ 所有数据已清空!';
  raise notice '   - wallpapers: 已清空';
  raise notice '   - wallpaper_tags: 已清空';
  raise notice '   - wallpaper_tag_relations: 已清空';
  raise notice '   - crawl_logs: 已清空';
  raise notice '';
  raise notice '📊 表结构、索引、视图、策略均保留';
end $$;
