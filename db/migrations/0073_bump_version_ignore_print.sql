-- 0073 แก้พร้อมกันสองคน (HANDOFF 163): รุ่นของแถว (row_version) ไม่เพิ่มเมื่อเปลี่ยนเฉพาะจำนวนครั้งที่พิมพ์ — การพิมพ์เอกสารไม่ทำให้คนที่กำลังแก้ได้คำเตือนว่า "ถูกแก้ไขโดย…"
CREATE OR REPLACE FUNCTION sys_bump_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    IF TG_TABLE_NAME IN ('doc_header', 'gl_journal', 'tax_wht_entry', 'md_serial')
       AND (to_jsonb(NEW) - 'print_count' - 'last_printed_by' - 'last_printed_at' - 'updated_at' - 'updated_by')
           IS NOT DISTINCT FROM (to_jsonb(OLD) - 'print_count' - 'last_printed_by' - 'last_printed_at' - 'updated_at' - 'updated_by') THEN
      RETURN NEW;
    END IF;
    NEW.row_version := OLD.row_version + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;
