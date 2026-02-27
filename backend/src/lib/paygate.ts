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
// Used both as the Signature header and for webhook verification
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
// Per docs: Authorization header + Signature header (MD5 of request_ref;secret)
// ─────────────────────────────────────────────────────────────────────────────

async function request<T>(
  path: string,
  requestRef: string,
  body: Record<string, unknown>
): Promise<T> {
  const url = `${config.paygate.baseUrl}${path}`;
  const signature = generateSignature(requestRef);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.paygate.apiKey}`,
      'Signature': signature,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`PayGate ${path} failed (${res.status}): ${text}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`PayGate ${path} returned non-JSON: ${text}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PayGate API calls
// ─────────────────────────────────────────────────────────────────────────────

export async function paygateInitialize(payload: {
  reference: string;
  amount: number;      // Naira — converted to kobo internally
  email: string;
  payerName?: string;
  currency?: string;
  feeType?: string;
}): Promise<{ payment_url: string; paygate_ref: string; raw: unknown }> {

  // Split full name into firstname / surname for PayGate customer object
  const parts = (payload.payerName ?? '').trim().split(/\s+/);
  const firstname = parts[0] || 'Student';
  const surname   = parts.slice(1).join(' ') || firstname;

  const body = {
    request_ref:  payload.reference,
    request_type: 'collect',
    auth: {
      type:          null,
      secure:        null,
      auth_provider: 'Fidelity',
      route_mode:    null,
    },
    transaction: {
      transaction_ref:        payload.reference,
      transaction_desc:       `GPC Fee: ${payload.feeType ?? 'General'}`,
      transaction_ref_parent: null,
      amount:                 Math.round(payload.amount * 100), // kobo
      customer: {
        customer_ref: payload.email,
        firstname,
        surname,
        email:        payload.email,
        mobile_no:    '',
      },
      meta: {
        fee_type:    payload.feeType ?? '',
        return_url:  `${config.app.baseUrl}/payment-success`,
        webhook_url: `${config.app.baseUrl}/api/payments/webhook`,
      },
    },
  };

  const data = await request<Record<string, unknown>>(
    '/v1/payments/basic',
    payload.reference,
    body
  );

  // Log the full response so we can inspect it on the server
  console.info('[paygate/initialize] ref=%s response=%s', payload.reference, JSON.stringify(data));

  // Extract charge_token from response data
  const inner     = data?.data as Record<string, unknown> | null;
  const token     = (inner?.charge_token ?? inner?.chargeToken ?? '') as string;
  const paygateRef = (inner?.transaction_ref ?? inner?.reference ?? payload.reference) as string;

  if (!token) {
    // If no charge_token, surface the full response in the error for debugging
    throw new Error(`PayGate returned no charge_token. Full response: ${JSON.stringify(data)}`);
  }

  // Hosted checkout page — students are redirected here to enter card/bank details
  const payment_url = `https://paygateplus.ng/checkout/${token}`;

  return { payment_url, paygate_ref: paygateRef, raw: data };
}

export async function paygateVerify(reference: string): Promise<{
  status: string;
  paygate_ref: string;
  amount: number;
}> {
  const data = await request<Record<string, unknown>>(
    '/v2/transact/query',
    reference,
    {
      request_ref:  reference,
      request_type: 'collect',
      auth: {
        secure:        null,
        auth_provider: 'Fidelity',
      },
      transaction: {
        transaction_ref: reference,
      },
    }
  );

  const inner = data?.data as Record<string, unknown> | null;
  const provResp = inner?.provider_response as Record<string, unknown> | null;
  return {
    status:      (data?.status as string) === 'Successful' ? 'SUCCESS' : (data?.status as string ?? 'UNKNOWN'),
    paygate_ref: (provResp?.reference ?? reference) as string,
    amount:      (provResp?.transaction_final_amount ?? 0) as number,
  };
}

export async function paygateRefund(
  reference: string,
  paygateRef: string,
  amount: number,
  reason: string
): Promise<void> {
  await request('/v1/payments/refund', reference, {
    request_ref:  reference,
    request_type: 'refund',
    auth: {
      type:          null,
      secure:        null,
      auth_provider: 'Fidelity',
    },
    transaction: {
      transaction_ref:        reference,
      transaction_ref_parent: paygateRef,
      transaction_desc:       reason,
      amount:                 Math.round(amount * 100),
    },
  });
}
