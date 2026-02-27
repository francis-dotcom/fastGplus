import crypto from 'crypto';
import { config } from '../config.js';

export function generateReference(): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `GPC-${timestamp}-${random}`;
}

export function generateSignature(params: Record<string, string>): string {
  // Sort keys alphabetically, concat all values + client secret, then MD5
  const concatenated =
    Object.keys(params)
      .sort()
      .map((k) => params[k])
      .join('') + config.paygate.clientSecret;
  return crypto.createHash('md5').update(concatenated).digest('hex');
}

export function verifyWebhookSignature(
  payload: Record<string, string>,
  receivedChecksum: string
): boolean {
  const { checksum: _omit, ...rest } = payload;
  const expected = generateSignature(rest);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(receivedChecksum)
    );
  } catch {
    return false;
  }
}

export async function paygateInitialize(payload: {
  reference: string;
  amount: number; // in Naira
  email: string;
  currency?: string;
}): Promise<{ payment_url: string; paygate_ref: string }> {
  const params: Record<string, string> = {
    api_key: config.paygate.apiKey,
    reference: payload.reference,
    amount: String(Math.round(payload.amount * 100)), // convert to kobo
    email: payload.email,
    currency: payload.currency ?? 'NGN',
    callback_url: `${config.app.baseUrl}/api/payments/webhook`,
    return_url: `${config.app.baseUrl}/payment-success`,
  };
  params.checksum = generateSignature(params);

  const res = await fetch(`${config.paygate.baseUrl}/v1/payments/initialize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayGate initialize failed (${res.status}): ${err}`);
  }

  return res.json() as Promise<{ payment_url: string; paygate_ref: string }>;
}

export async function paygateVerify(reference: string): Promise<{
  status: string;
  paygate_ref: string;
  amount: number;
}> {
  const params: Record<string, string> = {
    api_key: config.paygate.apiKey,
    reference,
  };
  params.checksum = generateSignature(params);

  const res = await fetch(`${config.paygate.baseUrl}/v1/payments/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayGate verify failed (${res.status}): ${err}`);
  }

  return res.json() as Promise<{ status: string; paygate_ref: string; amount: number }>;
}

export async function paygateRefund(
  paygateRef: string,
  amount: number,
  reason: string
): Promise<void> {
  const params: Record<string, string> = {
    api_key: config.paygate.apiKey,
    paygate_ref: paygateRef,
    amount: String(Math.round(amount * 100)),
    reason,
  };
  params.checksum = generateSignature(params);

  const res = await fetch(`${config.paygate.baseUrl}/v1/payments/refund`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayGate refund failed (${res.status}): ${err}`);
  }
}
