import { Router, type Request, type Response } from 'express';
import { query, queryOne } from '../lib/db.js';
import {
  generateReference,
  paygateInitialize,
  paygateVerify,
  paygateRefund,
  verifyWebhookSignature,
} from '../lib/paygate.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// 1. Initialize Payment
// POST /api/payments/initialize
// ─────────────────────────────────────────────────────────────────────────────
router.post('/initialize', async (req: Request, res: Response) => {
  try {
    const {
      email,
      amount,
      currency = 'NGN',
      payer_name,
      student_id,
      payer_type,
      fee_type,
      payment_method,
      mobile_no,
    } = req.body;

    if (!email || !amount) {
      return res.status(400).json({ ok: false, error: 'email and amount are required' });
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ ok: false, error: 'amount must be a positive number' });
    }
    if (!mobile_no || typeof mobile_no !== 'string') {
      return res.status(400).json({ ok: false, error: 'mobile_no is required' });
    }

    const request_ref = generateReference();

    // Call PayGate — returns payment_url and paygate_txn_id
    const initResponse = await paygateInitialize({
      reference: request_ref,
      amount,
      email,
      currency,
      payerName: payer_name ?? undefined,
      feeType:   fee_type   ?? undefined,
      mobileNo:  mobile_no,
    });

    // Store amount as integer in cents/kobo (smallest unit)
    const amountSmallest = Math.round(amount * 100);

    await query(
      `INSERT INTO transactions
        (request_ref, email, payer_name, student_id, payer_type, fee_type,
         payment_method, amount, currency, status, raw_init_response)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', $10)`,
      [
        request_ref,
        email,
        payer_name ?? null,
        student_id ?? null,
        payer_type ?? null,
        fee_type ?? null,
        payment_method ?? null,
        amountSmallest,
        currency,
        JSON.stringify(initResponse),
      ]
    );

    return res.status(201).json({
      ok: true,
      request_ref,
      payment_url: initResponse.payment_url,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[payments/initialize] error=%s', message);
    return res.status(500).json({ ok: false, error: message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Webhook — PayGate server-to-server callback (source of truth)
// POST /api/payments/webhook
// ─────────────────────────────────────────────────────────────────────────────
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const payload = req.body as Record<string, string>;
    const { checksum, request_ref, status, paygate_txn_id } = payload;

    if (!verifyWebhookSignature(request_ref, checksum)) {
      console.warn('[payments/webhook] invalid signature ref=%s', request_ref);
      return res.status(400).json({ ok: false, error: 'Invalid signature' });
    }

    const tx = await queryOne<{ id: string; status: string }>(
      `SELECT id, status FROM transactions WHERE request_ref = $1`,
      [request_ref]
    );

    if (!tx) {
      return res.status(404).json({ ok: false, error: 'Transaction not found' });
    }

    // Idempotency guard — never overwrite an already-settled transaction
    if (tx.status !== 'PENDING') {
      console.info('[payments/webhook] ref=%s already settled as %s — ignoring', request_ref, tx.status);
      return res.status(200).json({ ok: true });
    }

    const newStatus = status === 'SUCCESS' ? 'SUCCESS' : 'FAILED';

    await query(
      `UPDATE transactions
       SET status              = $1,
           paygate_txn_id      = $2,
           raw_webhook_payload = $3,
           updated_at          = NOW()
       WHERE id = $4 AND status = 'PENDING'`,
      [newStatus, paygate_txn_id ?? null, JSON.stringify(payload), tx.id]
    );

    console.info('[payments/webhook] ref=%s → %s', request_ref, newStatus);
    return res.status(200).json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[payments/webhook] ref=%s error=%s', req.body?.request_ref, message);
    // Always return 200 — PayGate retries on any non-200
    return res.status(200).json({ ok: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Verify Payment — calls PayGate, syncs DB if needed
// GET /api/payments/verify/:request_ref
// ─────────────────────────────────────────────────────────────────────────────
router.get('/verify/:request_ref', async (req: Request, res: Response) => {
  try {
    const { request_ref } = req.params;

    const tx = await queryOne<{ id: string; status: string; amount: number }>(
      `SELECT id, status, amount FROM transactions WHERE request_ref = $1`,
      [request_ref]
    );

    if (!tx) {
      return res.status(404).json({ ok: false, error: 'Transaction not found' });
    }

    const paygateData = await paygateVerify(request_ref);
    const newStatus = paygateData.status === 'SUCCESS' ? 'SUCCESS' : tx.status;

    // Sync DB if PayGate says SUCCESS but we're still PENDING
    if (tx.status === 'PENDING' && newStatus === 'SUCCESS') {
      await query(
        `UPDATE transactions
         SET status         = $1,
             paygate_txn_id = $2,
             updated_at     = NOW()
         WHERE id = $3 AND status = 'PENDING'`,
        [newStatus, paygateData.paygate_ref, tx.id]
      );
    }

    return res.json({
      ok: true,
      request_ref,
      status: newStatus,
      amount_kobo: tx.amount,
      paygate: paygateData,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[payments/verify] ref=%s error=%s', req.params.request_ref, message);
    return res.status(500).json({ ok: false, error: message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Check Local Status — DB only, no PayGate call
// GET /api/payments/status/:request_ref
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status/:request_ref', async (req: Request, res: Response) => {
  try {
    const { request_ref } = req.params;

    const tx = await queryOne<{
      status: string;
      amount: number;
      currency: string;
      email: string;
      payer_name: string | null;
      student_id: string | null;
      fee_type: string | null;
      payment_method: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT status, amount, currency, email, payer_name, student_id,
              fee_type, payment_method, created_at, updated_at
       FROM transactions WHERE request_ref = $1`,
      [request_ref]
    );

    if (!tx) {
      return res.status(404).json({ ok: false, error: 'Transaction not found' });
    }

    return res.json({
      ok: true,
      request_ref,
      status: tx.status,
      amount_cents: tx.amount,
      currency: tx.currency,
      email: tx.email,
      payer_name: tx.payer_name,
      student_id: tx.student_id,
      fee_type: tx.fee_type,
      payment_method: tx.payment_method,
      created_at: tx.created_at,
      updated_at: tx.updated_at,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[payments/status] ref=%s error=%s', req.params.request_ref, message);
    return res.status(500).json({ ok: false, error: message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Refund
// POST /api/payments/refund
// ─────────────────────────────────────────────────────────────────────────────
router.post('/refund', async (req: Request, res: Response) => {
  try {
    const { request_ref, reason } = req.body;

    if (!request_ref || !reason) {
      return res.status(400).json({ ok: false, error: 'request_ref and reason are required' });
    }

    const tx = await queryOne<{
      id: string;
      status: string;
      amount: number;
      paygate_txn_id: string | null;
    }>(
      `SELECT id, status, amount, paygate_txn_id FROM transactions WHERE request_ref = $1`,
      [request_ref]
    );

    if (!tx) {
      return res.status(404).json({ ok: false, error: 'Transaction not found' });
    }
    if (tx.status !== 'SUCCESS') {
      return res.status(400).json({ ok: false, error: 'Only successful transactions can be refunded' });
    }
    if (!tx.paygate_txn_id) {
      return res.status(400).json({ ok: false, error: 'No paygate_txn_id on this transaction' });
    }

    // amount stored in kobo — convert back to Naira for PayGate
    const amountNaira = tx.amount / 100;
    await paygateRefund(request_ref, tx.paygate_txn_id, amountNaira, reason);

    await query(
      `UPDATE transactions
       SET status       = 'REFUNDED',
           refund_reason = $1,
           refunded_at  = NOW(),
           updated_at   = NOW()
       WHERE id = $2`,
      [reason, tx.id]
    );

    console.info('[payments/refund] ref=%s refunded', request_ref);
    return res.json({ ok: true, message: 'Refund processed successfully' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[payments/refund] ref=%s error=%s', req.body?.request_ref, message);
    return res.status(500).json({ ok: false, error: message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Payment History — paginated, filterable
// GET /api/payments/history?status=SUCCESS&email=x@x.com&limit=50&offset=0
// ─────────────────────────────────────────────────────────────────────────────
router.get('/history', async (req: Request, res: Response) => {
  try {
    const {
      status,
      email,
      limit = '50',
      offset = '0',
    } = req.query as Record<string, string>;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status) {
      params.push(status.toUpperCase());
      conditions.push(`status = $${params.length}`);
    }
    if (email) {
      params.push(email.toLowerCase());
      conditions.push(`LOWER(email) = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const rows = await query(
      `SELECT id, request_ref, paygate_txn_id, email, amount, currency,
              status, refund_reason, refunded_at, created_at, updated_at
       FROM transactions
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const [{ count }] = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM transactions ${where}`,
      params.slice(0, params.length - 2)
    );

    return res.json({ ok: true, total: parseInt(count, 10), transactions: rows });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[payments/history] error=%s', message);
    return res.status(500).json({ ok: false, error: message });
  }
});

export default router;
