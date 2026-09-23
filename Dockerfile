# ============ Stage 1: 构建前端 ============
FROM node:22-alpine AS web-builder
WORKDIR /build/web
# 先装依赖（利用层缓存）
COPY web/package*.json ./
RUN npm install --no-audit --no-fund
# 再构建
COPY web/ ./
RUN npm run build

# ============ Stage 2: 后端运行时 ============
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=Asia/Shanghai

# 安装后端生产依赖
COPY server/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund \
  && npm cache clean --force

# 后端源码
COPY server/ ./

# 前端构建产物（后端静态托管）
COPY --from=web-builder /build/web/dist ./public

# 数据卷（SQLite + 备份）
RUN mkdir -p /app/data/backups
VOLUME ["/app/data"]

EXPOSE 8080
# 简单健康检查：API 可达即健康
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
