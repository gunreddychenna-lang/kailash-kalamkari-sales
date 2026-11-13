-- Kailash Kalamkari | Proposal: atomic auto-post for NEW payment entries.
-- Production project: dqvqqrbvklpiibzqivbp. Additive; does not process existing pending entries.
-- Deploy only with the matching frontend/API release. Restrict execution to service_role.
BEGIN;

CREATE OR REPLACE FUNCTION public.kk_post_payment_on_save(
  p_actor uuid, p_id uuid, p_branch text, p_bill text, p_amount numeric,
  p_method text, p_account text, p_reference text, p_date date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE
  v_authorized boolean;
  v_matches integer;
  v_bill_amount numeric;
  v_key text;
  v_opening numeric := 0;
  v_posted numeric := 0;
  v_pending numeric := 0;
  v_remaining numeric;
  v_prior public.kk_payment_requests%ROWTYPE;
  v_payment jsonb;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.kk_staff_access s
    WHERE s.auth_user_id = p_actor AND s.active IS TRUE
      AND (s.role IN ('owner','admin') OR
           (s.role='employee' AND 'payments'=ANY(s.features)
            AND p_branch=ANY(s.stores)))
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Not authorized';
  END IF;
  IF p_id IS NULL OR p_branch IS NULL OR p_branch NOT IN ('Main Branch','KHPS')
     OR p_bill IS NULL OR p_bill !~ '^[A-Za-z0-9_-]{1,64}$'
     OR p_method IS NULL OR p_method NOT IN ('cash','upi','bank_transfer','card')
     OR p_account IS NULL OR length(btrim(p_account)) NOT BETWEEN 1 AND 120
     OR p_reference IS NULL OR length(p_reference)>120
     OR p_amount IS NULL OR p_amount<=0 OR p_amount<>round(p_amount,2)
     OR p_date IS NULL OR p_date < DATE '2026-09-01'
     OR p_date > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid payment details';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.kk_payment_accounts a
    WHERE a.is_active IS TRUE AND a.account_name=btrim(p_account)
      AND ((p_method='cash' AND a.account_type='Cash') OR
           (p_method<>'cash' AND a.account_type IN ('Bank','Bank Account','Payment Service')))
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Choose an active matching account';
  END IF;

  v_key := jsonb_build_array(p_branch,p_bill)::text;
  -- Same lock as the previous request importer; also serialize with receipt flow.
  PERFORM pg_advisory_xact_lock(hashtextextended('kk-payment-request:'||p_branch||':'||p_bill,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('receipt-invoice:'||v_key,0));

  SELECT COUNT(*), MAX(bill_amount) INTO v_matches, v_bill_amount
  FROM public.bills_master WHERE branch=p_branch AND bill_no=p_bill;
  IF v_matches<>1 OR v_bill_amount IS NULL OR v_bill_amount<=0
     OR v_bill_amount<>round(v_bill_amount,2) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invoice missing or ambiguous';
  END IF;

  -- Retry first: the same ID must not create a second receipt.
  SELECT * INTO v_prior FROM public.kk_payment_requests WHERE id=p_id;
  IF FOUND THEN
    IF v_prior.entered_by_auth_user_id<>p_actor OR v_prior.store_name<>p_branch
       OR v_prior.bill_no<>p_bill OR v_prior.amount<>p_amount
       OR v_prior.payment_method<>p_method OR v_prior.account_name<>btrim(p_account)
       OR v_prior.payment_reference<>btrim(p_reference)
       OR v_prior.payment_date<>p_date THEN
      RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='Submission key conflict';
    END IF;
    IF v_prior.status='approved' AND EXISTS (
      SELECT 1 FROM public.kk_receipt_batches b
      WHERE b.id=p_id AND b.invoice_key=v_key AND b.amount=p_amount
    ) THEN
      RETURN jsonb_build_object('id',p_id,'status','approved',
        'posted',true,'replayed',true);
    END IF;
    RAISE EXCEPTION USING ERRCODE='22023',
      MESSAGE='Existing pending submission requires review before another save';
  END IF;

  -- Do not falsely mark an older invoice paid twice.
  IF EXISTS (
    SELECT 1 FROM public.receivables r
    WHERE upper(btrim(r.bill_no))=upper(btrim(p_bill))
      AND (r.store_name=p_branch OR r.store_name IS NULL)
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023',
      MESSAGE='Existing legacy receipts require reconciliation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.kk_opening_balances o
    WHERE o.invoice_key::jsonb=v_key::jsonb
      AND (o.locked IS DISTINCT FROM TRUE OR o.bill_amount<>v_bill_amount)
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Opening balance needs reconciliation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.kk_receipt_batches b
    WHERE b.invoice_key::jsonb=v_key::jsonb AND b.bill_amount<>v_bill_amount
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Receipt history needs reconciliation';
  END IF;
  SELECT COALESCE(SUM(opening_paid),0) INTO v_opening
  FROM public.kk_opening_balances WHERE invoice_key::jsonb=v_key::jsonb;
  SELECT COALESCE(SUM(amount),0) INTO v_posted
  FROM public.kk_receipt_batches WHERE invoice_key::jsonb=v_key::jsonb;
  SELECT COALESCE(SUM(amount),0) INTO v_pending
  FROM public.kk_payment_requests
  WHERE store_name=p_branch AND bill_no=p_bill AND status='pending';
  IF v_pending<>0 THEN
    RAISE EXCEPTION USING ERRCODE='22023',
      MESSAGE='Existing pending submission requires review before another save';
  END IF;
  v_remaining := v_bill_amount-v_opening-v_posted;
  IF v_remaining<=0 OR p_amount>v_remaining THEN
    RAISE EXCEPTION USING ERRCODE='22023',
      MESSAGE='Payment exceeds remaining verified invoice balance';
  END IF;

  v_payment := jsonb_build_object(
    'account',btrim(p_account), 'amount',p_amount, 'payment_date',p_date::text,
    'reference',btrim(p_reference), 'method',p_method
  );
  IF EXISTS (
    SELECT 1 FROM public.kk_receipt_batches b
    WHERE b.invoice_key::jsonb=v_key::jsonb AND b.payments @> jsonb_build_array(v_payment)
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23505',
      MESSAGE='Identical receipt already exists; check history before retrying';
  END IF;

  -- One atomic transaction: do NOT insert only one of these rows.
  INSERT INTO public.kk_payment_requests (
    id,store_name,bill_no,invoice_amount,amount,payment_method,account_name,
    payment_reference,payment_date,entered_by_auth_user_id,status,review_note
  ) VALUES (
    p_id,p_branch,p_bill,v_bill_amount,p_amount,p_method,btrim(p_account),
    btrim(p_reference),p_date,p_actor,'approved',
    'Auto-posted from staff entry; external bank reconciliation is NOT verified'
  );
  INSERT INTO public.kk_receipt_batches (
    id,invoice_key,bill_amount,entered_by,payments,amount
  ) VALUES (
    p_id,v_key,v_bill_amount,p_actor,jsonb_build_array(v_payment),p_amount
  );

  RETURN jsonb_build_object('id',p_id,'status','approved','posted',true,
    'replayed',false,'remaining_balance',v_remaining-p_amount,
    'settled',(v_remaining=p_amount));
END $fn$;

REVOKE ALL ON FUNCTION public.kk_post_payment_on_save(
  uuid,uuid,text,text,numeric,text,text,text,date
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kk_post_payment_on_save(
  uuid,uuid,text,text,numeric,text,text,text,date
) TO service_role;
COMMIT;

-- READ-ONLY VERIFICATION
SELECT p.proname, p.prosecdef AS security_definer, p.proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='kk_post_payment_on_save';
