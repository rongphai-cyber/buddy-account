# Buddy Account — production image (Buddy docs/20 · HANDOFF 114–115) · ไม่มีความลับในไฟล์นี้: DATABASE_URL / กุญแจหลัก ใส่ตอนรัน (wrangler secret)
# ไม่มี RUN เลย: เครื่อง build ของ Cloudflare รัน RUN ไม่ได้ (runc … mounting "proc" … operation not permitted)
#   ก่อนไฟล์นี้: Workers Builds รัน pnpm install --frozen-lockfile (Linux) → wrangler build.command = node cloud/prebuild.mjs (สร้างหน้าจอ + ตรวจไฟล์ครบ)
#   ไฟล์นี้: คัดลอกทั้งโฟลเดอร์ (รวม node_modules และหน้าจอที่สร้างแล้ว — .dockerignore ไม่ตัดออก) แล้วรัน
# สร้างเองบนเครื่อง Linux ที่มี Docker: pnpm install --frozen-lockfile && node cloud/prebuild.mjs && docker build -t buddy .
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=4100 HOST=0.0.0.0
WORKDIR /app
COPY --chown=node:node . /app
# โฟลเดอร์ข้อมูลในเครื่อง (ใช้เมื่อไม่มี DATABASE_URL เท่านั้น) — .data ของเครื่องที่ build ไม่ถูกคัดลอก (.dockerignore)
COPY --chown=node:node cloud/data-dir/ /app/.data/
USER node
WORKDIR /app/apps/server
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4100/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# tsx เหมือนตอนรันบนเครื่อง (pnpm start) · migration รันตอนเปิดโปรแกรม
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/main.ts"]
