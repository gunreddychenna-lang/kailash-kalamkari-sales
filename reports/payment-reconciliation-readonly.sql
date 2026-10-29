-- KK Payments: Read-only historical reconciliation
-- No INSERT, UPDATE, DELETE, DDL or financial balance changes.

WITH sales_summary AS (
    SELECT
        bill_no,
        store_name AS branch,
        bill_date,
        ROUND(SUM(amount), 2) AS sales_total,
        COUNT(*) AS sales_lines
    FROM public.sales
    GROUP BY bill_no, store_name, bill_date
),
split_summary AS (
    SELECT
        bill_no,
        store_name AS branch,
        bill_date,
        ROUND(SUM(amount), 2) AS split_total,
        COALESCE(ROUND(SUM(amount) FILTER (
            WHERE LOWER(TRIM(account_name)) = 'take by hand'
        ), 2), 0) AS reseller_allocated,
        COUNT(*) AS split_rows
    FROM public.payment_splits
    GROUP BY bill_no, store_name, bill_date
),
receivable_summary AS (
    SELECT
        bill_no,
        store_name AS branch,
        bill_date,
        ROUND(SUM(amount), 2) AS historical_receivable_amount,
        COUNT(*) AS receivable_rows
    FROM public.receivables
    GROUP BY bill_no, store_name, bill_date
)
SELECT
    s.bill_no,
    s.branch,
    s.bill_date,
    s.sales_total,
    s.sales_lines,
    p.split_total,
    p.split_rows,
    COALESCE(p.reseller_allocated, 0) AS reseller_allocated,
    r.historical_receivable_amount,
    r.receivable_rows,
    CASE
        WHEN p.bill_no IS NULL THEN 'NO_PAYMENT_SPLIT'
        WHEN p.split_total > s.sales_total + 0.01 THEN 'OVER_ALLOCATED_REVIEW'
        WHEN p.reseller_allocated <> 0 THEN 'RESELLER_OWNER_REVIEW'
        WHEN r.bill_no IS NOT NULL THEN 'RECEIVABLE_REVIEW'
        WHEN ABS(p.split_total - s.sales_total) > 0.01 THEN 'AMOUNT_MISMATCH_REVIEW'
        ELSE 'ALLOCATION_MATCHED_NOT_BANK_VERIFIED'
    END AS audit_status
FROM sales_summary s
LEFT JOIN split_summary p
    USING (bill_no, branch, bill_date)
LEFT JOIN receivable_summary r
    USING (bill_no, branch, bill_date)
ORDER BY
    CASE
        WHEN p.split_total > s.sales_total + 0.01 THEN 0
        WHEN p.bill_no IS NULL THEN 1
        ELSE 2
    END,
    s.bill_date DESC,
    s.bill_no
LIMIT 200;