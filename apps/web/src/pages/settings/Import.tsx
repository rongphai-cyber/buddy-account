import { PageHead } from '../../ui';

/** นำข้อมูลจาก Express — รุ่นนี้ใช้เครื่องมือบรรทัดคำสั่ง (หน้าจออัปโหลดอยู่ในแผน P7) */
export function ImportPage() {
  return (
    <div className="page narrow" data-tone="home">
      <PageHead eyebrow="อื่น ๆ › นำข้อมูลจาก Express" title="นำข้อมูลจากโปรแกรม Express" lead="อ่านแฟ้ม .DBF ของ Express โดยตรง (ภาษาไทย cp874) แล้วตรวจกระทบยอดกับ Express ให้อัตโนมัติ" />
      <section className="card">
        <h2>วิธีนำเข้า (ผู้ดูแลระบบ)</h2>
        <ol>
          <li>คัดลอกโฟลเดอร์ข้อมูลบริษัทของ Express (เช่น <code>D:\ACC-Program\TESTRice</code>) มาไว้ที่เครื่องที่ติดตั้ง Buddy Account</li>
          <li>รันคำสั่ง <code>tools/express-import/import.sh &lt;โฟลเดอร์ Express&gt; &lt;DATABASE_URL&gt; &lt;รหัสบริษัท&gt;</code></li>
          <li>ดูผลกระทบยอดใน <code>tools/express-import/last_validate_&lt;รหัส&gt;.json</code> — งบทดลอง ลูกหนี้ เจ้าหนี้ สต๊อก ต้องตรง Express</li>
          <li>กลับมาที่หน้านี้แล้วเลือกบริษัทจากแถบด้านบน</li>
        </ol>
        <p className="hint">ข้อมูลที่นำเข้า: บริษัท รอบบัญชี ผังบัญชี แผนก แฟ้มหลักทั้งหมด เอกสารซื้อขาย ใบสำคัญ ยอดยกมา ภาษีซื้อขาย ภาษีหัก ณ ที่จ่าย ทรัพย์สิน แบบงบการเงิน และค่าเริ่มต้น</p>
      </section>
    </div>
  );
}
