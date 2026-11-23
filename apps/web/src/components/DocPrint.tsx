import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import { bahtTextEn, COPY_ORIGINAL, defaultLayout, fmt, formatDate, formatDateEn, PRINT_HEAD_FIELDS, PRINT_WORDS_EN as EN, printLabelEn, printPartyLabel, printTextEn, sheetCopies, type PrintAlign, type PrintFamily, type PrintFormEntry, type PrintVAlign, type YearSystem } from '@buddy/core';
import { CloseScreen, DocDelete } from './DocDelete';
import { api } from '../api';
import type { CompanyImages } from './CompanyImages';
import { useCan, useSession } from '../session';
import { DateInput, ErrorBox, Field, Modal, Pill, toast, toastError, useHotkeys, useYearSystem } from '../ui';
import { DocNotesDialog } from './Notes';
import { PrintJob } from '../printFrame';
import { PagedSheets } from '../printPages';
import { ensurePrintFont, printFontStack } from '../printFonts';

export interface PrintData {
  kind: 'doc' | 'journal'; scope: string; family: PrintFamily; title: string; title_en: string; doc_no: string; doc_date: string; cancelled: boolean;
  /** address_en = ที่อยู่ภาษาอังกฤษของบริษัท (แบบฟอร์มภาษาอังกฤษ · ว่าง = ใช้ที่อยู่ไทย) */
  company: { name: string; name_en: string; address: string; address_en?: string; phone: string; tax_id: string; branch: string };
  party: { code: string; name: string; address: string; phone: string; tax_id: string; branch: string } | null;
  fields: Record<string, string>; lines: Array<Record<string, string>>; totals: Array<{ label: string; value: string; value2?: string }>;
  amount_text: string; payments: Array<{ method: string; ref: string; date: string; amount: string }>; notes: string[];
  journal: Array<Record<string, string>>; print_count: number; approved: boolean;
  /** ใบเสร็จ: ตัดบิลภาษีเกณฑ์เงินสด = ใบเสร็จรับเงิน/ใบกำกับภาษี · detail = บิลพร้อมรายการสินค้า/บริการ (kind bill/item) */
  receipt_tax?: boolean; detail?: Array<Record<string, string>>;
  /** ใบเสร็จแบบรายการสินค้า (HANDOFF 153): แถวสินค้า/บริการของบิล (คอลัมน์แบบใบแจ้งหนี้) + ยอดรวมตามบิลเดิม · เลขที่บิลอยู่ที่ fields.ref_docs */
  items?: Array<Record<string, string>>; item_totals?: Array<{ label: string; value: string }>;
}
type PrintResp = { data: PrintData; forms: PrintFormEntry[]; rule: { approveLevel: number; method: string | null; reprintLevel: number }; block: string | null; images?: CompanyImages };

const MONEY_KEYS = new Set(['price', 'amount', 'ref_amount', 'debit', 'credit']);
const DATE_KEYS = new Set(['ref_date', 'due_date', 'date']);
const DATE_FIELDS = new Set(['due_date', 'delivery_date', 'appointment_date', 'payment_date']);
/** วันที่บนแผ่น: ไทย = ตามระบบปีของบริษัท (dd/mm/พ.ศ.) · อังกฤษ = 19 Nov 2026 */
const dateOf = (v: string, ys: YearSystem, en: boolean) => (en ? formatDateEn(v) : formatDate(v, ys));
const cellText = (key: string, v: string | undefined, ys: YearSystem, en = false) => (!v ? '' : MONEY_KEYS.has(key) ? fmt(v) : DATE_KEYS.has(key) ? dateOf(v, ys, en) : v);
/** ขนาด/สีเฉพาะส่วนของแบบฟอร์ม — ไม่ได้ตั้ง = undefined (DOM เหมือนเดิม) */
const sty = (pt: number, color: string): CSSProperties | undefined => (pt >= 6 || color ? { ...(pt >= 6 ? { fontSize: `${pt}pt` } : {}), ...(color ? { color } : {}) } : undefined);
/** สีตัวอักษรบนแถบสี (ไม่ได้ตั้ง) = ดำ/ขาวตามความสว่างของแถบ */
const inkOn = (hex: string) => { const n = parseInt(hex.slice(1), 16); const [r, g, b] = [n >> 16 & 255, n >> 8 & 255, n & 255]; return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#1d1d24' : '#ffffff'; };

/**
 * แผ่นเอกสารตามแบบฟอร์ม — ใช้ทั้งดูทางจอภาพและพิมพ์ (หนึ่งแผ่นต่อสำเนา)
 * prior = ครั้งที่พิมพ์ไปแล้วก่อนครั้งนี้ (พิมพ์ซ้ำ = "ต้นฉบับ" เป็น "สำเนา" · sheetCopies) — ไม่ส่ง = ตามข้อมูลเอกสาร (ดูทางจอภาพ = หน้าตาของการพิมพ์ครั้งถัดไป)
 * HANDOFF 151: ตำแหน่ง/ขนาด/สีของส่วนหัว · สีแถบและตัวอักษรในตาราง · ภาษาอังกฤษ — ค่าเริ่มต้นได้หน้าตา (DOM) เดิมทุกอย่าง
 */
export function PrintSheet({ data, form, ys, images, prior }: { data: PrintData; form: PrintFormEntry; ys: YearSystem; images?: CompanyImages | null; prior?: number }) {
  const L = form.layout;
  const en = L.lang === 'en';
  // ใบเสร็จ: แสดงรายการสินค้า/บริการของบิล (ฟอร์มเลือก หรืออัตโนมัติเมื่อเป็นใบกำกับภาษี)
  // HANDOFF 153: แถวสินค้า/บริการตามบิลเดิม (คอลัมน์แบบใบแจ้งหนี้ของต้นแบบเดียวกัน) · เลขที่บิลเป็นเอกสารอ้างอิงที่หัวเอกสาร · ยอดรวมตามบิลเดิม (item_totals)
  const items = data.family === 'settle' && !!data.items && (L.settle_detail === 'items' || (L.settle_detail !== 'bills' && !!data.receipt_tax));
  const lines = items ? data.items! : data.lines;
  const shown = items ? defaultLayout('IV', form.base).columns.filter((c) => c.show) : L.columns.filter((c) => c.show);
  const totals = items && data.item_totals ? data.item_totals : data.totals;
  const refDocs = items ? (data.fields.ref_docs ?? '').split(', ').filter(Boolean) : [];
  // เจ้าของ 19/11/2569 "กรณีไม่มีส่วนลด ไม่ต้องแสดงส่วนลด": ไม่มีบรรทัดใดมีส่วนลด = ซ่อนคอลัมน์ส่วนลด ให้ความกว้างแก่รายละเอียด
  // (ยอดรวม: server ใส่บรรทัดส่วนลด/หลังหักส่วนลด/ส่วนลดเงินสด เฉพาะเมื่อมียอด)
  const hasDisc = lines.some((l) => { const v = (l.disc ?? '').trim(); return !!v && !/^[0.,%\s]+$/.test(v); });
  const discCol = hasDisc ? undefined : shown.find((c) => c.key === 'disc');
  const cols = discCol ? shown.filter((c) => c !== discCol).map((c) => (c.key === 'name' ? { ...c, width: c.width + discCol.width } : c)) : shown;
  const totalW = cols.reduce((s, c) => s + c.width, 0) || 1;
  // ใบเสร็จรับเงิน/ใบกำกับภาษี: แบบฟอร์มไม่มีคำกำกับ = แผ่นเดียวกำกับ "ต้นฉบับ" (พิมพ์ซ้ำ = "สำเนา" ตาม sheetCopies)
  const sc = sheetCopies(L, prior ?? data.print_count);
  const copies = data.receipt_tax && sc.length === 1 && !sc[0] ? [COPY_ORIGINAL] : sc;
  const fill = Math.max(0, L.min_rows - lines.length - lines.filter((l) => l.note).length);
  // หมายเหตุรายการเริ่มใต้คอลัมน์รายละเอียด (ไม่มี = ใต้คอลัมน์ที่ 2)
  const noteAt = Math.max(0, cols.findIndex((c) => c.key === 'name')) || Math.min(1, cols.length - 1);
  const heads = L.head_fields.map((k) => { const f = PRINT_HEAD_FIELDS.find((x) => x.key === k); return { k, label: (en ? f?.label_en : f?.label) ?? k, v: data.fields[k] ?? '' }; }).filter((x) => x.v);
  const isJ = data.family === 'journal';
  // ชื่ออังกฤษตามชนิดเอกสาร (INVOICE / TAX INVOICE · RECEIPT · PAYMENT VOUCHER …) เมื่อแบบฟอร์มไม่ได้ตั้งหัวเรื่องเอง
  // ใบเสร็จรับเงิน/ใบกำกับภาษี: หัวเรื่องที่แบบฟอร์มตั้งเองต้องมีคำว่า "ใบกำกับภาษี" (ม.86/4 (1)) ไม่งั้นใช้ชื่อมาตรฐาน
  const formTitle = data.receipt_tax && L.title && !L.title.includes('ใบกำกับภาษี') ? '' : L.title;
  const titleEn = !formTitle || formTitle === data.title ? data.title_en : '';
  const thTitle = formTitle || data.title;
  const enTitle = (formTitle && L.title_en) || titleEn;
  // แบบฟอร์มภาษาอังกฤษ: ชื่ออังกฤษเป็นหัวเรื่อง · ชื่อไทยบรรทัดรอง (ใบกำกับภาษียังมีคำว่า "ใบกำกับภาษี")
  const [mainTitle, subTitle] = en ? [enTitle || L.title_en || thTitle, enTitle || L.title_en ? thTitle : ''] : [thTitle, enTitle];
  const partyLabel = printPartyLabel(data.scope);
  const partyText = en ? (partyLabel === 'ผู้จำหน่าย' ? EN.supplier : partyLabel ? EN.customer : '') : partyLabel;
  // โลโก้/ลายเซ็นของบริษัท (ข้อกำหนดเจ้าของ) — แบบฟอร์มเลือกตำแหน่งโลโก้ และรูปลายเซ็นของแต่ละช่องลงชื่อ
  const logo = L.logo !== 'none' ? images?.logo ?? null : null;
  const signOf = (i: number) => { const id = L.signature_images[i]; return id ? images?.signs[id]?.data ?? null : null; };
  const co = data.company;
  const coName = en ? co.name_en || co.name : co.name;
  const coName2 = en ? (co.name_en ? co.name : '') : co.name_en;
  const coInfo = sty(L.co_info_pt, L.co_info_color);
  const coLine = en ? [co.phone && `${EN.tel} ${co.phone}`, co.tax_id && `${EN.taxId} ${co.tax_id}`, printTextEn(co.branch)] : [co.phone && `โทร ${co.phone}`, co.tax_id && `เลขประจำตัวผู้เสียภาษี ${co.tax_id}`, co.branch];
  // ชื่อบริษัทบรรทัดที่สอง (HANDOFF 152): ตั้งขนาด/สีเองได้ · ไม่ได้ตั้ง = ตามที่อยู่บริษัท (DOM เดิม)
  const name2Style = L.co_name2_pt >= 6 || L.co_name2_color ? sty(L.co_name2_pt >= 6 ? L.co_name2_pt : L.co_info_pt, L.co_name2_color || L.co_info_color) : coInfo;
  const coBlock = L.show_company && <div className="ds-co"><b style={sty(L.co_name_pt, L.co_name_color)}>{coName}</b>{coName2 && <div style={name2Style}>{coName2}</div>}
    <div style={coInfo}>{en ? co.address_en || co.address : co.address}</div>
    <div style={coInfo}>{coLine.filter(Boolean).join('  ')}</div></div>;
  const titleBlock = (cp: string) => <div className="ds-title"><h1 style={sty(L.title_pt, L.title_color)}>{mainTitle}</h1>{subTitle && <div className="ds-en">{subTitle}</div>}
    {cp && <div className="ds-copy">{en ? printTextEn(cp) : cp}</div>}{data.cancelled && <div className="ds-void">{en ? EN.cancelled : 'ยกเลิก'}</div>}</div>;
  const logoImg = <img className="ds-logo" src={logo ?? ''} alt="" style={{ height: `${L.logo_mm}mm` }} />;
  // ส่วนหัวแบบเดิม (ชื่อบริษัทซ้ายบน ชื่อเอกสารขวาบน · โลโก้ซ้าย/ขวา/กลางบน) = DOM เดิม
  const allTop = L.co_v === 'top' && L.title_v === 'top' && (L.logo_v === 'top' || L.logo === 'none' || !logo);
  const stdHead = allTop && L.co_align === 'left' && L.title_align === 'right';
  const logoAbove = !!logo && stdHead && L.logo === 'center';
  const head = (cp: string): ReactNode => {
    if (stdHead) return <header className="ds-head">
      {logo && L.logo === 'left' && logoImg}{coBlock}{titleBlock(cp)}{logo && L.logo === 'right' && logoImg}</header>;
    return gridHead(cp);
  };
  /**
   * ส่วนหัว 9 ช่อง (HANDOFF 152): คอลัมน์ ซ้าย/กลาง/ขวา × แถว บน/กลาง/ล่าง — ไม่ทับกันทุกกรณี (ข้อความขึ้นบรรทัดใหม่แทน)
   * ช่องเดียวกัน: ชื่อบริษัทแล้วชื่อเอกสารเรียงลงมา · โลโก้อยู่ข้างข้อความ (ซ้าย = หน้า · ขวา = หลัง · กลาง = เหนือ)
   */
  const gridHead = (cp: string): ReactNode => {
    const items: Array<{ k: 'logo' | 'co' | 'title'; h: PrintAlign; v: PrintVAlign }> = [];
    if (logo && L.logo !== 'none') items.push({ k: 'logo', h: L.logo, v: L.logo_v });
    if (coBlock) items.push({ k: 'co', h: L.co_align, v: L.co_v });
    items.push({ k: 'title', h: L.title_align, v: L.title_v });
    const hs = (['left', 'center', 'right'] as PrintAlign[]).filter((h) => items.some((x) => x.h === h));
    const mid = hs.includes('center');
    // มีช่องกลาง = 3 คอลัมน์ (กลางอยู่กลางแผ่นเสมอ) · ไม่มี = เฉพาะคอลัมน์ที่ใช้ แบ่งที่ว่างเท่า ๆ กัน
    const tpl = mid ? 'minmax(0, 1fr) minmax(0, max-content) minmax(0, 1fr)' : hs.map(() => 'minmax(0, max-content)').join(' ');
    const just = !mid && hs.length === 1 ? (hs[0] === 'right' ? 'end' : 'start') : 'space-between';
    return <header className="ds-head ds-head-g" style={{ gridTemplateColumns: tpl, justifyContent: just }}>
      {hs.map((h, ci) => <div key={h} className={`ds-col ds-col-${h}`} style={{ gridColumn: mid ? (['left', 'center', 'right'] as PrintAlign[]).indexOf(h) + 1 : ci + 1 }}>
        {(['top', 'middle', 'bottom'] as PrintVAlign[]).map((v) => {
          const here = items.filter((x) => x.h === h && x.v === v);
          if (!here.length) return null;
          const lg = here.some((x) => x.k === 'logo');
          const txt = here.some((x) => x.k !== 'logo') && <div className="ds-txt">{here.some((x) => x.k === 'co') && coBlock}{here.some((x) => x.k === 'title') && titleBlock(cp)}</div>;
          return <div key={v} className={`ds-cell ds-cell-${v}`}>{lg && h !== 'right' && logoImg}{txt}{lg && h === 'right' && logoImg}</div>;
        })}
      </div>)}
    </header>;
  };
  // สีแถบหัวตาราง/ยอดรวมทั้งสิ้น · ตัวอักษรในตาราง · แถบบนสุด · แบบอักษร (ตัวแปร CSS ที่แผ่น — ไม่ได้ตั้ง = ไม่มี)
  const band = !!(L.band_color || L.band_text_color);
  useEffect(() => { ensurePrintFont(L.font); }, [L.font]);
  const sheetStyle: CSSProperties = { fontSize: `${L.font_pt}pt`,
    ...(L.font ? { fontFamily: printFontStack(L.font) } : {}),
    ...(band ? { '--band': L.band_color || undefined, '--band-ink': L.band_text_color || (L.band_color ? inkOn(L.band_color) : undefined) } as CSSProperties : {}),
    ...(L.body_color ? { '--body-ink': L.body_color } as CSSProperties : {}),
    ...(L.top_bar && L.top_bar !== 'none' ? { '--topbar': L.top_bar } as CSSProperties : {}) };
  const sheetCls = `doc-sheet b-${form.base}${band ? ' has-band' : ''}${L.body_color ? ' has-body-ink' : ''}${L.top_bar === 'none' ? ' no-topbar' : ''}`;
  const bodySize: CSSProperties | undefined = L.body_pt >= 6 ? { fontSize: `${L.body_pt}pt` } : undefined;
  const amountText = data.amount_text ? (en ? bahtTextEn(totals.at(-1)?.value ?? '0') : data.amount_text) : '';
  const lab = (th: string) => (en ? printLabelEn(th) : th);
  return (
    <>
      {copies.map((cp, ci) => (
        <div key={ci} className={sheetCls} style={sheetStyle} lang={en ? 'en' : undefined} data-font={L.font || undefined} data-blank={L.blank_area}>
          {logoAbove && <div className="ds-logo-c"><img src={logo} alt="" style={{ height: `${L.logo_mm}mm` }} /></div>}
          {head(cp)}
          <div className="ds-info">
            {L.show_party && data.party ? <div className="ds-party">
              {partyText && <div className="ds-label">{partyText}</div>}
              <div><b>{data.party.name}</b>{data.party.code && <span className="ds-muted"> ({data.party.code})</span>}</div>
              {data.party.address && <div>{data.party.address}</div>}
              {(data.party.tax_id || data.party.branch) && <div>{data.party.tax_id && `${en ? EN.taxId : 'เลขประจำตัวผู้เสียภาษี'} ${data.party.tax_id}`} {en ? printTextEn(data.party.branch) : data.party.branch}</div>}
              {data.party.phone && <div>{en ? EN.tel : 'โทร'} {data.party.phone}</div>}
            </div> : <div />}
            <table className="ds-meta"><tbody>
              <tr><th>{en ? EN.no : 'เลขที่'}</th><td>{data.doc_no}</td></tr>
              <tr><th>{en ? EN.date : 'วันที่'}</th><td>{dateOf(data.doc_date, ys, en)}</td></tr>
              {refDocs.length > 0 && <tr><th>{en ? EN.refDocs : 'อ้างอิง'}</th><td className="ds-refs">{refDocs.map((r, i) => {
                // "IV0000137 (04/11/2569)" never breaks · a "partly paid" note after it may wrap
                const t = (en ? printTextEn(r) : r).replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (x) => dateOf(x, ys, en));
                const k = t.indexOf(')') + 1;
                return <span key={i}>{i > 0 && ', '}<span className="nw">{k > 0 ? t.slice(0, k) : t}</span>{k > 0 && t.slice(k)}</span>;
              })}</td></tr>}
              {heads.map((h) => <tr key={h.k}><th>{h.label}</th><td>{DATE_FIELDS.has(h.k) ? dateOf(h.v, ys, en) : h.v.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (x) => dateOf(x, ys, en))}</td></tr>)}
            </tbody></table>
          </div>
          <table className="ds-lines" style={bodySize}>
            <colgroup>{cols.map((c) => <col key={c.key} style={{ width: `${(c.width / totalW) * 100}%` }} />)}</colgroup>
            <thead><tr>{cols.map((c) => <th key={c.key} className={c.align}>{en ? c.label_en || c.label : c.label}</th>)}</tr></thead>
            <tbody>
              {lines.map((l, i) => <Fragment key={i}><tr className={l.kind === 'bill' && items ? 'ds-bill' : l.kind === 'item' ? 'ds-item' : undefined}>{cols.map((c) => <td key={c.key} className={c.align}>{cellText(c.key, l[c.key], ys, en)}</td>)}</tr>
                {l.note && <tr className="ds-line-note">{cols.slice(0, noteAt).map((c) => <td key={c.key} />)}<td colSpan={cols.length - noteAt}>{l.note}</td></tr>}</Fragment>)}
              {[...Array(fill).keys()].map((i) => <tr key={`f${i}`} className="ds-fill">{cols.map((c) => <td key={c.key}>&nbsp;</td>)}</tr>)}
            </tbody>
            {isJ && data.totals[0] && <tfoot><tr>{cols.map((c, i) => <td key={c.key} className={c.align}>{c.key === 'debit' ? fmt(data.totals[0]!.value) : c.key === 'credit' ? fmt(data.totals[0]!.value2 ?? '') : i === 0 ? (en ? EN.total : 'รวม') : ''}</td>)}</tr></tfoot>}
          </table>
          <div className="ds-sum">
            <div className="ds-left">
              {L.show_amount_text && amountText && <div className="ds-baht">({amountText})</div>}
              {L.show_payments && data.payments.length > 0 && <table className="ds-pay"><tbody>{data.payments.map((p, i) => <tr key={i}><td>{lab(p.method)}</td><td>{p.ref}</td><td>{p.date ? dateOf(p.date, ys, en) : ''}</td><td className="r">{fmt(p.amount)}</td></tr>)}</tbody></table>}
              {L.show_notes && (data.notes.length > 0 || (data.fields.remark && !L.head_fields.includes('remark'))) && <div className="ds-notes">{en ? EN.remarks : 'หมายเหตุ'}: {[data.fields.remark, ...data.notes].filter(Boolean).join(' · ')}</div>}
            </div>
            {L.show_totals && !isJ && <table className="ds-totals" style={bodySize}><tbody>{totals.map((t, i) => <tr key={i} className={i === totals.length - 1 ? 'ds-net' : ''}><th>{lab(t.label)}</th><td className="r">{fmt(t.value)}</td></tr>)}</tbody></table>}
          </div>
          {L.show_journal && !isJ && data.journal.length > 0 && <table className="ds-jnl"><thead><tr><th>{en ? EN.accountNo : 'เลขที่บัญชี'}</th><th>{en ? EN.accountName : 'ชื่อบัญชี'}</th><th className="r">{en ? EN.debit : 'เดบิต'}</th><th className="r">{en ? EN.credit : 'เครดิต'}</th></tr></thead>
            <tbody>{data.journal.map((j, i) => <tr key={i}><td>{j.code}</td><td>{j.name}</td><td className="r">{j.debit && fmt(j.debit)}</td><td className="r">{j.credit && fmt(j.credit)}</td></tr>)}</tbody></table>}
          {L.signatures.length > 0 && <div className="ds-sign">{L.signatures.map((s, i) => <div key={i}>{signOf(i) ? <img className="ds-sign-img" src={signOf(i)!} alt="" /> : null}<div className="ds-line" /><div>{en ? L.signatures_en[i] || s : s}</div><div className="ds-muted">{en ? EN.signDate : 'วันที่ ......../......../........'}</div></div>)}</div>}
          {L.footer && <div className="ds-footer">{L.footer}</div>}
        </div>
      ))}
    </>
  );
}

/**
 * ปุ่มพิมพ์/รับรอง/ข้อมูลเอกสาร บนแถบเครื่องมือของหน้าจอเอกสาร (S-RD-01 · S-UI-08..12 · S-RD-06)
 * Alt+P พิมพ์ฟอร์ม 1 · Shift+Alt+P เลือกแบบฟอร์ม · Alt+O รับรอง · Ctrl+O ยกเลิกรับรอง · Alt+Shift+O รับรองเป็นช่วง · Ctrl+I รายละเอียดแฟ้มข้อมูล
 */
export function DocActions({ kind, id: rawId, menu, typeId, dirty, del }: { kind: 'doc' | 'journal'; id: string | null | undefined; menu: string; typeId?: string | null; dirty?: boolean;
  /** ปุ่มลบ (ข้อกำหนดเจ้าของ): สถานะยกเลิก + API ยกเลิก + หน้ารายการที่กลับไปหลังลบ · ไม่ส่ง = ไม่มีปุ่มลบ */
  del?: { cancelled: boolean; cancelUrl: string; listPath: string; docNo?: string | null } }) {
  const id = rawId ?? undefined;
  const qc = useQueryClient();
  const nav = useNavigate();
  const ys = useYearSystem();
  const can = useCan(menu);
  const canForm = useCan('RP.FORM');
  const { me } = useSession();
  const q = useQuery({ enabled: !!id, queryKey: ['print', kind, id], queryFn: () => api.get<PrintResp>(`/api/v1/print/${kind}/${id}`), staleTime: 0 });
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PrintFormEntry | null>(null);
  // แบบฟอร์ม + ครั้งที่พิมพ์ก่อนครั้งนี้ (จากเซิร์ฟเวอร์ตอนนับ — ข้อมูลเอกสารที่โหลดใหม่ระหว่างพิมพ์จะไม่เปลี่ยนต้นฉบับเป็นสำเนา)
  const [printing, setPrinting] = useState<{ form: PrintFormEntry; prior: number } | null>(null);
  const [info, setInfo] = useState(false);
  const [range, setRange] = useState(false);
  const [notes, setNotes] = useState(false);
  const r = q.data;
  const approved = !!r?.data.approved;
  const screenOnly = me?.perms?.[menu]?.print === 'S';

  useEffect(() => { if (!open) return; const close = () => setOpen(false); window.addEventListener('click', close); return () => window.removeEventListener('click', close); }, [open]);

  const doPrint = async (slot: number) => {
    setOpen(false);
    if (!id || !r) return;
    const f = r.forms.find((x) => x.slot === slot);
    if (!f) return toast(`ไม่มีแบบฟอร์มหมายเลข ${slot} — เลือกจากเมนูพิมพ์ ▾`, 'warn');
    if (screenOnly) { setPreview(f); return toast('สิทธิ์ของคุณพิมพ์ได้เฉพาะแสดงทางจอภาพ', 'warn'); }
    try {
      const res = await api.post<{ print_count: number }>(`/api/v1/print/${kind}/${id}/printed`, { slot });
      setPreview(null); setPrinting({ form: f, prior: Math.max(0, Number(res?.print_count ?? r.data.print_count + 1) - 1) });
      qc.invalidateQueries({ queryKey: ['print', kind, id] });
    } catch (e) { toastError(e); }
  };
  const approve = async (undo: boolean) => {
    if (!id) return;
    try {
      await api.post(`/api/v1/approve/${kind}/${id}`, { undo });
      toast(undo ? 'ยกเลิกการรับรองแล้ว' : 'รับรองเอกสารแล้ว');
      qc.invalidateQueries({ queryKey: ['print', kind, id] });
    } catch (e) { toastError(e); }
  };
  useHotkeys({
    'Alt+P': id && can('print') ? () => doPrint(1) : undefined,
    'Alt+Shift+P': id && can('print') ? () => setOpen(true) : undefined,
    'Alt+O': id && can('approve') && !approved ? () => approve(false) : undefined,
    'Ctrl+O': id && can('approve') && approved ? () => approve(true) : undefined,
    'Alt+Shift+O': can('approve') ? () => setRange(true) : undefined,
    'Ctrl+I': id ? () => setInfo(true) : undefined,
    'Alt+R': id && kind === 'doc' ? () => setNotes(true) : undefined,
  });

  // ไปเอกสารแรก/ก่อนหน้า/ถัดไป/สุดท้าย ชนิดเดียวกัน (แทนเลขที่ใน URL) — มีการแก้ไขค้างอยู่ให้ยืนยันก่อน
  const loc = useLocation();
  const nb = useQuery({ enabled: !!id, queryKey: ['neighbors', kind, id], queryFn: () => api.get<Record<'first' | 'prev' | 'next' | 'last', { id: string; no: string } | null>>(`/api/v1/neighbors/${kind}/${id}`) });
  const go = (t: { id: string; no: string } | null | undefined) => {
    if (!t || !id || t.id === id) return;
    // งานที่ยังไม่บันทึก: ด่านกลาง (unsaved.tsx) ถามเมื่อเปลี่ยนหน้า (HANDOFF 149)
    nav(loc.pathname.replace(id, t.id) + loc.search);
  };
  const navBtn = (k: 'first' | 'prev' | 'next' | 'last', icon: string, label: string) => {
    const t = nb.data?.[k];
    return <button key={k} className="icon-btn nav-btn" disabled={!t || t.id === id} onClick={() => go(t)} title={t && t.id !== id ? `${label}: ${t.no}` : label} aria-label={label}>{icon}</button>;
  };
  return (
    <>
      {del && <DocDelete kind={kind} id={id} docNo={del.docNo ?? r?.data.doc_no} cancelled={del.cancelled} cancelUrl={del.cancelUrl} listPath={del.listPath} canDelete={can('delete')} canCancel={can('cancel')} />}
      {id && <span className="doc-nav">{navBtn('first', '⏮', 'เอกสารแรก')}{navBtn('prev', '◀', 'ก่อนหน้า')}{navBtn('next', '▶', 'ถัดไป')}{navBtn('last', '⏭', 'เอกสารสุดท้าย')}</span>}
      <span className="split-btn" onClick={(e) => e.stopPropagation()}>
        <button disabled={!id || !r || !can('print')} onClick={() => doPrint(1)} title={r?.block ?? `พิมพ์แบบฟอร์ม 1 (Alt+P)${r && r.data.print_count > 0 ? ` · พิมพ์แล้ว ${r.data.print_count} ครั้ง` : ''}`}>🖨 พิมพ์ <kbd>Alt+P</kbd>{r && r.data.print_count > 0 && <span className="badge" aria-label={`พิมพ์แล้ว ${r.data.print_count} ครั้ง`}>{r.data.print_count}</span>}</button>
        <button className="caret" disabled={!id || !r || !can('print')} onClick={() => setOpen((x) => !x)} title="เลือกแบบฟอร์ม (Shift+Alt+P)" aria-haspopup="menu" aria-expanded={open}>▾</button>
        {open && r && <ul className="pop-menu" role="menu">
          {r.forms.map((f) => <li key={f.slot} role="none"><button role="menuitem" onClick={() => doPrint(f.slot)}><b>{f.slot}</b> {f.name}{f.custom && <span className="muted small"> (ของบริษัท)</span>}</button>
            <button className="icon-btn" title="ดูทางจอภาพ (ไม่นับครั้งที่พิมพ์)" onClick={() => { setOpen(false); setPreview(f); }}>👁</button></li>)}
          {canForm('edit') && <li role="none"><button role="menuitem" onClick={() => nav(`/settings/print-forms?scope=${r.data.scope}`)}>✎ แก้ไขแบบฟอร์ม…</button></li>}
        </ul>}
      </span>
      {id && r && (approved ? <button disabled={!can('approve')} onClick={() => approve(true)} title="ยกเลิกการรับรอง (Ctrl+O)">✔ รับรองแล้ว · ยกเลิก</button>
        : r.rule.approveLevel > 0 && <button disabled={!can('approve')} onClick={() => approve(false)} title={`รับรองเอกสาร — ต้องระดับ ${r.rule.approveLevel} ขึ้นไป (Alt+O)`}>✔ รับรอง <kbd>Alt+O</kbd></button>)}
      {kind === 'doc' && id && r && ['QT', 'DP', 'VR'].includes(r.data.scope) && <StatusCodeSelect id={id} canEdit={can('edit')} />}
      {kind === 'doc' && <button disabled={!id} onClick={() => setNotes(true)} title={id ? 'หมายเหตุของทั้งเอกสาร — พิมพ์ในกล่องหมายเหตุด้านล่างของเอกสาร (Alt+R) · หมายเหตุรายการ คีย์ที่ปุ่ม 📝 ในบรรทัด (Alt+M)' : 'บันทึกเอกสารก่อนจึงเพิ่มหมายเหตุเอกสารได้'}>📄<span className="tb-txt"> หมายเหตุเอกสาร</span> <kbd>Alt+R</kbd></button>}
      <button disabled={!id} onClick={() => setInfo(true)} title="รายละเอียดแฟ้มข้อมูล (Ctrl+I)">ℹ</button>
      <CloseScreen dirty={dirty} />
      {preview && r && <Modal title={`ดูทางจอภาพ — ${preview.slot}. ${preview.name}`} size="wide" onClose={() => setPreview(null)}
        footer={<><button onClick={() => setPreview(null)}>ปิด</button>
          {canForm('edit') && <button title="แก้ช่องลงชื่อ ข้อความท้ายเอกสาร และพื้นที่ว่างในตาราง ของแบบฟอร์มนี้" onClick={() => nav(`/settings/print-forms?scope=${r.data.scope}&slot=${preview.slot}&tab=sign`)}>✎ แก้ไขส่วนท้าย</button>}
          {!screenOnly && <button disabled={!can('print') || !id} title="เปิดเอกสารในแท็บใหม่ แล้วพิมพ์/บันทึกเป็น PDF จากหน้านั้น (ใช้เมื่อกดพิมพ์แล้วไม่ออก)" onClick={() => id && window.open(`/print/${kind}/${id}?slot=${preview.slot}`, '_blank')}>↗ เปิดหน้าพิมพ์ในแท็บใหม่</button>}
          {!screenOnly && <button className="primary" disabled={!can('print')} onClick={() => doPrint(preview.slot)}>🖨 พิมพ์</button>}</>}>
        {r.block && <p className="err-msg">{r.block}</p>}
        {r.data.print_count > 0 && preview.layout.reprint_copy && <p className="muted small" data-testid="reprint-note">เอกสารนี้พิมพ์แล้ว {r.data.print_count} ครั้ง — พิมพ์ซ้ำออกเป็น "สำเนา" (ต้นฉบับออกได้ครั้งเดียว · ตั้งที่ แบบฟอร์มพิมพ์เอกสาร › ทั่วไป/กระดาษ)</p>}
        <PagedSheets className="ds-preview"><PrintSheet data={r.data} form={preview} ys={ys} images={r.images} /></PagedSheets>
      </Modal>}
      {/* พิมพ์ในกรอบแยก (HANDOFF 151 — เดิมแผ่นอยู่ในหน้าแล้วเอาออกหลังพิมพ์ ตัวอย่างก่อนพิมพ์บางครั้งว่าง) */}
      {printing && r && <PrintJob title={r.data.doc_no} onDone={() => setPrinting(null)}><div className="doc-print"><PrintSheet data={r.data} form={printing.form} prior={printing.prior} ys={ys} images={r.images} /></div></PrintJob>}
      {info && id && <RecordInfo kind={kind} id={id} onClose={() => setInfo(false)} />}
      {notes && id && <DocNotesDialog id={id} canEdit={can('edit')} onClose={() => setNotes(false)} />}
      {range && <ApproveRange kind={kind} scope={r?.data.scope} typeId={typeId ?? null} onClose={() => setRange(false)} onDone={() => qc.invalidateQueries({ queryKey: ['print'] })} />}
    </>
  );
}

/**
 * หน้าพิมพ์แยก /print/:kind/:id?slot=n — เอกสารอย่างเดียวเต็มหน้า แล้วเปิดหน้าต่างพิมพ์ให้
 * ใช้เมื่อกดพิมพ์จากหน้าจอเอกสารแล้วไม่ออก (เช่น เปิดโปรแกรมในหน้าต่างที่พิมพ์ไม่ได้) — พิมพ์ซ้ำ/บันทึก PDF ได้ด้วย Ctrl+P
 */
export function PrintPage({ kind, id, slot }: { kind: 'doc' | 'journal'; id: string; slot: number }) {
  const ys = useYearSystem();
  const q = useQuery({ queryKey: ['print', kind, id], queryFn: () => api.get<PrintResp>(`/api/v1/print/${kind}/${id}`), staleTime: 0 });
  const f = q.data?.forms.find((x) => x.slot === slot) ?? q.data?.forms[0];
  const [sent, setSent] = useState(false);
  // ครั้งที่พิมพ์ก่อนครั้งนี้ — ตั้งจากผลการนับของเซิร์ฟเวอร์ (Ctrl+P ซ้ำในแท็บนี้ไม่ได้นับ จึงคงคำกำกับเดิม)
  const [prior, setPrior] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!q.data || !f || sent || q.data.block) return;
    setSent(true);
    const before = q.data.data.print_count;
    void api.post<{ print_count: number }>(`/api/v1/print/${kind}/${id}/printed`, { slot: f.slot })
      .then((res) => setPrior(Math.max(0, Number(res?.print_count ?? before + 1) - 1)), () => setPrior(before))
      .finally(() => setTimeout(() => window.print(), 300));
  }, [q.data, f, sent, kind, id]);
  if (q.error) return <div className="page"><ErrorBox error={q.error} /></div>;
  if (!q.data || !f) return <div className="page"><p className="muted">กำลังเตรียมเอกสาร…</p></div>;
  return (
    <div className="print-page">
      <div className="print-page-bar no-print"><b>{q.data.data.doc_no}</b> · {f.slot}. {f.name}{q.data.block && <span className="err-msg"> {q.data.block}</span>}
        <button className="primary" disabled={!!q.data.block} onClick={() => window.print()}>🖨 พิมพ์ (Ctrl+P)</button><button onClick={() => window.close()}>ปิดแท็บ</button></div>
      <PagedSheets className="print-page-body"><PrintSheet data={q.data.data} form={f} prior={prior} ys={ys} images={q.data.images} /></PagedSheets>
    </div>
  );
}

type Info = { table: string; table_th: string; doc_no: string; type: string; id: string; line_count: number; created_at: string; created_by: string; updated_at: string; updated_by: string; row_version: string;
  print_count: number; last_printed_at: string | null; last_printed_by: string; approved_at: string | null; approved_by: string; status: string; gl_posted: string | null;
  rule: { approveLevel: number; method: string | null; reprintLevel: number }; position: { index: number; total: number }; log: Array<{ at: string; action: string; user: string }> };
const ts = (v: string | null | undefined, ys: YearSystem) => (v ? `${formatDate(v.slice(0, 10), ys)} ${new Date(v).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}` : '—');
const ACT_TH: Record<string, string> = { ADD: 'เพิ่ม', EDIT: 'แก้ไข', CANCEL: 'ยกเลิก', PRINT: 'พิมพ์', REPRINT: 'พิมพ์ซ้ำ', APPROVE: 'รับรอง', UNAPPROVE: 'ยกเลิกรับรอง', DELETE: 'ลบ' };

/** รายละเอียดแฟ้มข้อมูล (S-RD-06) — Express กด Tab บนหน้าจอเอกสาร · Buddy ใช้ปุ่ม ℹ หรือ Ctrl+I */
function RecordInfo({ kind, id, onClose }: { kind: 'doc' | 'journal'; id: string; onClose: () => void }) {
  const ys = useYearSystem();
  const q = useQuery({ queryKey: ['record-info', kind, id], queryFn: () => api.get<Info>(`/api/v1/record-info/${kind}/${id}`), staleTime: 0 });
  const x = q.data;
  const method = x?.rule.method === '1' ? 'พิมพ์ก่อนรับรอง' : x?.rule.method === '2' ? 'รับรองก่อนพิมพ์' : '—';
  return (
    <Modal title="รายละเอียดแฟ้มข้อมูล" onClose={onClose} footer={<button className="primary" onClick={onClose}>ปิด <kbd>Esc</kbd></button>}>
      <ErrorBox error={q.error} />
      {x && <table className="grid info-table"><tbody>
        <tr><th>แฟ้มข้อมูล</th><td>{x.table_th}</td></tr>
        <tr><th>ประเภท / เลขที่</th><td>{x.type} · <b className="mono">{x.doc_no}</b></td></tr>
        <tr><th>ลำดับระเบียน</th><td>{x.position.index.toLocaleString()} / {x.position.total.toLocaleString()} (เรียงตามเลขที่) · {x.line_count} บรรทัด</td></tr>
        <tr><th>สร้างโดย</th><td>{x.created_by || '—'} · {ts(x.created_at, ys)}</td></tr>
        <tr><th>แก้ไขล่าสุดโดย</th><td>{x.updated_by || '—'} · {ts(x.updated_at, ys)} · ครั้งที่ {x.row_version}</td></tr>
        <tr><th>พิมพ์</th><td>{x.print_count} ครั้ง{x.last_printed_at && ` · ล่าสุด ${x.last_printed_by} ${ts(x.last_printed_at, ys)}`}</td></tr>
        <tr><th>รับรองเอกสาร</th><td>{x.approved_at ? `${x.approved_by} · ${ts(x.approved_at, ys)}` : 'ยังไม่รับรอง'} — ต้องระดับ {x.rule.approveLevel || 'ไม่ต้องรับรอง'} · {method} · พิมพ์ซ้ำระดับ {x.rule.reprintLevel || '—'}</td></tr>
        <tr><th>สถานะ</th><td>{x.status === 'C' ? 'ยกเลิก' : 'ปกติ'}{x.gl_posted && ` · ลงบัญชี ${x.gl_posted === 'Y' ? 'แล้ว' : 'ยังไม่ลง'}`}</td></tr>
        <tr><th>รหัสระเบียน</th><td className="mono small">{x.id}</td></tr>
      </tbody></table>}
      {x && x.log.length > 0 && <><h3 className="small">ประวัติการทำรายการ</h3><table className="grid"><tbody>{x.log.map((l, i) => <tr key={i}><td>{ts(l.at, ys)}</td><td>{ACT_TH[l.action] ?? l.action}</td><td>{l.user}</td></tr>)}</tbody></table></>}
    </Modal>
  );
}

/** กำหนดช่วงเพื่อรับรองเอกสาร (S-UI-12) */
function ApproveRange({ kind, scope, typeId, onClose, onDone }: { kind: 'doc' | 'journal'; scope?: string; typeId: string | null; onClose: () => void; onDone: () => void }) {
  const { me } = useSession();
  const types = useQuery({ queryKey: ['approve-types', kind, scope], queryFn: async () => kind === 'journal'
    ? (await api.get<Array<{ id: string; code: string; name_th: string; approve_level?: number }>>('/api/v1/gl/books')).map((b) => ({ id: b.id, label: `${b.code} ${b.name_th}`, level: b.approve_level ?? 0 }))
    : (await api.get<Array<{ id: string; code: string; doc_class: string; name_th: string; approve_level: number | null }>>('/api/v1/doc-types')).filter((t) => !scope || t.doc_class === scope).map((t) => ({ id: t.id, label: `${t.code} ${t.name_th}`, level: t.approve_level ?? 0 })) });
  const [f, setF] = useState({ type_id: typeId ?? '', from_no: '', to_no: '', from_date: me?.work_date ?? '', to_date: me?.work_date ?? '' });
  const [res, setRes] = useState<{ approved: number; not_approved: number; skipped: Array<{ doc_no: string; reason: string }> } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!f.type_id && types.data?.[0]) setF((x) => ({ ...x, type_id: types.data![0]!.id })); }, [types.data, f.type_id]);
  const run = async () => {
    setErr(null); setBusy(true);
    try { setRes(await api.post('/api/v1/approve-range', { kind, ...f })); onDone(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  useHotkeys({ F9: run });
  const sel = types.data?.find((t) => t.id === f.type_id);
  return (
    <Modal title="รับรองเอกสารเป็นช่วง" onClose={onClose} footer={<><button onClick={onClose}>ปิด</button><button className="primary" disabled={busy || !f.type_id} onClick={run}>รับรอง <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label={kind === 'journal' ? 'สมุดรายวัน' : 'ประเภทเอกสาร'} wide hint={sel ? (sel.level ? `ต้องระดับอนุมัติ ${sel.level} ขึ้นไป` : 'ประเภทนี้ไม่ต้องรับรอง') : undefined}>
          <select value={f.type_id} onChange={(e) => setF({ ...f, type_id: e.target.value })}>{types.data?.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
        <Field label="เลขที่เอกสารจาก" hint="ว่าง = ตั้งแต่ต้น"><input className="mono" value={f.from_no} onChange={(e) => setF({ ...f, from_no: e.target.value.toUpperCase() })} /></Field>
        <Field label="ถึง" hint="ว่าง = ถึงท้ายสุด"><input className="mono" value={f.to_no} onChange={(e) => setF({ ...f, to_no: e.target.value.toUpperCase() })} /></Field>
        <Field label="วันที่จาก" req><DateInput value={f.from_date} onChange={(v) => setF({ ...f, from_date: v })} /></Field>
        <Field label="ถึง" req><DateInput value={f.to_date} onChange={(v) => setF({ ...f, to_date: v })} /></Field>
      </div>
      {res && <div className="note-box"><p>รับรองแล้ว <b>{res.approved.toLocaleString()}</b> ใบ · ไม่รับรอง <b>{res.not_approved.toLocaleString()}</b> ใบ</p>
        {res.skipped.length > 0 && <ul className="small">{res.skipped.slice(0, 20).map((s) => <li key={s.doc_no}><span className="mono">{s.doc_no}</span> — {s.reason}</li>)}</ul>}</div>}
    </Modal>
  );
}

/** สถานะเอกสารตามตารางข้อมูล (ใบเสนอราคา ตาราง 44 · เงินสดย่อย ตาราง 53) — เปลี่ยนแล้วบันทึกทันที */
function StatusCodeSelect({ id, canEdit }: { id: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['doc-status', id], queryFn: () => api.get<{ table: string | null; status_code: string | null; options: Array<{ code: string; name_th: string }> }>(`/api/v1/doc-status/doc/${id}`), staleTime: 0 });
  if (!q.data?.table) return null;
  return (
    <label className="small">สถานะ <select value={q.data.status_code ?? ''} disabled={!canEdit} title={`ตารางข้อมูล ${q.data.table}`} onChange={async (e) => {
      try { await api.put(`/api/v1/doc-status/doc/${id}`, { status_code: e.target.value || null }); toast('เปลี่ยนสถานะแล้ว'); qc.invalidateQueries({ queryKey: ['doc-status', id] }); } catch (err) { toastError(err); }
    }}><option value="">—</option>{q.data.options.map((o) => <option key={o.code} value={o.code}>{o.code} {o.name_th}</option>)}</select></label>
  );
}
