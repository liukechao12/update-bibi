#!/usr/bin/env bash
#
# 服务器更新脚本（免密 SSH 密钥）
# 用法：
#   ./scripts/deploy-server.sh          # 预演（dry-run），只打印将做什么，不改动服务器
#   ./scripts/deploy-server.sh --yes    # 真正执行：备份 → 上传源码 → 生成客户端 → 迁移 → 构建 → 重启
#
# 安全约束：
#   - 不写入、不上传、不覆盖服务器 .env（生产配置只保留在服务器）
#   - 不使用任何密码，依赖已配置的 SSH 密钥
#   - 构建失败则不重启 pm2，老进程继续对外服务
#   - 迁移前先在服务器打包一份代码备份，便于回滚

set -euo pipefail

# ===== 可配置项 =====
SSH_HOST="root@36.111.148.138"
SSH_PORT="22"
REMOTE_DIR="/www/wwwroot/data-sync-push-platform"
PM2_APP="data-sync-push-platform"
NODE_BIN="/www/server/nodejs/v22.13.0/bin"
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
LOG_FILE="${LOCAL_DIR}/deploy-${TIMESTAMP}.log"
# ====================

APPLY=0
[[ "${1:-}" == "--yes" ]] && APPLY=1

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -p "${SSH_PORT}")
RSYNC_SSH="ssh -o BatchMode=yes -p ${SSH_PORT}"
# 过滤 SSH 的 post-quantum 提示，保持输出干净；|| true 防止空输出时 grep 返回非零触发 pipefail
clean() { grep -v -i 'post-quantum\|store now, decrypt later\|may need to be upgraded\|openssh.com/pq' || true; }

# rsync 排除项：依赖、构建产物、生产配置、备份、业务文件、临时文件
EXCLUDES=(
  --exclude '.DS_Store'
  --exclude 'node_modules'
  --exclude '.next'
  --exclude '.env'
  --exclude '.env.*'
  --exclude 'backups'
  --exclude '*.xlsx'
  --exclude '*.log'
  --exclude 'tsconfig.tsbuildinfo'
  --exclude 'tmp-check-*'
  --exclude '.git'
)

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "${LOG_FILE}"; }

remote() {
  # 在服务器执行命令，自动带上 node 的 PATH
  ssh "${SSH_OPTS[@]}" "${SSH_HOST}" \
    "export PATH=${NODE_BIN}:\$PATH; cd ${REMOTE_DIR} && $*" 2>&1 \
    | clean | tee -a "${LOG_FILE}"
}

log "本地目录：${LOCAL_DIR}"
log "目标服务器：${SSH_HOST}:${REMOTE_DIR}"
log "pm2 应用：${PM2_APP}"
if [[ ${APPLY} -eq 0 ]]; then
  log "模式：预演 dry-run（不会改动服务器）。确认无误后加 --yes 执行。"
else
  log "模式：正式执行 --yes"
fi

# ---- 步骤 0：连通性与前置检查 ----
log "== 步骤 0：检查 SSH 连通性与服务器环境 =="
ssh "${SSH_OPTS[@]}" "${SSH_HOST}" "echo SSH_OK; test -d ${REMOTE_DIR} && echo DIR_OK || echo DIR_MISSING" \
  2>&1 | grep -v -i 'post-quantum\|store now, decrypt later\|may need to be upgraded\|openssh.com/pq' | tee -a "${LOG_FILE}"

if [[ ${APPLY} -eq 0 ]]; then
  log "== dry-run：以下是将被同步的文件（不含 .env / node_modules / .next / backups）=="
  rsync -azni --delete -e "${RSYNC_SSH}" "${EXCLUDES[@]}" \
    "${LOCAL_DIR}/src" "${LOCAL_DIR}/prisma" "${LOCAL_DIR}/scripts" \
    "${LOCAL_DIR}/package.json" "${LOCAL_DIR}/package-lock.json" \
    "${LOCAL_DIR}/next.config.mjs" "${LOCAL_DIR}/tsconfig.json" \
    "${LOCAL_DIR}/prisma.config.ts" "${LOCAL_DIR}/next-env.d.ts" \
    "${SSH_HOST}:${REMOTE_DIR}/" 2>&1 | clean | tee -a "${LOG_FILE}"
  log "dry-run 结束。执行 './scripts/deploy-server.sh --yes' 正式更新。"
  exit 0
fi

# ---- 步骤 1：服务器端代码备份 ----
log "== 步骤 1：在服务器打包当前代码备份 =="
BACKUP_PATH="/www/backup/data-sync-code-${TIMESTAMP}.tar.gz"
remote "mkdir -p /www/backup && tar czf ${BACKUP_PATH} \
  --exclude='node_modules' --exclude='.next' \
  src prisma scripts package.json next.config.mjs tsconfig.json 2>/dev/null; \
  ls -lh ${BACKUP_PATH}"
log "备份已生成：${BACKUP_PATH}"

# ---- 步骤 2：上传源码 ----
log "== 步骤 2：上传源码（src / prisma / scripts + 配置文件）=="
rsync -az --delete -e "${RSYNC_SSH}" "${EXCLUDES[@]}" \
  "${LOCAL_DIR}/src" "${LOCAL_DIR}/prisma" \
  "${SSH_HOST}:${REMOTE_DIR}/" 2>&1 | clean | tee -a "${LOG_FILE}"
# scripts 不做 --delete，避免误删服务器上你可能单独放的辅助脚本
rsync -az -e "${RSYNC_SSH}" "${EXCLUDES[@]}" \
  "${LOCAL_DIR}/scripts" \
  "${SSH_HOST}:${REMOTE_DIR}/" 2>&1 | clean | tee -a "${LOG_FILE}"
# 配置文件逐个覆盖（不删除）
rsync -az -e "${RSYNC_SSH}" "${EXCLUDES[@]}" \
  "${LOCAL_DIR}/package.json" "${LOCAL_DIR}/package-lock.json" \
  "${LOCAL_DIR}/next.config.mjs" "${LOCAL_DIR}/tsconfig.json" \
  "${LOCAL_DIR}/prisma.config.ts" "${LOCAL_DIR}/next-env.d.ts" \
  "${SSH_HOST}:${REMOTE_DIR}/" 2>&1 | clean | tee -a "${LOG_FILE}"
log "源码上传完成。"

# ---- 步骤 3：生成 Prisma 客户端 + 数据库迁移 ----
log "== 步骤 3：prisma generate + migrate deploy =="
remote "npx prisma generate && npx prisma migrate deploy"

# ---- 步骤 4：构建（失败则中止，不重启）----
log "== 步骤 4：npm run build（构建失败将保留老进程，不重启）=="
if ! remote "npm run build"; then
  log "!!! 构建失败：已中止，未重启 pm2，线上仍在运行旧版本。"
  log "!!! 如需回滚代码：ssh ${SSH_HOST} 'cd ${REMOTE_DIR} && tar xzf ${BACKUP_PATH}' 然后重新 build + pm2 restart。"
  exit 1
fi
log "构建成功。"

# ---- 步骤 5：重启 pm2 ----
log "== 步骤 5：pm2 restart ${PM2_APP} =="
remote "pm2 restart ${PM2_APP} && sleep 3 && pm2 status ${PM2_APP}"

# ---- 步骤 6：健康检查 ----
log "== 步骤 6：健康检查 =="
# 真实端口以 pm2 保存的环境为准（本应用 PORT=4000，.env 未写 PORT，3000 是 nginx 反代）
remote "PORT=\$(pm2 env 0 2>/dev/null | awk -F': ' '/^PORT:/{print \$2; exit}'); \
  [ -z \"\$PORT\" ] && PORT=\$(grep -E '^PORT=' .env 2>/dev/null | head -1 | cut -d= -f2); \
  PORT=\${PORT:-3000}; \
  echo 检查应用端口 \$PORT; \
  curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:\$PORT/api/health || echo 'curl 失败（稍后用 pm2 logs 查看）'"

log "== 更新完成 =="
log "代码备份：${BACKUP_PATH}"
log "本地日志：${LOG_FILE}"
log "如需查看运行日志：ssh ${SSH_HOST} 'export PATH=${NODE_BIN}:\$PATH; pm2 logs ${PM2_APP} --lines 50'"
