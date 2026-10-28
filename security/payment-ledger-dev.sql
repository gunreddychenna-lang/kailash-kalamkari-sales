-- Isolated DEV installation only. No production migration is authorized.
BEGIN;
CREATE TABLE public.kk_receipt_batches (
  id uuid PRIMARY KEY,
  invoice_key text NOT NULL,
  bill_amount numeric(14,2) NOT NULL CHECK (bill_amount > 0),
  entered_by uuid NOT NULL REFERENCES auth.users(id),
  entered_at timestamptz NOT NULL DEFAULT now(),
  payments jsonb NOT NULL CHECK (jsonb_typeof(payments) = 'array'),
  amount numeric(14,2) NOT NULL CHECK (amount > 0)
);
ALTER TABLE public.kk_receipt_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kk_receipt_batches FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.kk_receipt_batches TO service_role;

CREATE FUNCTION public.kk_receipt_flow(p_actor uuid, p_bill text, p_branch text,
  p_id uuid DEFAULT NULL, p_payments jsonb DEFAULT NULL, p_expected numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  master record; matches integer; k text; item jsonb; received_date date;
  total numeric := 0; paid numeric; previous public.kk_receipt_batches%ROWTYPE;
  history jsonb; replay boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.kk_staff_access WHERE auth_user_id=p_actor
    AND active=true AND role IN ('owner','admin')) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Access denied';
  END IF;
  IF p_branch NOT IN ('Main Branch','KHPS') OR p_bill IS NULL OR p_bill !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid invoice';
  END IF;
  k := jsonb_build_array(p_branch,p_bill)::text;
  IF p_payments IS NOT NULL THEN
    IF p_id IS NULL OR p_expected IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Missing submission identity';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('receipt-id:'||p_id::text,0));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('receipt-invoice:'||k,0));
  SELECT count(*) INTO matches FROM public.bills_master WHERE bill_no=p_bill AND branch=p_branch;
  IF matches <> 1 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invoice missing or ambiguous';
  END IF;
  -- DEV masters are a grouped view. Lock their underlying item rows.
  PERFORM 1 FROM public.sales WHERE bill_no=p_bill AND store_name=p_branch FOR SHARE;
  IF (SELECT count(DISTINCT bill_date) FROM public.sales WHERE bill_no=p_bill AND store_name=p_branch) <> 1 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invoice missing or ambiguous';
  END IF;
  SELECT * INTO master FROM public.bills_master WHERE bill_no=p_bill AND branch=p_branch;
  IF master.bill_amount IS NULL OR master.bill_amount <= 0 OR master.bill_amount<>round(master.bill_amount,2) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid original bill amount';
  END IF;
  -- Never silently erase or double-count pre-existing receipts.
  IF EXISTS (SELECT 1 FROM public.receivables WHERE upper(trim(bill_no))=upper(p_bill)) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Existing receipts need review before new entry';
  END IF;
  IF EXISTS (SELECT 1 FROM public.kk_receipt_batches WHERE invoice_key=k AND bill_amount<>master.bill_amount) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Original bill amount changed; review required';
  END IF;
  IF p_payments IS NOT NULL THEN
    IF jsonb_typeof(p_payments)<>'array' OR jsonb_array_length(p_payments) NOT BETWEEN 1 AND 20
      OR p_expected<>master.bill_amount THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid payments or stale bill amount';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_payments) LOOP
      IF jsonb_typeof(item)<>'object' OR item - ARRAY['account','amount','payment_date','reference'] <> '{}'::jsonb
        OR jsonb_typeof(item->'account') IS DISTINCT FROM 'string'
        OR length(trim(item->>'account')) NOT BETWEEN 1 AND 120
        OR jsonb_typeof(item->'amount') NOT IN ('string','number')
        OR coalesce(item->>'amount','') !~ '^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$'
        OR jsonb_typeof(item->'payment_date') IS DISTINCT FROM 'string'
        OR coalesce(item->>'payment_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        OR jsonb_typeof(item->'reference') IS DISTINCT FROM 'string'
        OR length(item->>'reference')>120 THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid payment details';
      END IF;
      received_date := (item->>'payment_date')::date;
      IF received_date < DATE '2026-09-01' OR received_date > (now() AT TIME ZONE 'Asia/Kolkata')::date
        OR (item->>'amount')::numeric <= 0 THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid payment date or amount';
      END IF;
      total := total + (item->>'amount')::numeric;
    END LOOP;
    SELECT * INTO previous FROM public.kk_receipt_batches WHERE id=p_id;
    IF FOUND THEN
      IF previous.invoice_key<>k OR previous.entered_by<>p_actor OR previous.payments<>p_payments THEN
        RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='Submission key belongs to different payment details';
      END IF;
      replay := true;
    ELSE
      IF EXISTS (SELECT 1 FROM public.kk_receipt_batches WHERE invoice_key=k AND payments=p_payments) THEN
        RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='Identical payment already saved; check receipt history';
      END IF;
      SELECT coalesce(sum(amount),0) INTO paid FROM public.kk_receipt_batches WHERE invoice_key=k;
      IF paid+total > master.bill_amount THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Payments exceed remaining bill balance';
      END IF;
      INSERT INTO public.kk_receipt_batches(id,invoice_key,bill_amount,entered_by,payments,amount)
        VALUES(p_id,k,master.bill_amount,p_actor,p_payments,total);
    END IF;
  END IF;
  SELECT coalesce(sum(amount),0), coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'entered_at',entered_at,'payments',payments) ORDER BY entered_at,id),'[]'::jsonb)
    INTO paid,history FROM public.kk_receipt_batches WHERE invoice_key=k;
  RETURN jsonb_build_object('bill_no',p_bill,'branch',p_branch,'bill_date',master.bill_date,
    'bill_amount',master.bill_amount,'paid_amount',paid,'balance',master.bill_amount-paid,
    'history',history,'replayed',replay,'test_only',true);
END $$;
REVOKE ALL ON FUNCTION public.kk_receipt_flow(uuid,text,text,uuid,jsonb,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kk_receipt_flow(uuid,text,text,uuid,jsonb,numeric) TO service_role;
COMMIT;
