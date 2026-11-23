# AgentCopilot
A property-operations workspace with separate owner, administrator and agent experiences.

## Roles
- Owner: reads all workspace users and leads; may assign admin or agent roles; owner identity is protected.
- Admin: manages regular agent accounts and agent-created leads; cannot read owner-only data or change roles.
- Agent: manages their own leads and profile.
- Public registration always creates an agent. Never expose an owner/admin role selector on registration.

## Firebase setup (required)
Project: agentcopilot-98817.
1. Enable Email/Password in Firebase Authentication.
2. Create a Cloud Firestore database.
3. Deploy firestore.rules using Firebase CLI (firebase deploy --only firestore:rules) or paste the rules into Firestore > Rules.
4. Register your intended owner account through the app.
5. In Firestore, open users/{that-auth-uid} and change role from agent to owner. Do this only for the intended owner account; set status to active.
6. Sign out and sign back in. All other public registrations remain agents.
Do not make users publicly readable. Firestore rules, not hidden navigation, are the security boundary. Test with Firebase Emulator before production.

## API setup
Install Node.js 18+, run npm install, copy .env.example to .env, set FIREBASE_API_KEY, FIREBASE_PROJECT_ID and GEMINI_API_KEY, then run npm start. Keep .env out of Git. Set CLIENT_ORIGIN to the exact frontend origin. GitHub Pages hosts static files only; deploy server.js separately to a Node host and set window.AGENTCOPILOT_API_URL to that API origin before loading app.js.

## Verification
Run npm test and node --check server.js. These are smoke checks only, not full Firebase Emulator or end-to-end browser tests.
