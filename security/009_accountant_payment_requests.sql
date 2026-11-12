-- KK Accountant-only pending payment entry. Production project: dqvqqrbvklpiibzqivbp
-- RUN MANUALLY after review and a Supabase backup. Additive; does NOT alter sales,
-- receivables, existing receipt flow, or live payment totals.
BEGIN;

DO $gate$
BEGIN
  IF (SELECT current_database()) IS NULL THEN RAISE EXCEPTION 'Database unavailable'; END IF;
  IF to_regclass('public.kk_staff_access') IS NULL OR
     to_regclass('public.bills_master') IS NULL OR
     to_regclass('public.kk_payment_accounts') IS NULL THEN
    RAISE EXCEPTION 'Required production Sales tables missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kk_staff_access
                 WHERE login_id='accountant1' AND role='employee'
                   AND active AND 'payments'=ANY(features)
                   AND 'Main Branch'=ANY(stores)) THEN
    RAISE EXCEPTION 'Accountant profile not configured';
  END IF;
END $gate$;

CREATE TABLE IF NOT EXISTS public.kk_payment_requests (
  id uuid PRIMARY KEY,
  store_name text NOT NULL CHECK (store_name IN ('Main Branch','KHPS')),
  bill_no text NOT NULL CHECK (bill_no ~ '^[A-Za-z0-9_-]{1,64}$'),
  invoice_amount numeric(14,2) NOT NULL CHECK (invoice_amount>0),
  amount numeric(14,2) NOT NULL CHECK (amount>0),
  payment_method text NOT NULL CHECK (payment_method IN ('cash','upi','bank_transfer','card')),
  account_name text NOT NULL CHECK (length(btrim(account_name)) BETWEEN 1 AND 120),
  payment_reference text NOT NULL DEFAULT '' CHECK (length(payment_reference)<=120),
  payment_date date NOT NULL,
  entered_by_auth_user_id uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by_auth_user_id uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  CONSTRAINT accountant_non_cash_ref CHECK (payment_method='cash' OR length(btrim(payment_reference))>0)
);

CREATE INDEX IF NOT EXISTS kk_payment_requests_invoice_idx
 ON public.kk_payment_requests(store_name,bill_no,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS kk_payment_requests_ref_uniq
 ON public.kk_payment_requests (lower(account_name),lower(payment_reference))
 WHERE payment_method<>'cash' AND btrim(payment_reference)<>'';

ALTER TABLE public.kk_payment_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kk_payment_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.kk_payment_requests TO service_role;

-- Only a trusted server authenticated with service_role may invoke this function.
-- SECURITY INVOKER retains ordinary PostgreSQL permission checks; no bypass grants.
CREATE OR REPLACE FUNCTION public.kk_submit_payment_request(
 p_actor uuid, p_id uuid, p_branch text, p_bill text, p_amount numeric,
 p_method text, p_account text, p_reference text, p_date date
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE
  invoice record;
  count_invoices integer;
  prior public.kk_payment_requests%ROWTYPE;
  is_authorized boolean;
  already_pending numeric;
  res_id uuid;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.kk_staff_access a
    WHERE a.auth_user_id=p_actor AND a.active
    AND (a.role IN ('owner','admin') OR
       (a.role='employee' AND 'payments'=ANY(a.features) AND p_branch=ANY(a.stores))))
  INTO is_authorized;
  IF NOT is_authorized THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Not authorized'; END IF;
  IF p_id IS NULL OR p_branch NOT IN ('Main Branch','KHPS') OR p_bill IS NULL OR
     p_bill !~ '^[A-Za-z0-9_-]{1,64}$' OR
     p_method NOT IN ('cash','upi','bank_transfer','card') OR
     p_account IS NULL OR length(btrim(p_account)) NOT BETWEEN 1 AND 120 OR
     p_reference IS NULL OR length(p_reference)>120 OR
     (p_method<>'cash' AND btrim(p_reference)='') OR
     p_amount IS NULL OR p_amount<=0 OR p_amount<>round(p_amount,2) OR
     p_date IS NULL OR p_date < DATE '2026-09-01' OR
     p_date > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid payment details';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.kk_payment_accounts a
                WHERE a.is_active AND a.account_name=p_account AND
                ((p_method='cash' AND a.account_type='Cash') OR
                 (p_method<>'cash' AND a.account_type IN ('Bank','Bank Account','Payment Service')))) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Choose an active matching account';
  END IF;

  -- Transaction-serialized per invoice: prevents concurrent pending over-allocation.
  PERFORM pg_advisory_xact_lock(hashtextextended('kk-payment-request:'||p_branch||':'||p_bill,0));
  SELECT COUNT(*) INTO count_invoices FROM public.bills_master
   WHERE bill_no=p_bill AND branch=p_branch;
  IF count_invoices<>1 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invoice missing or ambiguous';
  END IF;
  SELECT bill_amount INTO invoice FROM public.bills_master
   WHERE bill_no=p_bill AND branch=p_branch;
  IF invoice.bill_amount IS NULL OR invoice.bill_amount<=0 OR
     invoice.bill_amount<>round(invoice.bill_amount,2) OR p_amount>invoice.bill_amount THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid amount for verified invoice';
  END IF;

  SELECT * INTO prior FROM public.kk_payment_requests WHERE id=p_id;
  IF FOUND THEN
    IF prior.entered_by_auth_user_id<>p_actor OR prior.store_name<>p_branch OR
       prior.bill_no<>p_bill OR prior.amount<>p_amount OR
       prior.payment_method<>p_method OR prior.account_name<>p_account OR
       prior.payment_reference<>p_reference OR prior.payment_date<>p_date THEN
       RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='Submission key conflict';
    END IF;
    RETURN jsonb_build_object('id',prior.id,'status',prior.status,'replayed',true);
  END IF;
  SELECT COALESCE(SUM(amount),0) INTO already_pending FROM public.kk_payment_requests
   WHERE store_name=p_branch AND bill_no=p_bill AND status='pending';
  IF already_pending+p_amount>invoice.bill_amount THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Pending payments exceed original bill';
  END IF;
  INSERT INTO public.kk_payment_requests(
    id,store_name,bill_no,invoice_amount,amount,payment_method,
    account_name,payment_reference,payment_date,entered_by_auth_user_id,status
  ) VALUES(p_id,p_branch,p_bill,invoice.bill_amount,p_amount,p_method,
           p_account,p_reference,p_date,p_actor,'pending') RETURNING id INTO res_id;
  RETURN jsonb_build_object('id',res_id,'status','pending','replayed',false);
END $fn$;

REVOKE ALL ON FUNCTION public.kk_submit_payment_request(uuid,uuid,text,text,numeric,text,text,text,date)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kk_submit_payment_request(uuid,uuid,text,text,numeric,text,text,text,date)
  TO service_role;

COMMIT;
