# ER Diagram — โปรแกรม Express (โครงสร้างเดิม)

> เส้นความสัมพันธ์ทั้งหมดตรวจกับข้อมูลจริงแล้ว (ดู % ใน 01_Express_โครงสร้างเดิม.md)

## ขายและลูกหนี้

```mermaid
erDiagram
    ARMAS ||--o{ ARTRN : "CUSCOD"
    OESLM ||--o{ ARTRN : "SLMCOD"
    ARTRN ||--o{ STCRD : "DOCNUM"
    ARTRN ||--o{ ARTRNRM : "DOCNUM"
    ARBIL ||--o{ ARTRN : "BILNUM"
    ARTRN ||--o{ ARRCPIT : "RCPNUM (ใบเสร็จ)"
    ARTRN ||--o{ ARRCPIT : "DOCNUM (ใบกำกับ)"
    ARTRN ||--o{ ARRCPCQ : "RCPNUM"
    ISRUN ||--o{ ARRCPCQ : "CHQNUM[1:2] วิธีรับเงิน"
    OESO ||--o{ OESOIT : "SONUM"
    OESO ||--o{ ARTRN : "SONUM"
    ARMAS ||--o{ OESO : "CUSCOD"
    ARMAS ||--o{ ARSHIP : "CUSCOD"
    ARMAS ||--o{ ARBAL : "CUSCOD"
```

## ซื้อและเจ้าหนี้

```mermaid
erDiagram
    APMAS ||--o{ APTRN : "SUPCOD"
    APTRN ||--o{ STCRD : "DOCNUM"
    APBIL ||--o{ APTRN : "BILNUM"
    APTRN ||--o{ APRCPIT : "RCPNUM/DOCNUM"
    APTRN ||--o{ APRCPCQ : "RCPNUM"
    ISRUN ||--o{ APRCPCQ : "CHQNUM[1:2] วิธีจ่ายเงิน"
    POPR ||--o{ POPRIT : "PONUM"
    POPR ||--o{ APTRN : "PONUM"
    APMAS ||--o{ POPR : "SUPCOD"
    APMAS ||--o{ APBAL : "SUPCOD"
```

## สินค้า

```mermaid
erDiagram
    STMAS ||--o{ STCRD : "STKCOD"
    STMAS ||--o{ STLOC : "STKCOD"
    STTRN ||--o{ STCRD : "DOCNUM"
    ISACC ||--o{ STMAS : "ACCCOD"
    STMAS ||--o{ STBOM : "PSTKCOD"
    STMAS ||--o{ STTAK : "STKCOD"
    ISTAB ||--o{ STCRD : "LOCCOD (TABTYP 21)"
    ISTAB ||--o{ STMAS : "QUCOD (20) / STKGRP (22)"
```

## บัญชีแยกประเภท ภาษี การเงิน

```mermaid
erDiagram
    GLACC ||--o{ GLJNLIT : "ACCNUM"
    GLJNL ||--o{ GLJNLIT : "VOUCHER"
    ARTRN ||--o{ GLJNL : "DOCNUM = VOUCHER"
    APTRN ||--o{ GLJNL : "DOCNUM = VOUCHER"
    GLACC ||--o{ GLACC : "PARENT"
    GLACC ||--o{ GLBAL : "ACCNUM"
    GLACC ||--o{ ISACC : "ACCNUM01–06"
    GLACC ||--o{ ISRUN : "ACCNUM01–12"
    GLACC ||--o{ ARMAS : "ACCNUM"
    GLACC ||--o{ APMAS : "ACCNUM"
    GLACC ||--o{ BKMAS : "ACCNUM"
    BKMAS ||--o{ BKTRN : "BNKACC"
    ARTRN ||--o{ ISVAT : "DOCNUM"
    APTRN ||--o{ ISVAT : "DOCNUM"
    APTRN ||--o{ ISTAX : "REFNUM"
    GLPTT ||--o{ GLPTTIT : "DOCNUM"
    ISACC ||--o{ FAMAS : "ACCCOD"
```

