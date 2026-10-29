# ER Diagram — ระบบใหม่

> สร้างอัตโนมัติจาก spec.py · แสดงเฉพาะความสัมพันธ์ภายในกลุ่ม

## ภาพรวมแกนหลัก

```mermaid
erDiagram
    sys_branch ||--o{ sys_device : "branch_id"
    md_doc_type ||--o{ md_doc_number_block : "doc_type_id"
    sys_branch ||--o{ md_doc_number_block : "branch_id"
    sys_device |o--o{ md_doc_number_block : "device_id"
    sys_branch ||--o{ doc_header : "branch_id"
    md_doc_type ||--o{ doc_header : "doc_type_id"
    gl_journal |o--o{ doc_header : "journal_id"
    sys_device |o--o{ doc_header : "device_id"
    doc_header ||--o{ doc_line : "header_id"
    gl_account |o--o{ doc_line : "account_id"
    doc_line |o--o{ doc_line : "source_line_id"
    gl_account |o--o{ doc_line : "gl_debit_account_id"
    gl_account |o--o{ doc_line : "gl_credit_account_id"
    doc_header |o--o{ doc_settlement : "payment_header_id"
    gl_journal |o--o{ doc_settlement : "payment_journal_id"
    doc_header ||--o{ doc_settlement : "invoice_header_id"
    doc_header ||--o{ doc_payment : "header_id"
    md_payment_method ||--o{ doc_payment : "payment_method_id"
    fin_cheque |o--o{ doc_payment : "cheque_id"
    doc_header ||--o{ doc_link : "from_header_id"
    doc_header ||--o{ doc_link : "to_header_id"
    gl_account |o--o{ md_payment_method : "gl_account_id"
    sys_branch |o--o{ fin_cheque : "branch_id"
    gl_journal |o--o{ fin_cheque : "writeoff_journal_id"
    doc_header |o--o{ fin_cheque : "source_header_id"
    gl_journal |o--o{ fin_cheque : "source_journal_id"
    doc_header |o--o{ fin_cheque : "deposit_header_id"
    gl_journal |o--o{ fin_cheque : "pass_journal_id"
    sys_branch |o--o{ gl_journal : "branch_id"
    doc_header |o--o{ gl_journal : "source_header_id"
    gl_journal |o--o{ gl_journal : "reversal_of_id"
    gl_journal ||--o{ gl_journal_line : "journal_id"
    gl_account ||--o{ gl_journal_line : "account_id"
    gl_account |o--o{ gl_journal_line : "changed_from_account_id"
    gl_account |o--o{ gl_account : "parent_id"
    doc_header |o--o{ tax_vat_entry : "header_id"
    gl_journal |o--o{ tax_vat_entry : "journal_id"
    sys_branch |o--o{ tax_vat_entry : "branch_id"
    doc_header |o--o{ tax_wht_entry : "header_id"
    sys_branch |o--o{ tax_wht_entry : "branch_id"
    doc_line ||--o{ inv_stock_ledger : "line_id"
```

## แฟ้มข้อมูลหลัก

```mermaid
erDiagram
    md_salesperson |o--o{ md_customer : "salesperson_id"
    gl_account |o--o{ md_customer : "ar_account_id"
    md_customer |o--o{ md_customer : "payer_id"
    md_customer |o--o{ md_customer_ship_to : "customer_id"
    gl_account |o--o{ md_supplier : "ap_account_id"
    md_item_account_group |o--o{ md_item : "account_group_id"
    md_unit |o--o{ md_item : "base_unit_id"
    md_unit |o--o{ md_item : "count_unit_id"
    md_unit |o--o{ md_item : "purchase_unit_id"
    md_unit |o--o{ md_item : "sales_unit_id"
    md_supplier |o--o{ md_item : "default_supplier_id"
    md_item |o--o{ md_item : "substitute_item_id"
    gl_account |o--o{ md_item_account_group : "inventory_account_id"
    gl_account |o--o{ md_item_account_group : "cogs_account_id"
    gl_account |o--o{ md_item_account_group : "sales_account_id"
    gl_account |o--o{ md_item_account_group : "sales_return_account_id"
    gl_account |o--o{ md_item_account_group : "purchase_account_id"
    gl_account |o--o{ md_item_account_group : "purchase_return_account_id"
    md_item ||--o{ md_item_bom : "parent_item_id"
    md_item ||--o{ md_item_bom : "component_item_id"
    md_warehouse |o--o{ md_item_bom : "warehouse_id"
    md_item ||--o{ md_item_price_break : "item_id"
    md_unit |o--o{ md_item_price_break : "unit_id"
    gl_account |o--o{ gl_account : "parent_id"
    md_bank |o--o{ md_bank_account : "bank_id"
    gl_account |o--o{ md_bank_account : "gl_account_id"
```

## ขาย-ซื้อ-รับชำระ

```mermaid
erDiagram
    md_customer |o--o{ doc_header : "customer_id"
    md_supplier |o--o{ doc_header : "supplier_id"
    md_customer |o--o{ doc_header : "bill_to_customer_id"
    doc_header ||--o{ doc_line : "header_id"
    doc_line |o--o{ doc_line : "source_line_id"
    md_customer |o--o{ doc_line : "party_customer_id"
    md_supplier |o--o{ doc_line : "party_supplier_id"
    doc_header ||--o{ doc_note : "header_id"
    doc_line |o--o{ doc_note : "line_id"
    doc_header ||--o{ doc_link : "from_header_id"
    doc_header ||--o{ doc_link : "to_header_id"
    doc_header ||--o{ doc_bill_item : "bill_header_id"
    doc_header ||--o{ doc_bill_item : "invoice_header_id"
    doc_header |o--o{ doc_settlement : "payment_header_id"
    doc_header ||--o{ doc_settlement : "invoice_header_id"
    doc_header ||--o{ doc_payment : "header_id"
    md_payment_method ||--o{ doc_payment : "payment_method_id"
    fin_cheque |o--o{ doc_payment : "cheque_id"
    md_customer |o--o{ fin_cheque : "customer_id"
    md_supplier |o--o{ fin_cheque : "supplier_id"
    doc_header |o--o{ fin_cheque : "source_header_id"
    doc_header |o--o{ fin_cheque : "deposit_header_id"
    fin_cheque ||--o{ fin_cheque_event : "cheque_id"
    doc_header |o--o{ fin_cheque_event : "header_id"
    md_customer |o--o{ md_customer : "payer_id"
```

## สินค้าคงคลัง

```mermaid
erDiagram
    md_item |o--o{ md_item : "substitute_item_id"
    md_item |o--o{ doc_line : "item_id"
    md_warehouse |o--o{ doc_line : "warehouse_id"
    doc_line |o--o{ doc_line : "source_line_id"
    md_item ||--o{ inv_stock_ledger : "item_id"
    md_warehouse ||--o{ inv_stock_ledger : "warehouse_id"
    doc_line ||--o{ inv_stock_ledger : "line_id"
    md_item ||--o{ inv_cost_layer : "item_id"
    md_warehouse |o--o{ inv_cost_layer : "warehouse_id"
    doc_line ||--o{ inv_cost_layer : "receipt_line_id"
    doc_line ||--o{ inv_cost_consumption : "issue_line_id"
    inv_cost_layer ||--o{ inv_cost_consumption : "layer_id"
    md_item ||--o{ inv_stock_balance : "item_id"
    md_warehouse ||--o{ inv_stock_balance : "warehouse_id"
    md_warehouse ||--o{ inv_stock_count : "warehouse_id"
    md_item ||--o{ inv_stock_count : "item_id"
    doc_line |o--o{ inv_stock_count : "adjust_line_id"
```

## บัญชีแยกประเภท-ภาษี

```mermaid
erDiagram
    gl_fiscal_year ||--o{ gl_period : "fiscal_year_id"
    gl_account |o--o{ gl_account : "parent_id"
    gl_journal_book ||--o{ gl_journal : "journal_book_id"
    gl_period ||--o{ gl_journal : "period_id"
    doc_header |o--o{ gl_journal : "source_header_id"
    gl_journal |o--o{ gl_journal : "reversal_of_id"
    gl_journal ||--o{ gl_journal_line : "journal_id"
    gl_account ||--o{ gl_journal_line : "account_id"
    gl_account |o--o{ gl_journal_line : "changed_from_account_id"
    gl_account ||--o{ gl_balance : "account_id"
    gl_period ||--o{ gl_balance : "period_id"
    gl_account ||--o{ gl_default_account : "account_id"
    gl_journal_book ||--o{ gl_journal_route : "journal_book_id"
    gl_journal_book |o--o{ md_doc_type : "journal_book_id"
    md_doc_type ||--o{ md_doc_type_account : "doc_type_id"
    gl_account ||--o{ md_doc_type_account : "account_id"
    doc_header |o--o{ tax_vat_entry : "header_id"
    gl_journal |o--o{ tax_vat_entry : "journal_id"
    gl_period ||--o{ tax_vat_entry : "vat_period_id"
    doc_header |o--o{ tax_wht_entry : "header_id"
    gl_period ||--o{ tax_wht_entry : "tax_period_id"
    md_doc_type ||--o{ doc_header : "doc_type_id"
    gl_period |o--o{ doc_header : "period_id"
    gl_period |o--o{ doc_header : "vat_period_id"
    gl_journal |o--o{ doc_header : "journal_id"
```

## ทรัพย์สินถาวร

```mermaid
erDiagram
    md_asset_account_group ||--o{ fa_asset : "account_group_id"
    fa_asset ||--o{ fa_depreciation : "asset_id"
    gl_period ||--o{ fa_depreciation : "period_id"
    gl_journal |o--o{ fa_depreciation : "journal_id"
    gl_account |o--o{ md_asset_account_group : "asset_account_id"
    gl_account |o--o{ md_asset_account_group : "depr_expense_account_id"
    gl_account |o--o{ md_asset_account_group : "accum_depr_account_id"
    gl_account |o--o{ gl_account : "parent_id"
    gl_period ||--o{ gl_journal : "period_id"
    gl_journal |o--o{ gl_journal : "reversal_of_id"
```

## ผู้ใช้-สิทธิ์-ซิงก์

```mermaid
erDiagram
    sys_user_group |o--o{ sys_user : "user_group_id"
    sys_user ||--o{ sys_user_company : "user_id"
    sys_branch |o--o{ sys_user_company : "branch_id"
    sys_menu |o--o{ sys_menu : "parent_id"
    sys_menu ||--o{ sys_permission : "menu_id"
    sys_branch ||--o{ sys_device : "branch_id"
    sys_branch ||--o{ md_doc_number_block : "branch_id"
    sys_device |o--o{ md_doc_number_block : "device_id"
    sys_device |o--o{ sync_conflict : "device_id"
    sys_user |o--o{ sync_conflict : "resolved_by"
```

