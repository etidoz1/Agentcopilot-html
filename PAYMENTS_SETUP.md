# AgentCoPilot payment integration setup

## Current implementation stage

This branch adds an owner-only Payment Settings screen and server-side encrypted storage for Paystack or Flutterwave credentials. It does not yet enable customer checkout or mark any viewing fee/booking deposit as paid. Those flows require server-calculated charges, transaction verification, signed webhook handling, and the final fee/deposit rules.

## Required deployment secret

Before the owner can save provider credentials, configure a deployment-specific 32-byte encryption key as a Cloudflare Worker secret named `PAYMENT_ENCRYPTION_KEY`. Generate it locally with `openssl rand -base64 32`. Do not commit it, paste it into frontend code, or share it in a support message. Add it with `npx wrangler secret put PAYMENT_ENCRYPTION_KEY` while authenticated to the correct Cloudflare account and Worker.

The Worker uses AES-256-GCM to encrypt provider secret keys and webhook signing secrets before writing them to D1. The encryption key must remain stable; replacing it without re-encrypting stored values makes existing credentials unreadable. Back it up in the deployment owner's secure secrets manager.

## Owner setup

1. The deployment owner creates and verifies a Paystack or Flutterwave merchant account.
2. Start with the provider's test keys and test webhook secret/hash.
3. Sign in to AgentCoPilot using the Firestore account whose `users/{uid}.role` is `owner`.
4. Open **Payment Settings**, choose the provider and test mode, and enter the provider public key, secret key, and webhook signing secret/hash.
5. Do not switch to live mode until checkout and webhook tests pass and the provider has approved the merchant account.

## Security

- Only a Firebase-authenticated `owner` role can read or update payment settings. Admin role alone is not sufficient.
- Secret values are write-only in the UI and encrypted in D1 using the Worker secret.
- Never store secret keys in HTML, JavaScript, Git, browser storage, or logs.
- A redirect to the app is not proof of payment. Future fulfillment must rely on server-side provider verification and validated webhooks.
