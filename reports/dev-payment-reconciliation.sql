-- DEV ONLY: Read-only receipt reconciliation.
-- Run against DEV project yiaipfquxyrqxvkvjykp.
-- Never treat these results as verified historical production balances.

WITH recorded AS (
  SELECT
    invoice_key,
    SUM(amount) AS paid,
    COUNT(*) AS receipt_batches
  FROM public.kk_receipt_batches
  GROUP BY invoice_key
)
SELECT
  b.branch,
  b.bill_no,
  b.bill_amount,
  COALESCE(r.paid, 0) AS recorded_paid,
  b.bill_amount - COALESCE(r.paid, 0) AS balance,
  COALESCE(r.receipt_batches, 0) AS receipt_batches,
  CASE
    WHEN COALESCE(r.paid, 0) > b.bill_amount
      THEN 'Needs Review'
    WHEN COALESCE(r.paid, 0) = b.bill_amount
      THEN 'Settled'
    ELSE 'Pending'
  END AS dev_status
FROM public.bills_master b
LEFT JOIN recorded r
  ON r.invoice_key =
    jsonb_build_array(b.branch, b.bill_no)::text
WHERE b.bill_no LIKE 'TEST-%'
ORDER BY b.branch, b.bill_no;

-- Bank-wise receipts from individual recorded payment lines.
SELECT
  CASE
    WHEN lower(trim(p.item->>'account')) = 'cash'
      THEN 'Cash'
    WHEN position('::' IN p.item->>'account') > 0
      THEN split_part(p.item->>'account', '::', 2)
    ELSE COALESCE(p.item->>'account', 'Unknown')
  END AS account_name,
  COUNT(*) AS payment_lines,
  SUM((p.item->>'amount')::numeric) AS recorded_amount
FROM public.kk_receipt_batches b
CROSS JOIN LATERAL
  jsonb_array_elements(b.payments) AS p(item)
GROUP BY 1
ORDER BY 1;

-- Detect receipt-batch amounts inconsistent with their payment lines.
SELECT
  b.id,
  b.invoice_key,
  b.amount AS batch_amount,
  COALESCE(
    (
      SELECT SUM((p.item->>'amount')::numeric)
      FROM jsonb_array_elements(b.payments) AS p(item)
    ), 0
  ) AS detail_amount
FROM public.kk_receipt_batches b
WHERE b.amount IS DISTINCT FROM COALESCE(
  (
    SELECT SUM((p.item->>'amount')::numeric)
    FROM jsonb_array_elements(b.payments) AS p(item)
  ), 0
);