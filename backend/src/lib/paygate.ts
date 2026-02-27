import crypto from 'crypto';
import { config } from '../config.js';

// ─────────────────────────────────────────────────────────────────────────────
// Reference & Signature
// ─────────────────────────────────────────────────────────────────────────────

export function generateReference(): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `GPC-${timestamp}-${random}`;
}

// PayGate Plus spec: MD5( requestRef + ";" + clientSecret )
export function generateSignature(requestRef: string): string {
  const raw = `${requestRef};${config.paygate.clientSecret}`;
  return crypto.createHash('md5').update(raw).digest('hex');
}

export function verifyWebhookSignature(
  requestRef: string,
  receivedChecksum: string
): boolean {
  const expected = generateSignature(requestRef);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(receivedChecksum)
    );
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Centralized HTTP wrapper — all PayGate calls go through here
// ─────────────────────────────────────────────────────────────────────────────

async function request<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const url = `${config.paygate.baseUrl}${path}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.paygate.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayGate ${path} failed (${res.status}): ${err}`);
  }

  return res.json() as Promise<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// PayGate API calls
// ─────────────────────────────────────────────────────────────────────────────

export async function paygateInitialize(payload: {
  reference: string;
  amount: number; // in Naira — converted to kobo internally
  email: string;
  currency?: string;
}): Promise<{ payment_url: string; paygate_ref: string }> {
  return request('/v1/payments/initialize', {
    api_key: config.paygate.apiKey,
    request_ref: payload.reference,
    amount: Math.round(payload.amount * 100), // kobo
    email: payload.email,
    currency: payload.currency ?? 'NGN',
    callback_url: `${config.app.baseUrl}/api/payments/webhook`,
    return_url: `${config.app.baseUrl}/payment-success`,
    checksum: generateSignature(payload.reference),
  });
}

export async function paygateVerify(reference: string): Promise<{
  status: string;
  paygate_ref: string;
  amount: number;
}> {
  return request('/v1/payments/verify', {
    api_key: config.paygate.apiKey,
    request_ref: reference,
    checksum: generateSignature(reference),
  });
}

export async function paygateRefund(
  reference: string,
  paygateRef: string,
  amount: number,
  reason: string
): Promise<void> {
  await request('/v1/payments/refund', {
    api_key: config.paygate.apiKey,
    request_ref: reference,
    paygate_ref: paygateRef,
    amount: Math.round(amount * 100),
    reason,
    checksum: generateSignature(reference),
  });
}
