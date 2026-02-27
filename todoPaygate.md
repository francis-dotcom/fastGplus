# Paygate Plus Setup Todo List

This document outlines the non-coding configuration steps required to set up Paygate Plus for **grandpluscollege.com**.

## 1. Paygate Plus Dashboard Configuration
- [ ] **Verify API Keys**: Ensure `API Key` and `Client Secret` in the Paygate Dashboard match the values in the local `.env` file.
- [ ] **Configure Webhook URL**:
    - URL: `https://grandpluscollege.com/api/v1/payments/webhook`
    - Purpose: Allows PayGate to notify the server of successful transactions.
- [ ] **Set Callback (Redirect) URLs**:
    - **Success URL**: `https://grandpluscollege.com/payment-success`
    - **Failure URL**: `https://grandpluscollege.com/support`
- [ ] **Enable Payment Channels**: Toggle ON the following methods:
    - [ ] Card
    - [ ] USSD
    - [ ] Bank Transfer
- [ ] **Domain Whitelisting**: Add authorized domains to prevent CORS issues.
    - [ ] `https://grandpluscollege.com`
    - [ ] `https://www.grandpluscollege.com`

## 2. Business & Compliance (KYC)
- [ ] **Account Verification**: Complete the KYC process on the Paygate platform.
    - [ ] Government-issued ID
    - [ ] Business Registration (CAC)
    - [ ] Proof of Address
- [ ] **Bank Settlement**: Link a valid bank account for receiving payouts.
- [ ] **Payout Schedule**: Select settlement frequency (Daily/Weekly).

## 3. Mandatory Website Policies
Ensure the following pages are accessible on the live site for gateway approval:
- [ ] **Terms & Conditions**
- [ ] **Privacy Policy**
- [ ] **Refund/Cancellation Policy**
- [ ] **Contact Information** (Clear support email and/or phone number)

## 4. Technical Readiness
- [ ] **SSL Certificate**: Verify site is served over HTTPS (already handled via Cloudflare/Nginx).
- [ ] **Integration Secrets**: Ensure `.env` is securely synced to the production server.
