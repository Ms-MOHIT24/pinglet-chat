# Pinglet — private chat demo

This repository contains the Pinglet browser-chat prototype. It provides friend codes, one-to-one messaging, local friendship labels, and a solo Rock/Paper/Scissors mini-game.

## Important limitations
- The current encryption is experimental ECDH + AES-GCM. Identity keys are not verified and this is not a Signal-protocol implementation or an audited messenger. Do not use it for sensitive conversations.
- The initial hosted demo uses SQLite on an ephemeral filesystem. Account and message data may be lost when the free service restarts or redeploys. Do not rely on it for durable chat history.
- Friend-list persistence, multi-device recovery, verified identity fingerprints, group chats, media, and multiplayer games are not included in this prototype.
- Performance and availability depend on the hosting provider and network; zero lag / zero bugs cannot be guaranteed.

## Deployment
Render runs the app with Node.js. The service needs `JWT_SECRET` set to a unique secret of at least 32 bytes. The source archive is decoded during build; the server listens on Render's `PORT`.
