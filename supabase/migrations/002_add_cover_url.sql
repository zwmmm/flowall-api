-- 添加 cover_url 字段到 wallpapers 表
alter table wallpapers add column cover_url text;

-- 设置 cover_url 为 not null
alter table wallpapers alter column cover_url set not null;

-- 删除旧视图
drop view if exists wallpapers_with_tags;

-- 重新创建视图以包含 cover_url
create view wallpapers_with_tags as
select
  w.id,
  w.moewalls_id,
  w.name,
  w.description,
  w.cover_url,
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