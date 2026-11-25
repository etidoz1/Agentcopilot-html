# AgentCoPilot payment integration setup

## Current implementation stage

This branch adds an owner-only Payment Settings screen, encrypted storage for Paystack or Flutterwave credentials, and owner-configurable viewing-fee and booking-deposit rules. Customer checkout is not enabled yet; no transaction can be initiated or marked paid at this stage. Checkout still requires server-calculated charges, transaction records, provider verification, signed webhook handling, and a real sandbox test.

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

## Security

- Only a Firebase-authenticated `owner` role can read or update payment settings. Admin role alone is not sufficient.
- Secret values are write-only in the UI and encrypted in D1 using the Worker secret.
- Never store secret keys in HTML, JavaScript, Git, browser storage, or logs.
- A redirect to the app is not proof of payment. Future fulfillment must rely on server-side provider verification and validated webhooks.
