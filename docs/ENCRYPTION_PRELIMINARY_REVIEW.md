# Pinglet encryption — preliminary source review

**Review date:** 10 November 2026  
**Scope:** static inspection of `public/app.js`, `public/index.html`, and relevant API routes in `server.js` on `main`.  
**Review type:** preliminary engineering review only — **not an independent cryptographic audit, penetration test, or assurance statement**.

## Observed design

- Client generates a long-lived P-256 ECDH key pair using the Web Crypto API.
- The private `CryptoKey` is stored in IndexedDB under the account UUID. It is generated as non-extractable, but is still usable by JavaScript executing in the same origin.
- The server stores and returns account public keys. Friend lists and lookup responses include the peer's public JWK.
- The client imports the peer public key and directly derives an AES-GCM-256 key from ECDH. Messages are encrypted with AES-GCM and a random 12-byte IV; the API stores ciphertext and IV.
- The UI currently says: “Messages use experimental encryption. Friend identity keys are not verified.”

## Findings and review questions

### High — peer identity is not cryptographically verified

The client imports the public key supplied by the backend without a key-transparency, signed-key, out-of-band fingerprint, or authenticated key-change confirmation mechanism being visible in the inspected path. A server/database compromise or key-substitution event could cause users to derive a shared key with an attacker's key while the interface still presents the contact as the expected friend.

**Required action:** a qualified reviewer must design and verify an authenticated identity-key binding and safe key-change UX. Do not tell users that a contact's identity is cryptographically verified.

### High — long-lived static keys provide no demonstrated forward secrecy

The same account private ECDH key is retained locally and used to derive each peer chat key. No per-message ratchet, ephemeral session key rotation, or forward-secrecy mechanism was visible in this path. Compromise of a long-lived private key could therefore expose recorded messages for peers whose corresponding public keys remain available.

**Required action:** have a specialist evaluate a mature messaging protocol with forward secrecy and post-compromise security. Do not invent a ratchet in an unreviewed patch.

### High — same-origin compromise can use the locally stored private key

The private CryptoKey is marked non-extractable, which prevents straightforward raw-key export, but JavaScript executing in the app's origin can still request cryptographic operations with a key available to the application. Non-extractability alone does not protect messages from a compromised app origin, malicious dependency, or XSS.

**Required action:** review the complete script supply chain, CSP, XSS surface, dependency/update process, local storage threat model, and device compromise assumptions.

### Medium / design review — direct ECDH-to-AES key derivation

The inspected code derives the AES-GCM key directly from ECDH rather than showing an explicit, context-bound KDF layer. A cryptographer should assess whether the protocol requires HKDF, transcript binding, identities/roles, versioning, and domain separation, and specify a migration-safe design.

### Medium — no visible key rotation, multi-device migration, or recovery protocol

The private key is stored per browser/device account. The reviewed path did not show a user-verifiable recovery, multi-device synchronization, or safe key rotation workflow. Losing browser storage may make historic messages undecryptable; adding cloud key escrow would create a separate risk and must not be done casually.

**Required action:** document device-loss and key-change behavior and design any recovery flow with specialist input.

### Scope limitation — voice-message encryption needs its own end-to-end trace

The README describes voice recordings as using the existing experimental encryption, but this preliminary inspection did not trace every media/blob conversion, upload, playback, caching, and deletion path. Voice-message confidentiality and retention must be separately reviewed.

## What this review does not establish

- It does not prove an exploitable vulnerability in every deployment.
- It does not verify the Web Crypto implementation on every supported browser/device.
- It does not review all application code, dependency versions, runtime configuration, browser storage behavior, server logs, TLS configuration, or a production build.
- It does not replace an independent cryptographer, penetration tester, or privacy review.

## Release recommendation

Keep the current warning in the UI. Do not market Pinglet as audited, identity-verified, or production-grade end-to-end encrypted. Do not use it for sensitive conversations until an independent specialist has reviewed the complete design, issued a written report, and verified remediations.
