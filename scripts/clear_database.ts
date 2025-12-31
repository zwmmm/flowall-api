/**
 * ⚠️ 危险操作: 清空所有数据库数据
 * 此脚本将删除所有表中的数据,但保留表结构
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// 手动加载 .env 文件
const envContent = await Deno.readTextFile('.env')
envContent.split('\n').forEach((line) => {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return
  const [key, ...values] = trimmed.split('=')
  if (key && values.length > 0) {
    Deno.env.set(key, values.join('='))
  }
})

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_KEY')

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ 缺少环境变量: SUPABASE_URL 或 SUPABASE_SERVICE_KEY')
  Deno.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

console.log('⚠️  警告: 即将清空所有数据库数据!')
console.log('📊 当前数据统计:\n')

// 统计当前数据量
async function getDataStats() {
  const stats: Record<string, number> = {}

  const { count: wallpapersCount } = await supabase
    .from('wallpapers')
    .select('*', { count: 'exact', head: true })
  stats.wallpapers = wallpapersCount || 0

  const { count: tagsCount } = await supabase
    .from('wallpaper_tags')
    .select('*', { count: 'exact', head: true })
  stats.tags = tagsCount || 0

  const { count: relationsCount } = await supabase
    .from('wallpaper_tag_relations')
    .select('*', { count: 'exact', head: true })
  stats.relations = relationsCount || 0

  const { count: logsCount } = await supabase
    .from('crawl_logs')
    .select('*', { count: 'exact', head: true })
  stats.logs = logsCount || 0

  return stats
}

const stats = await getDataStats()
console.log(`  壁纸数据: ${stats.wallpapers} 条`)
console.log(`  标签数据: ${stats.tags} 条`)
console.log(`  关联关系: ${stats.relations} 条`)
console.log(`  爬取日志: ${stats.logs} 条`)
console.log('')

// 等待用户确认
console.log('⚠️  此操作不可逆! 请输入 "DELETE" 确认删除所有数据:')

const buf = new Uint8Array(1024)
const n = await Deno.stdin.read(buf)
const input = new TextDecoder().decode(buf.subarray(0, n || 0)).trim()

if (input !== 'DELETE') {
  console.log('❌ 操作已取消')
  Deno.exit(0)
}

console.log('\n🗑️  开始清空数据...\n')

// 按顺序删除数据
try {
  // 1. 删除关联表
  console.log('  清空 wallpaper_tag_relations...')
  const { error: relError } = await supabase
    .from('wallpaper_tag_relations')
    .delete()
    .neq('wallpaper_id', '00000000-0000-0000-0000-000000000000') // 删除所有记录的技巧

  if (relError) throw relError
  console.log('  ✅ wallpaper_tag_relations 已清空')

  // 2. 删除壁纸
  console.log('  清空 wallpapers...')
  const { error: wallError } = await supabase
    .from('wallpapers')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')

  if (wallError) throw wallError
  console.log('  ✅ wallpapers 已清空')

  // 3. 删除标签
  console.log('  清空 wallpaper_tags...')
  const { error: tagsError } = await supabase
    .from('wallpaper_tags')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')

  if (tagsError) throw tagsError
  console.log('  ✅ wallpaper_tags 已清空')

  // 4. 删除日志
  console.log('  清空 crawl_logs...')
  const { error: logsError } = await supabase
    .from('crawl_logs')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')

  if (logsError) throw logsError
  console.log('  ✅ crawl_logs 已清空')

  console.log('\n✅ 所有数据已成功清空!')
  console.log('📊 表结构、索引、视图、策略均保留')

} catch (error) {
  console.error('\n❌ 清空数据时出错:', error)
  Deno.exit(1)
}
