#!/bin/bash
# นำข้อมูลบริษัทจากโปรแกรม Express (.DBF) เข้า Buddy Account
# ใช้:  tools/express-import/import.sh <โฟลเดอร์ข้อมูล Express> <DATABASE_URL หรือ -> [รหัสบริษัท]
#   ใส่ - แทน URL = ใช้ตัวแปร DATABASE_URL (เช่นรันผ่าน node tools/local-pg/pg.mjs run -- …)
# ตัวอย่าง: tools/express-import/import.sh D:/ACC-Program/TESTRice postgres://postgres:pw@localhost/buddy TESTRice
# ต้องมี: python3 + psycopg2 (pip install psycopg2-binary), Node 22 + pnpm
set -euo pipefail
export PYTHONUTF8=1   # Windows: เขียนผล JSON ภาษาไทยเป็น UTF-8
SRC=$1; URL=${2:--}; CODE=${3:-$(basename "$SRC")}
[ "$URL" = "-" ] && URL=${DATABASE_URL:?ไม่ได้ระบุ DATABASE_URL}
# Windows: ใช้ python ถ้าไม่มี python3
PY=${PYTHON:-$(command -v python3 >/dev/null 2>&1 && python3 -c '' 2>/dev/null && echo python3 || echo python)}
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../.." && pwd)
echo "1) อัปเดตโครงสร้างฐานข้อมูล"
( cd "$ROOT" && DATABASE_URL="$URL" pnpm --silent --filter @buddy/server cli migrate )
echo "2) ย้ายข้อมูลจาก $SRC"
"$PY" "$HERE/migrate_express.py" "$SRC" "$URL" "$CODE" > "$HERE/last_import_${CODE}.json"
CID=$("$PY" -c "import sys,psycopg2; c=psycopg2.connect(sys.argv[1]).cursor(); c.execute('select id from sys_company where code = %s and deleted_at is null', (sys.argv[2][:20],)); print(c.fetchone()[0])" "$URL" "$CODE")
echo "3) ใส่กฎการลงบัญชีให้บริษัท $CID"
( cd "$ROOT" && DATABASE_URL="$URL" pnpm --silent --filter @buddy/server cli company-template "$CID" )
echo "4) ตรวจกระทบยอดกับ Express"
"$PY" "$HERE/validate_migration.py" "$SRC" "$URL" > "$HERE/last_validate_${CODE}.json" || true
echo "เสร็จ — ผลอยู่ที่ $HERE/last_import_${CODE}.json และ last_validate_${CODE}.json"
