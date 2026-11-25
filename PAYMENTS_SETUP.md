# AgentCoPilot payment integration setup

## Current implementation stage

This branch now contains owner-only payment settings, encrypted provider credentials, configurable viewing fees and booking deposits, server-calculated checkout, transaction records, server-side provider verification, signed webhook endpoints, and a payment return page. It has passed source syntax checks but has NOT been deployed or tested with real provider sandbox credentials. Do not enable live payments until the complete sandbox and webhook tests pass.

## Required deployment secret

Before the owner can save provider credentials, configure a deployment-specific 32-byte encryption key as a Cloudflare Worker secret named `PAYMENT_ENCRYPTION_KEY`. Generate it locally with `openssl rand -base64 32`. Do not commit it, paste it into frontend code, or share it in a support message. Add it with `npx wrangler secret put PAYMENT_ENCRYPTION_KEY` while authenticated to the correct Cloudflare account and Worker.

The Worker uses AES-256-GCM to encrypt provider secret keys and webhook signing secrets before writing them to D1. The encryption key must remain stable; replacing it without re-encrypting stored values makes existing credentials unreadable. Back it up in the deployment owner's secure secrets manager.

## Owner setup

1. The deployment owner creates and verifies a Paystack or Flutterwave merchant account.
2. Start with the provider's test keys and test webhook secret/hash.
3. Sign in to AgentCoPilot using the Firestore account whose `users/{uid}.role` is `owner`.
4. Open **Payment Settings**, choose the provider and test mode, and enter the provider public key, secret key, and webhook signing secret/hash.
5. Do not switch to live mode until checkout and webhook tests pass and the provider has approved the merchant account.

## Owner pricing controls

- Select one deployment payment currency (for example NGN, USD, GBP, or EUR).
- Viewing fee: free or a fixed amount in the selected currency.
- Booking deposit: disabled, a fixed amount in the selected currency, or a percentage from greater than 0 up to 100 of the listed property price.
- The Worker validates and stores these settings. The customer-facing checkout must calculate the amount on the server, not trust an amount submitted by the browser.
- Until multi-currency conversion is explicitly implemented, checkout must reject listings whose currency does not match the owner's configured payment currency. No automatic exchange-rate conversion is assumed.
- These settings are for AgentCoPilot-managed listings only. External property search results must never be charged through the deployment owner's merchant account.

## Checkout and webhook configuration

- Configure the Worker variable `PAYMENT_RETURN_URL` to the deployed `payment-result.html` URL. The development fallback is `https://etidoz1.github.io/Agentcopilot-html/payment-result.html`; change it for another deployment/domain.
- Set the Paystack webhook URL to `https://<your-worker-domain>/api/webhooks/paystack`.
- Set the Flutterwave webhook URL to `https://<your-worker-domain>/api/webhooks/flutterwave` and use the same webhook secret hash entered in Payment Settings.
  Flutterwave sends that exact value in the `verif-hash` request header; the Worker compares it directly, then independently verifies the transaction with Flutterwave. It does not calculate an HMAC of the webhook body.
- Checkout is initiated by the Worker. Paystack and Flutterwave secret keys never reach the browser. Each pending transaction stores encrypted snapshots of the provider secrets so a credential rotation does not break verification of an already-started payment.
- The return page does not trust the provider redirect parameters. It asks the Worker to verify the transaction with the provider before marking it successful. Webhook notifications are only hints: the Worker re-verifies provider transaction ID/reference, successful status, amount, and currency against the stored transaction before marking it paid.
- Payment success is idempotent: repeated webhook deliveries do not repeat the success update or notifications.
- Payments settle to the merchant account connected by the deployment owner. This integration is not escrow and does not hold or distribute funds to property sellers.

## Security

- Only a Firebase-authenticated `owner` role can read or update payment settings. Admin role alone is not sufficient.
- Secret values are write-only in the UI and encrypted in D1 using the Worker secret.
- Never store secret keys in HTML, JavaScript, Git, browser storage, or logs.
- A redirect to the app is not proof of payment. Future fulfillment must rely on server-side provider verification and validated webhooks.

## Required sandbox test checklist before live mode

- Paystack: successful checkout, cancelled checkout, failed checkout, valid signed webhook, invalid signature, stale timestamp for `Paystack-Signature`, legacy `x-paystack-signature` only when the provider still sends it, and repeated webhook delivery.
- Flutterwave: successful checkout, cancelled checkout, failed checkout, correct `verif-hash`, missing or incorrect `verif-hash`, invalid transaction ID, wrong reference, wrong amount, wrong currency, and repeated webhook delivery.
- For both providers, confirm buyer and seller are notified once only, booking moves to `paid` only after provider-side verification, and a browser redirect alone never marks payment successful.
- Test with sandbox credentials and test funds only. Do not enable live keys until every case passes.
