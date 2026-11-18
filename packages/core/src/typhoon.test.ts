import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { billOcrReadable, nextPenalty, ocrRepetitive, ocrSize, TYPHOON_PROMPT, typhoonOptions, typhoonText } from './typhoon.js';

describe('Typhoon-OCR bill reading (hybrid, owner 18/11/2569)', () => {
  it('uses the official prompt byte for byte (same as WTS-App taxlaw-crawl) and the reference options', () => {
    expect(createHash('sha256').update(TYPHOON_PROMPT).digest('hex')).toBe('b34fe7fe20a6ebd7f1358c3544ced491671cc4cc39feb2467ffd266f48a4cf9e');
    expect(TYPHOON_PROMPT.startsWith('Extract all text from the image.\n')).toBe(true);
    expect(typhoonOptions()).toEqual({ temperature: 0.1, top_p: 0.6, repeat_penalty: 1.1, num_ctx: 12288, num_predict: 6000 });
    expect([nextPenalty(1.1), nextPenalty(1.25), nextPenalty(1.4)]).toEqual([1.25, 1.4, null]);
  });
  it('scales the long side to 1800 px, at most 2x for small images', () => {
    expect(ocrSize(3600, 2400)).toMatchObject({ width: 1800, height: 1200 });
    expect(ocrSize(800, 1200)).toMatchObject({ width: 1200, height: 1800 });
    expect(ocrSize(400, 300)).toMatchObject({ width: 800, height: 600, scale: 2 });
  });
  it('turns Markdown + HTML tables into plain text, Thai digits to Arabic, drops figures and page numbers', () => {
    const md = '# ใบกำกับภาษี\n<figure>ตราบริษัท</figure>\n**เลขที่** INV-๖๙๐๑\n<table><tr><th>รายการ</th><th>จำนวนเงิน</th></tr><tr><td>กระดาษ A4</td><td>1,070.00</td></tr></table>\n<page_number>1</page_number>\nรวม&nbsp;&amp; ภาษี';
    expect(typhoonText(md)).toBe('ใบกำกับภาษี\n\nเลขที่ INV-6901\nรายการ | จำนวนเงิน\nกระดาษ A4 | 1,070.00\n\nรวม & ภาษี');
  });
  it('readability: enough letters with digits, little junk, no looping — otherwise Claude reads the image', () => {
    expect(billOcrReadable('ใบเสร็จรับเงิน บริษัท ตัวอย่าง จำกัด\nกระดาษ A4 2 รีม 250.00\nรวม 500.00')).toBe(true);
    expect(billOcrReadable('TAX INVOICE ABC Co., Ltd.\nPaper A4 x2 500.00\nTotal 535.00')).toBe(true);
    expect(billOcrReadable('ใบเสร็จรับเงิน ไม่มีตัวเลขเลยสักตัวในข้อความนี้')).toBe(false);
    expect(billOcrReadable('12 34')).toBe(false);
    expect(billOcrReadable('ใบเสร็จ 100 ' + '■□▲△◆◇★☆♠♣'.repeat(5))).toBe(false);
    const loop = ['ใบเสร็จรับเงิน 100', ...Array(12).fill('กระดาษ A4 1 รีม 125.00')].join('\n');
    expect(ocrRepetitive(loop)).toBe(true);
    expect(billOcrReadable(loop)).toBe(false);
  });
});
