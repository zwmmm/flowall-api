import { Hono } from 'hono'
import wallpapersRouter from './wallpapers.ts'
import adminRouter from './admin.ts'

const router = new Hono()

// 挂载各个模块的路由
router.route('/wallpapers', wallpapersRouter)
router.route('/admin', adminRouter)

export default router
