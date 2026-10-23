#!/bin/bash
# npm run build 之后执行：standalone 不会自带 static/public，缺了浏览器 chunk 全 404
set -e
cd "$(dirname "$0")"
cp -r .next/static .next/standalone/.next/static
[ -d public ] && { mkdir -p .next/standalone/public; cp -r public/. .next/standalone/public/; }
echo "standalone 静态资源已同步"
