-- Run only in isolated DEV. All test payments roll back.
BEGIN;
DO $$
DECLARE actor uuid; r jsonb; n integer; id uuid := gen_random_uuid();
  p jsonb := '[{"account":"Cash","amount":"2000","payment_date":"2026-09-01","reference":"SQL-TEST"}]';
BEGIN
  SELECT auth_user_id INTO actor FROM public.kk_staff_access WHERE active AND role='owner' LIMIT 1;
  IF actor IS NULL THEN RAISE EXCEPTION 'No DEV owner fixture'; END IF;
  INSERT INTO public.sales(bill_no,store_name,bill_date,amount) VALUES ('TEST-SQL-RECEIPT','Main Branch','2026-09-01',6000),('TEST-SQL-RECEIPT','Main Branch','2026-09-01',4000);
  r := public.kk_receipt_flow(actor,'TEST-SQL-RECEIPT','Main Branch',id,p,10000);
  IF (r->>'balance')::numeric<>8000 OR (r->>'bill_amount')::numeric<>10000 THEN RAISE EXCEPTION 'Partial payment failed'; END IF;
  r := public.kk_receipt_flow(actor,'TEST-SQL-RECEIPT','Main Branch',id,p,10000);
  IF NOT (r->>'replayed')::boolean OR (r->>'paid_amount')::numeric<>2000 THEN RAISE EXCEPTION 'Retry duplicated payment'; END IF;
  BEGIN
    PERFORM public.kk_receipt_flow(actor,'TEST-SQL-RECEIPT','Main Branch',gen_random_uuid(),p,10000);
    RAISE EXCEPTION 'Duplicate was allowed';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    PERFORM public.kk_receipt_flow(actor,'TEST-SQL-RECEIPT','Main Branch',gen_random_uuid(),
      '[{"account":"TD","amount":"8000.01","payment_date":"2026-09-01","reference":""}]',10000);
    RAISE EXCEPTION 'Overpayment was allowed';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r := public.kk_receipt_flow(actor,'TEST-SQL-RECEIPT','Main Branch',gen_random_uuid(),
    '[{"account":"TD","amount":"8000","payment_date":"2026-09-01","reference":""}]',10000);
  r := public.kk_receipt_flow(actor,'TEST-SQL-RECEIPT','Main Branch');
  IF (r->>'balance')::numeric<>0 OR (r->>'paid_amount')::numeric<>10000 OR jsonb_array_length(r->'history')<>2 THEN
    RAISE EXCEPTION 'Save then reload failed'; END IF;
  IF (SELECT bill_amount FROM public.bills_master WHERE bill_no='TEST-SQL-RECEIPT')<>10000 THEN RAISE EXCEPTION 'Bill amount changed'; END IF;
  BEGIN
    PERFORM public.kk_receipt_flow(gen_random_uuid(),'TEST-SQL-RECEIPT','Main Branch');
    RAISE EXCEPTION 'Unauthorized user was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF has_function_privilege('anon','public.kk_receipt_flow(uuid,text,text,uuid,jsonb,numeric)','EXECUTE')
    OR has_function_privilege('authenticated','public.kk_receipt_flow(uuid,text,text,uuid,jsonb,numeric)','EXECUTE')
    OR has_table_privilege('authenticated','public.kk_receipt_batches','INSERT') THEN RAISE EXCEPTION 'Browser has direct write access'; END IF;
END $$;
ROLLBACK;
