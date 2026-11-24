-- Kailash Kalamkari Financial & Data Integrity Verification Queries
-- Run after every migration, sync reconciliation, or backup restore test.

-- 1. Branch-wise sales line counts and exact totals (compare against Google Sheets baseline)
SELECT b.name AS branch_name,
       COUNT(sl.id) AS line_count,
       COUNT(DISTINCT sl.invoice_id) AS invoice_count,
       COALESCE(SUM(sl.final_amount), 0.00) AS total_final_amount,
       COALESCE(SUM(sl.discount), 0.00) AS total_discount
FROM branches b
LEFT JOIN sales_lines sl ON sl.branch_id = b.id AND sl.is_source_deleted = FALSE
GROUP BY b.id, b.name
ORDER BY b.id;

-- 2. Verify zero invoice_masters vs sales_lines total drift
SELECT im.id, im.invoice_uid, im.final_amount AS master_total,
       COALESCE(SUM(sl.final_amount), 0.00) AS lines_total,
       im.final_amount - COALESCE(SUM(sl.final_amount), 0.00) AS drift
FROM invoice_masters im
LEFT JOIN sales_lines sl ON sl.invoice_id = im.id AND sl.is_source_deleted = FALSE
GROUP BY im.id, im.invoice_uid, im.final_amount
HAVING im.final_amount <> COALESCE(SUM(sl.final_amount), 0.00);

-- 3. Verify zero receivables vs settlement drift
SELECT im.id, im.invoice_uid, im.final_amount, im.paid_amount, im.outstanding_amount
FROM invoice_masters im
WHERE (im.final_amount - im.paid_amount) <> im.outstanding_amount;

-- 4. Summarize open reconciliation & discount exceptions
SELECT exception_type, COUNT(*) AS open_count, COALESCE(SUM(variance_amount), 0.00) AS net_variance
FROM sync_exceptions
WHERE resolution_status = 'open'
GROUP BY exception_type;
