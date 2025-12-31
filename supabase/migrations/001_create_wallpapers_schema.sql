-- 创建壁纸主表
create table wallpapers (
  id uuid default gen_random_uuid() primary key,
  moewalls_id text unique not null,
  name text not null,
  description text,
  preview_url text not null,
  video_url text not null,
  status text default 'active' check (status in ('active', 'inactive')),
  crawled_at timestamp with time zone default timezone('utc'::text, now()) not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 创建标签表
create table wallpaper_tags (
  id uuid default gen_random_uuid() primary key,
  name text unique not null,
  slug text unique not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 创建壁纸-标签关联表
create table wallpaper_tag_relations (
  wallpaper_id uuid references wallpapers(id) on delete cascade,
  tag_id uuid references wallpaper_tags(id) on delete cascade,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (wallpaper_id, tag_id)
);

-- 创建爬取日志表
create table crawl_logs (
  id uuid default gen_random_uuid() primary key,
  status text not null check (status in ('success', 'failed', 'partial')),
  wallpapers_count integer default 0,
  new_count integer default 0,
  updated_count integer default 0,
  error_message text,
  started_at timestamp with time zone default timezone('utc'::text, now()) not null,
  completed_at timestamp with time zone
);

-- 创建索引以优化查询性能
create index idx_wallpapers_moewalls_id on wallpapers(moewalls_id);
create index idx_wallpapers_status on wallpapers(status);
create index idx_wallpapers_crawled_at on wallpapers(crawled_at desc);
create index idx_wallpapers_description on wallpapers using gin(to_tsvector('simple', description));
create index idx_wallpaper_tags_slug on wallpaper_tags(slug);
create index idx_wallpaper_tag_relations_wallpaper on wallpaper_tag_relations(wallpaper_id);
create index idx_wallpaper_tag_relations_tag on wallpaper_tag_relations(tag_id);
create index idx_crawl_logs_started_at on crawl_logs(started_at desc);

-- 启用 RLS (行级安全)
alter table wallpapers enable row level security;
alter table wallpaper_tags enable row level security;
alter table wallpaper_tag_relations enable row level security;
alter table crawl_logs enable row level security;

-- 创建策略: 所有人可读
create policy "Enable read access for all users" on wallpapers
  for select using (status = 'active');

create policy "Enable read access for all users" on wallpaper_tags
  for select using (true);

create policy "Enable read access for all users" on wallpaper_tag_relations
  for select using (true);

-- crawl_logs 只允许管理员读取 (这里暂时允许所有人读取,生产环境需要修改)
create policy "Enable read access for all users" on crawl_logs
  for select using (true);

-- 创建 updated_at 自动更新函数
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$ language plpgsql;

-- 为 wallpapers 表添加自动更新触发器
create trigger update_wallpapers_updated_at
  before update on wallpapers
  for each row
  execute function update_updated_at_column();

-- 创建视图: 带标签的壁纸列表 (优化查询性能)
create view wallpapers_with_tags as
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
