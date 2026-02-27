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
    const { email, amount, currency = 'NGN', application_id } = req.body;

    if (!email || !amount) {
      return res.status(400).json({ ok: false, error: 'email and amount are required' });
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ ok: false, error: 'amount must be a positive number' });
    }

    const reference = generateReference();

    // Call PayGate
    const { payment_url, paygate_ref } = await paygateInitialize({
      reference,
      amount,
      email,
      currency,
    });

    // Save to DB as PENDING
    await query(
      `INSERT INTO payments
        (application_id, student_email, amount, currency, transaction_id, status, metadata, paid_at)
       VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, NULL)`,
      [
        application_id ?? null,
        email,
        amount,
        currency,
        reference,
        JSON.stringify({ paygate_ref, payment_url }),
      ]
    );

    return res.status(201).json({ ok: true, reference, payment_url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[payments/initialize]', err);
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
    const { checksum, reference, status, paygate_ref } = payload;

    if (!verifyWebhookSignature(payload, checksum)) {
      console.warn('[payments/webhook] Invalid signature for ref:', reference);
      return res.status(400).json({ ok: false, error: 'Invalid signature' });
    }

    const tx = await queryOne<{ id: string; metadata: Record<string, unknown> }>(
      `SELECT id, metadata FROM payments WHERE transaction_id = $1`,
      [reference]
    );

    if (!tx) {
      return res.status(404).json({ ok: false, error: 'Transaction not found' });
    }

    const newStatus = status === 'SUCCESS' ? 'SUCCESS' : 'FAILED';
    const updatedMeta = { ...tx.metadata, paygate_ref, webhook_data: payload };

    await query(
      `UPDATE payments
       SET status = $1,
           metadata = $2,
           paid_at = CASE WHEN $1 = 'SUCCESS' THEN NOW() ELSE paid_at END
       WHERE id = $3`,
      [newStatus, JSON.stringify(updatedMeta), tx.id]
    );

    // Always respond 200 fast — PayGate will retry on failure
    return res.status(200).json({ ok: true });
  } catch (err: unknown) {
    console.error('[payments/webhook]', err);
    // Still return 200 so PayGate doesn't keep retrying on our server errors
    return res.status(200).json({ ok: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Verify Payment — calls PayGate directly, syncs DB if needed
// GET /api/payments/verify/:reference
// ─────────────────────────────────────────────────────────────────────────────
router.get('/verify/:reference', async (req: Request, res: Response) => {
  try {
    const { reference } = req.params;

    const tx = await queryOne<{
      id: string;
      status: string;
      amount: number;
      metadata: Record<string, unknown>;
    }>(
      `SELECT id, status, amount, metadata FROM payments WHERE transaction_id = $1`,
      [reference]
    );

    if (!tx) {
      return res.status(404).json({ ok: false, error: 'Transaction not found' });
    }

    const paygateData = await paygateVerify(reference);
    const newStatus = paygateData.status === 'SUCCESS' ? 'SUCCESS' : tx.status;

    // Sync DB if PayGate says success but DB is still PENDING
    if (tx.status !== newStatus) {
      await query(
        `UPDATE payments
         SET status = $1,
             paid_at = CASE WHEN $1 = 'SUCCESS' THEN NOW() ELSE paid_at END
         WHERE id = $2`,
        [newStatus, tx.id]
      );
    }

    return res.json({
      ok: true,
      reference,
      status: newStatus,
      amount: tx.amount,
      paygate: paygateData,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[payments/verify]', err);
    return res.status(500).json({ ok: false, error: message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Check Local Status — DB only, no PayGate call
// GET /api/payments/status/:reference
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status/:reference', async (req: Request, res: Response) => {
  try {
    const { reference } = req.params;

    const tx = await queryOne<{
      status: string;
      amount: number;
      currency: string;
      student_email: string;
      paid_at: string | null;
    }>(
      `SELECT status, amount, currency, student_email, paid_at
       FROM payments WHERE transaction_id = $1`,
      [reference]
    );

    if (!tx) {
      return res.status(404).json({ ok: false, error: 'Transaction not found' });
    }

    return res.json({
      ok: true,
      reference,
      status: tx.status,
      amount: tx.amount,
      currency: tx.currency,
      email: tx.student_email,
      paid_at: tx.paid_at,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[payments/status]', err);
    return res.status(500).json({ ok: false, error: message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Refund
// POST /api/payments/refund
// ─────────────────────────────────────────────────────────────────────────────
router.post('/refund', async (req: Request, res: Response) => {
  try {
    const { reference, reason } = req.body;

    if (!reference || !reason) {
      return res.status(400).json({ ok: false, error: 'reference and reason are required' });
    }

    const tx = await queryOne<{
      id: string;
      status: string;
      amount: number;
      metadata: Record<string, unknown>;
    }>(
      `SELECT id, status, amount, metadata FROM payments WHERE transaction_id = $1`,
      [reference]
    );

    if (!tx) {
      return res.status(404).json({ ok: false, error: 'Transaction not found' });
    }
    if (tx.status !== 'SUCCESS') {
      return res.status(400).json({ ok: false, error: 'Only successful payments can be refunded' });
    }

    const paygateRef = tx.metadata?.paygate_ref as string | undefined;
    if (!paygateRef) {
      return res.status(400).json({ ok: false, error: 'No paygate_ref found on this transaction' });
    }

    await paygateRefund(paygateRef, tx.amount, reason);

    const updatedMeta = {
      ...tx.metadata,
      refund_reason: reason,
      refunded_at: new Date().toISOString(),
    };

    await query(
      `UPDATE payments SET status = 'REFUNDED', metadata = $1 WHERE id = $2`,
      [JSON.stringify(updatedMeta), tx.id]
    );

    return res.json({ ok: true, message: 'Refund processed successfully' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[payments/refund]', err);
    return res.status(500).json({ ok: false, error: message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Payment History — paginated, filterable
// GET /api/payments/history?status=SUCCESS&limit=20&offset=0
// ─────────────────────────────────────────────────────────────────────────────
router.get('/history', async (req: Request, res: Response) => {
  try {
    const {
      status,
      limit = '50',
      offset = '0',
      email,
    } = req.query as Record<string, string>;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status) {
      params.push(status.toUpperCase());
      conditions.push(`status = $${params.length}`);
    }
    if (email) {
      params.push(email.toLowerCase());
      conditions.push(`LOWER(student_email) = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const rows = await query(
      `SELECT id, transaction_id, student_email, amount, currency, status, payment_method, paid_at, metadata
       FROM payments
       ${where}
       ORDER BY paid_at DESC NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const [{ count }] = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM payments ${where}`,
      params.slice(0, params.length - 2)
    );

    return res.json({ ok: true, total: parseInt(count, 10), payments: rows });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[payments/history]', err);
    return res.status(500).json({ ok: false, error: message });
  }
});

export default router;
