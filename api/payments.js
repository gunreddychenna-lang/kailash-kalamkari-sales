'use strict';
// Isolated receipt trial. Production writes are deliberately unavailable.
const DEV = 'https://yiaipfquxyrqxvkvjykp.supabase.co';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const send = (code, data) => res.status(code).json(data);
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return send(405, { error: 'Method not allowed' });
  }
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const PROD = 'https://dqvqqrbvklpiibzqivbp.supabase.co';

  const devAllowed =
    base === DEV &&
    process.env.VERCEL_ENV !== 'production';

  const prodAllowed =
    base === PROD &&
    process.env.VERCEL_ENV === 'production' &&
    process.env.PAYMENTS_WRITE_ENABLED === 'true';

  const prodReadAllowed =
    base === PROD &&
    process.env.VERCEL_ENV === 'production';

  if (!secret ||
      (!devAllowed && !prodReadAllowed) ||
      (req.method === 'POST' && prodReadAllowed && !prodAllowed)) {
    return send(503, { error: 'Payment trial unavailable. Production saving is disabled.' });
  }
  const token = (req.headers?.authorization || '').match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token) return send(401, { error: 'Please sign in.' });
  const query = new URL(req.url || '/', 'http://localhost').searchParams;
  const input = req.method === 'POST' ? req.body : { bill_no: query.get('bill_no'), branch: query.get('branch') };
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(k => !['bill_no','branch','idempotency_key','payments','expected_bill_amount'].includes(k)) ||
      typeof input.bill_no !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.bill_no) ||
      !['Main Branch','KHPS'].includes(input.branch)) return send(400, { error: 'Select a valid bill and branch.' });
  if (req.method === 'POST' && (!UUID.test(input.idempotency_key || '') ||
      !Array.isArray(input.payments) || input.payments.length < 1 || input.payments.length > 20 ||
      !['string','number'].includes(typeof input.expected_bill_amount) ||
      !/^[0-9]+(?:\.[0-9]{1,2})?$/.test(String(input.expected_bill_amount)))) {
    return send(400, { error: 'Invalid payment submission.' });
  }
  // Server-enforced restriction. Client-side guards are insufficient.
  if (
    req.method === 'POST' &&
    base === DEV &&
    !/^TEST-[A-Za-z0-9_-]+$/.test(input.bill_no)
  ) {
    return send(403, {
      error: 'DEV writes restricted to TEST invoices.'
    });
  }
  if (req.method === 'POST') {

    for (const payment of input.payments) {
      if (!payment || typeof payment !== 'object' || Array.isArray(payment)) {
        return send(400, { error: 'Invalid payment.' });
      }
      if (payment.account === 'Cash') {
        if (typeof payment.reference !== 'string') {
          return send(400, { error: 'Invalid Cash reference.' });
        }
        continue;
      }
      if (typeof payment.account !== 'string' ||
          typeof payment.reference !== 'string' ||
          !payment.reference.trim()) {
        return send(400, { error: 'UPI/Card reference required.' });
      }
      const parts = payment.account.split('::');
      if (parts.length !== 2 ||
          !['UPI_STORE','UPI_ONLINE','CARD'].includes(parts[0]) ||
          !parts[1]) {
        return send(400, { error: 'Invalid payment type or bank account.' });
      }
    }
  }
  async function upstream(path, jwt, body) {
    const response = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { apikey: secret, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12000)
    });
    return { ok: response.ok, status: response.status, data: await response.json() };
  }
  try {
    const identity = await upstream('/auth/v1/user', token);
    if (!identity.ok || !UUID.test(identity.data?.id || '')) return send(401, { error: 'Please sign in again.' });
    // Verify every non-cash bank against the active DEV account catalog.
    if (req.method === 'POST') {
      const lookup = await upstream(
        '/rest/v1/kk_payment_accounts?select=account_name,account_type,is_active',
        secret
      );

      if (!lookup.ok || !Array.isArray(lookup.data)) {
        return send(503, { error: 'Bank account verification unavailable.' });
      }

      const activeBanks = new Set(
        lookup.data
          .filter(a => a.is_active === true)
          .filter(a => !['Cash', 'Reseller'].includes(a.account_type))
          .map(a => a.account_name)
      );

      for (const payment of input.payments) {
        if (payment.account === 'Cash') continue;

        const bank = payment.account.split('::')[1];

        if (!activeBanks.has(bank)) {
          return send(422, {
            error: 'Unknown or inactive bank account.'
          });
        }
      }
    }
    // RPC checks the trusted staff table too. Browser cannot supply actor or bill total.
    const result = await upstream('/rest/v1/rpc/kk_receipt_flow', secret, {
      p_actor: identity.data.id, p_bill: input.bill_no, p_branch: input.branch,
      ...(req.method === 'POST' ? {
        p_id: input.idempotency_key, p_payments: input.payments, p_expected: input.expected_bill_amount
      } : {})
    });
    if (!result.ok) {
      if (result.data?.code === '42501') return send(403, { error: 'Owner or Admin access required.' });
      const known = new Set(['Invalid invoice','Invoice missing or ambiguous','Invalid original bill amount',
        'Existing receipts need review before new entry','Original bill amount changed; review required',
        'Invalid payments or stale bill amount','Invalid payment details','Invalid payment date or amount',
        'Submission key belongs to different payment details','Identical payment already saved; check receipt history',
        'Payments exceed remaining bill balance',
        'Opening approval required',
        'Historical receivables require reconciliation',
        'Unknown or inactive bank',
        'Inactive cash account',
        'Payments exceed remaining balance',
        'Identical receipt already saved',
        'Invalid payment submission']);
      if (known.has(result.data?.message)) return send(result.data.code === '23505' ? 409 : 422, { error: result.data.message });
      return send(503, { error: 'Payment unavailable. Refresh receipt history before retrying.' });
    }
    return send(200, result.data);
  } catch {
    return send(503, { error: 'Payment response unavailable. Retry the same submission to avoid duplication.' });
  }
};
