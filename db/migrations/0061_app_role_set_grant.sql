-- 0061 สิทธิ์สลับเป็น buddy_app บน PostgreSQL 16 ขึ้นไป เมื่อผู้เชื่อมต่อไม่ใช่ superuser (เช่น role postgres ของ Supabase) — docs/20 ข้อ 4
-- PostgreSQL 16+: ผู้ใช้ที่มี CREATEROLE สร้าง role แล้วได้สิทธิ์ ADMIN บน role นั้นแต่ "SET ROLE ไม่ได้" (createrole_self_grant ว่าง)
-- 0007 เช็ค pg_has_role(…, 'MEMBER') ซึ่งเป็นจริงแล้วจึงข้าม GRANT → SET LOCAL ROLE buddy_app ล้มทุกคำขอ
-- ไม่เปลี่ยนโครงสร้าง · superuser / PGlite / PostgreSQL 15 = ไม่ทำอะไร · มอบไม่ได้ = server ตรวจแล้วใช้การกรองในโค้ด (เหมือน 0007)
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 160000 AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buddy_app') THEN
    IF NOT pg_has_role(current_user, 'buddy_app', 'SET') THEN
      EXECUTE format('GRANT buddy_app TO %I WITH SET TRUE', current_user);
    END IF;
  END IF;
EXCEPTION WHEN insufficient_privilege OR invalid_grant_operation THEN
  RAISE NOTICE 'มอบสิทธิ์ SET ROLE buddy_app ไม่ได้ — ใช้การกรองในโค้ดอย่างเดียว';
END $$;
