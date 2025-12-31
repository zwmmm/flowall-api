#!/usr/bin/env bash

# 数据库 Migration 应用脚本

echo "📦 准备应用数据库 Migration..."

# 检查环境变量
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_KEY" ]; then
  echo "❌ 错误: 缺少必要的环境变量"
  echo "请设置: SUPABASE_URL 和 SUPABASE_SERVICE_KEY"
  exit 1
fi

# 读取 SQL 文件
MIGRATION_FILE="supabase/migrations/002_add_cover_url.sql"

if [ ! -f "$MIGRATION_FILE" ]; then
  echo "❌ 错误: Migration 文件不存在: $MIGRATION_FILE"
  exit 1
fi

echo "📄 读取 Migration: $MIGRATION_FILE"
SQL_CONTENT=$(cat "$MIGRATION_FILE")

# 使用 Supabase REST API 执行 SQL
echo "🚀 执行 Migration..."

RESPONSE=$(curl -s -X POST \
  "$SUPABASE_URL/rest/v1/rpc/exec_sql" \
  -H "apikey: $SUPABASE_SERVICE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $(echo "$SQL_CONTENT" | jq -Rs .)}")

if [ $? -eq 0 ]; then
  echo "✅ Migration 执行成功!"
  echo "响应: $RESPONSE"
else
  echo "❌ Migration 执行失败!"
  echo "错误: $RESPONSE"
  exit 1
fi

echo ""
echo "🎉 数据库 Migration 完成!"
echo ""
echo "⚠️ 注意: 如果你使用的是 Supabase 云服务,"
echo "建议直接在 Supabase Dashboard 的 SQL Editor 中执行 SQL 语句。"
