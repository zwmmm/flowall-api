// Supabase 客户端配置
export const supabaseConfig = {
  url: Deno.env.get('SUPABASE_URL')!,
  anonKey: Deno.env.get('SUPABASE_ANON_KEY')!,
}

// 验证配置
export function validateSupabaseConfig() {
  if (!supabaseConfig.url) {
    throw new Error('SUPABASE_URL is required')
  }
  if (!supabaseConfig.anonKey) {
    throw new Error('SUPABASE_ANON_KEY is required')
  }
}
