/**
 * สร้างแฟ้ม Excel (.xlsx) ในเครื่องผู้ใช้ — ใช้ส่งออกรายงานทุกรายงาน (เจ้าของ 17/11/2569 "รายงานทุกรายงานต้องส่งออกเป็น excel ได้")
 * ไม่พึ่งไลบรารี: zip แบบไม่บีบอัด (stored) + XML ของ SpreadsheetML · ใช้ได้ทั้งเบราว์เซอร์และ Node
 * ตัวเลขเป็นตัวเลขจริง (รูปแบบ #,##0.00) · ข้อความภาษาไทยเป็น UTF-8 · แถวตัวหนาสำหรับหัวตาราง/ยอดรวม
 */
export type XlsxValue = string | number | null | undefined;
export interface XlsxCellObj { v: XlsxValue; bold?: boolean; /** จำนวนคอลัมน์ที่รวมเซลล์ (colspan) */ span?: number }
export type XlsxCell = XlsxValue | XlsxCellObj;
export interface XlsxOutSheet { name: string; rows: XlsxCell[][]; widths?: number[]; /** ตรึงแถวบนสุดกี่แถว (หัวตาราง) */ freeze?: number }

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // อักขระควบคุมที่ XML ไม่รับ
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
export const xlsxColName = (i: number) => { let s = '', n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const isObj = (c: XlsxCell): c is XlsxCellObj => typeof c === 'object' && c !== null;

/** ข้อความตัวเลขแบบรายงาน → ตัวเลข: "1,234.50" · "(1,234.50)" = ลบ · "-12" · ไม่ใช่ตัวเลข = null */
export function reportNumber(s: string): number | null {
  const t = s.replace(/\s/g, '').replace(/^฿/, '');
  const m = /^(\()?(-)?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?(\))?$/.exec(t);
  if (!m || !!m[1] !== !!m[6]) return null;
  const n = Number(`${m[3]!.replace(/,/g, '')}${m[5] ?? ''}`);
  return m[1] || m[2] ? -n : n;
}

function sheetXml(s: XlsxOutSheet) {
  const merges: string[] = [];
  let ncol = 1;
  const rows = s.rows.map((r, ri) => {
    let ci = 0;
    const cells = r.map((c) => {
      const o: XlsxCellObj = isObj(c) ? c : { v: c };
      const ref = `${xlsxColName(ci)}${ri + 1}`;
      const span = Math.max(1, o.span ?? 1);
      if (span > 1) merges.push(`${ref}:${xlsxColName(ci + span - 1)}${ri + 1}`);
      ci += span;
      const v = o.v;
      if (v === null || v === undefined || v === '') return o.bold ? `<c r="${ref}" s="1"/>` : '';
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${o.bold ? 3 : 2}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${o.bold ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
    }).join('');
    ncol = Math.max(ncol, ci);
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join('');
  const cols = `<cols>${Array.from({ length: ncol }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${s.widths?.[i] ?? 16}" customWidth="1"/>`).join('')}</cols>`;
  const pane = s.freeze ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${s.freeze}" topLeftCell="A${s.freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '';
  const mc = merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  return `${XML}<worksheet ${NS}>${pane}${cols}<sheetData>${rows}</sheetData>${mc}</worksheet>`;
}

const STYLES = `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
  + '<fonts count="2"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs>'
  + '</styleSheet>';

/** สมุดงาน .xlsx (หลายแผ่นงาน) → ไบต์ของแฟ้ม */
export function buildXlsxBytes(sheets: XlsxOutSheet[]): Uint8Array {
  const used = new Set<string>();
  const names = sheets.map((s, i) => {
    let n = (s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || `Sheet${i + 1}`;
    while (used.has(n)) n = `${n.slice(0, 28)}_${i + 1}`;
    used.add(n);
    return n;
  });
  const ct = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';
  const rels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const wb = `${XML}<workbook ${NS}><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  return zipStored([
    { name: '[Content_Types].xml', data: ct },
    { name: '_rels/.rels', data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: wb },
    { name: 'xl/_rels/workbook.xml.rels', data: rels },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
    { name: 'xl/styles.xml', data: STYLES },
  ]);
}

/* ---------------- zip แบบไม่บีบอัด ---------------- */
let CRC: Uint32Array | null = null;
function crc32(b: Uint8Array) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function zipStored(files: Array<{ name: string; data: string | Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let off = 0;
  // วันที่ 1/1/2024 (รูปแบบ DOS) — เนื้อหาเหมือนกันทุกครั้ง
  const time = 0, date = ((2024 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, time, true); h.setUint16(12, date, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, time, true); c.setUint16(14, date, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, x) => s + x.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const x of all) { out.set(x, p); p += x.length; }
  return out;
}
