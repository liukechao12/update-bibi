#!/bin/bash
# Browserless 部署脚本（单容器 + 中文字体 + 动态代理）
# 位置：/mnt/mydisk/browserless/deploy.sh
set -euo pipefail

cd /mnt/mydisk/browserless || exit 1

echo "=== 步骤 1：构建 CJK 字体镜像 ==="
# 官方镜像不带中文字体，这里基于官方镜像补装
docker build -t browserless-cjk:1.0.0 .

echo "=== 步骤 2：重建容器 ==="
docker compose up -d --force-recreate

echo "=== 步骤 3：验证服务健康度 ==="
sleep 10
docker ps --filter name=browserless --format "{{.Names}} {{.Status}}"
curl -sf "http://127.0.0.1:3100/pressure?token=$(grep '^BROWSERLESS_TOKEN=' .env | cut -d= -f2-)" >/dev/null && echo "pressure OK" || echo "pressure FAIL（检查 .env 的 BROWSERLESS_TOKEN）"

echo "=== 部署完成 ==="
echo "截图服务：http://127.0.0.1:3100（小红书等代理域名由主程序自动注入动态代理）"
