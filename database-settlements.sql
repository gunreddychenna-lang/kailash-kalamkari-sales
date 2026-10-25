-- Simple-login compatibility: installs the atomic settlement function only.
-- SECURITY INVOKER preserves existing table grants and RLS; it bypasses nothing.
-- This script does NOT disable RLS, grant table access, or delete existing data.
-- With anonymous table access, the browser login is not a server-side security boundary.
BEGIN;

CREATE OR REPLACE FUNCTION public.replace_settlements(invoices jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE invoice jsonb; split jsonb; master record; matches integer;
  allocated numeric; bill_key text;
BEGIN
  IF jsonb_typeof(invoices) IS DISTINCT FROM 'array' OR jsonb_array_length(invoices) = 0 THEN
    RAISE EXCEPTION 'Expected a nonempty invoice list';
  END IF;
  IF (SELECT count(*) <> count(DISTINCT upper(trim(value->>'bill_no'))) FROM jsonb_array_elements(invoices)) THEN
    RAISE EXCEPTION 'Duplicate invoice in request';
  END IF;
  -- Consistent lock order serializes competing settlement saves.
  FOR invoice IN SELECT value FROM jsonb_array_elements(invoices) ORDER BY upper(trim(value->>'bill_no')) LOOP
    bill_key := upper(trim(invoice->>'bill_no'));
    IF bill_key IS NULL OR bill_key = '' OR jsonb_typeof(invoice->'splits') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid invoice payload';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(bill_key, 0));
    SELECT count(*) INTO matches FROM public.bills_master WHERE upper(trim(bill_no::text)) = bill_key;
    IF matches <> 1 THEN RAISE EXCEPTION 'Invoice % missing or ambiguous across branches/dates', bill_key; END IF;
    SELECT * INTO master FROM public.bills_master WHERE upper(trim(bill_no::text)) = bill_key;
    allocated := 0;
    FOR split IN SELECT value FROM jsonb_array_elements(invoice->'splits') LOOP
      IF coalesce(trim(split->>'account'), '') = '' OR jsonb_typeof(split->'amount') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Invalid account or amount';
      END IF;
      IF (split->>'amount')::numeric <= 0 OR round((split->>'amount')::numeric, 2) <> (split->>'amount')::numeric THEN
        RAISE EXCEPTION 'Amount must be positive with at most two decimal places';
      END IF;
      allocated := allocated + (split->>'amount')::numeric;
    END LOOP;
    IF master.bill_amount IS NULL OR allocated > round(master.bill_amount::numeric, 2) THEN
      RAISE EXCEPTION 'Settlement exceeds invoice % total', bill_key;
    END IF;
    DELETE FROM public.receivables WHERE upper(trim(bill_no::text)) = bill_key;
    INSERT INTO public.receivables (bill_no, bill_date, store_name, sales_agent, amount, bank_account)
    SELECT r.bill_no, r.bill_date, r.store_name, r.sales_agent, r.amount, r.bank_account
    FROM jsonb_populate_recordset(NULL::public.receivables,
      coalesce((SELECT jsonb_agg(jsonb_build_object('bill_no', master.bill_no, 'bill_date', master.bill_date,
        'store_name', master.branch, 'sales_agent', master.sm_name,
        'amount', value->'amount', 'bank_account', trim(value->>'account')))
        FROM jsonb_array_elements(invoice->'splits')), '[]'::jsonb)) r;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.replace_settlements(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_settlements(jsonb) TO anon, authenticated;
COMMIT;
