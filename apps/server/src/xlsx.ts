import { createZip } from './zip.js';

/**
 * สร้างแฟ้ม .xlsx หลายแผ่นงาน (แบบฟอร์มนำเข้า/ส่งออก) — แถวแรกเป็นหัวตาราง (ตัวหนา พื้นสี ตรึงแถว)
 * textCols = คอลัมน์ที่จัดรูปแบบเป็นข้อความ (เลขบัตร รหัส วันที่) ไม่ให้ Excel แปลงเป็นตัวเลข
 */
export interface XlsxSheet { name: string; rows: string[][]; textCols?: number[]; widths?: number[]; header?: boolean }
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i: number) => { let s = '', n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function sheetXml(s: XlsxSheet) {
  const text = new Set(s.textCols ?? []);
  const head = s.header !== false;
  const rows = s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = `${colName(ci)}${ri + 1}`, style = head && ri === 0 ? 1 : text.has(ci) ? 2 : 0;
    if (v === '') return style ? `<c r="${ref}" s="${style}"/>` : '';
    return !text.has(ci) && !(head && ri === 0) && /^-?\d+(\.\d+)?$/.test(v) ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const ncol = Math.max(1, ...s.rows.map((r) => r.length));
  const cols = `<cols>${Array.from({ length: ncol }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${s.widths?.[i] ?? 16}" customWidth="1"${text.has(i) ? ' style="2"' : ''}/>`).join('')}</cols>`;
  const pane = head ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
  return `${XML}<worksheet ${NS}>${pane}${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

export function buildXlsx(sheets: XlsxSheet[]): Buffer {
  const styles = `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFECE7FA"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const ct = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  const rels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const wb = `${XML}<workbook ${NS}><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  return createZip([
    { name: '[Content_Types].xml', data: ct },
    { name: '_rels/.rels', data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: wb },
    { name: 'xl/_rels/workbook.xml.rels', data: rels },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
    { name: 'xl/styles.xml', data: styles },
  ]);
}
