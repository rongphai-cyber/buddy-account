# Buddy Account — production image (Buddy docs/20 · S0) · ไม่มีความลับในไฟล์นี้: DATABASE_URL / BUDDY_SECRET_KEY / R2_* ใส่ตอนรัน (wrangler secret)
# สร้าง: docker build -t buddy-account .     รัน: docker run -p 4100:4100 -e DATABASE_URL=… -e BUDDY_SECRET_KEY=… buddy-account
# ไม่ใส่ DATABASE_URL = PGlite ใน /app/.data (หายเมื่อ container หยุด — ใช้ทดลองเท่านั้น)
FROM node:22-bookworm-slim AS build
ENV CI=1
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @buddy/web build

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=4100 HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
WORKDIR /app/apps/server
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4100/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# tsx เหมือนตอนรันบนเครื่อง (pnpm start) · migration รันตอนเปิดโปรแกรม
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/main.ts"]
