/**
 * 调用生产环境 crawler API
 */

const PRODUCTION_URL = 'https://flowall-api.sanyi.deno.net'
const ADMIN_API_KEY = Deno.env.get('ADMIN_API_KEY')

if (!ADMIN_API_KEY) {
  console.error('❌ 错误: 未找到 ADMIN_API_KEY 环境变量')
  Deno.exit(1)
}

async function triggerCrawl() {
  console.log('📡 正在调用生产环境 crawler API...')
  console.log(`🌐 目标地址: ${PRODUCTION_URL}/api/v1/admin/crawl`)

  try {
    const response = await fetch(`${PRODUCTION_URL}/api/v1/admin/crawl`, {
      method: 'POST',
      headers: {
        'X-API-Key': ADMIN_API_KEY!,
        'Content-Type': 'application/json',
      },
    })

    const data = await response.json()

    if (response.ok) {
      console.log('✅ 调用成功!')
      console.log('📦 响应数据:', JSON.stringify(data, null, 2))
    } else {
      console.error('❌ 调用失败!')
      console.error(`状态码: ${response.status}`)
      console.error('错误信息:', JSON.stringify(data, null, 2))
      Deno.exit(1)
    }
  } catch (error) {
    console.error('❌ 请求异常:', error)
    Deno.exit(1)
  }
}

// 执行调用
await triggerCrawl()
