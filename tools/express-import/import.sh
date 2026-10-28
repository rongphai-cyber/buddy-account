#!/bin/bash
# นำข้อมูลบริษัทจากโปรแกรม Express (.DBF) เข้า Buddy Account
# ใช้:  tools/express-import/import.sh <โฟลเดอร์ข้อมูล Express> <DATABASE_URL> [รหัสบริษัท]
# ตัวอย่าง: tools/express-import/import.sh D:/ACC-Program/TESTRice postgres://postgres:pw@localhost/buddy TESTRice
# ต้องมี: python3 + psycopg2 (pip install psycopg2-binary), Node 22 + pnpm
set -euo pipefail
SRC=$1; URL=$2; CODE=${3:-$(basename "$SRC")}
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../.." && pwd)
echo "1) อัปเดตโครงสร้างฐานข้อมูล"
( cd "$ROOT" && DATABASE_URL="$URL" pnpm --silent --filter @buddy/server cli migrate )
echo "2) ย้ายข้อมูลจาก $SRC"
python3 "$HERE/migrate_express.py" "$SRC" "$URL" "$CODE" > "$HERE/last_import_${CODE}.json"
CID=$(psql "$URL" -Atc "select id from sys_company where code = '${CODE:0:20}' and deleted_at is null")
echo "3) ใส่กฎการลงบัญชีให้บริษัท $CID"
( cd "$ROOT" && DATABASE_URL="$URL" pnpm --silent --filter @buddy/server cli company-template "$CID" )
echo "4) ตรวจกระทบยอดกับ Express"
python3 "$HERE/validate_migration.py" "$SRC" "$URL" > "$HERE/last_validate_${CODE}.json" || true
echo "เสร็จ — ผลอยู่ที่ $HERE/last_import_${CODE}.json และ last_validate_${CODE}.json"
