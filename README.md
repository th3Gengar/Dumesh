# Dumesh

End-to-end encrypted messenger with dual-mode connectivity: cloud (Firebase + Google Auth) and offline LAN mesh for disaster/blackout scenarios.

## Features

- **E2E Encryption** — RSA + AES hybrid encryption. Private keys never leave your browser.
- **Cloud Mode** — Firebase Auth (Google sign-in), Firestore for real-time sync.
- **LAN Disaster Mesh** — Offline-first local Express server with file-backed database. No internet required.
- **Admin Controls** — Email whitelist, group management, user authorization, emergency self-auth override.
- **Telegram Feed** — Scrape and display posts from public Telegram channels.
- **Group & Direct Chats** — Encrypted group rooms with per-member key distribution and 1-on-1 direct messaging.

## Tech Stack

React, TypeScript, Vite, Tailwind CSS, Express, Firebase

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in your Firebase credentials.

3. Run the dev server:
   ```
   npm run dev
   ```

The app will be available at `http://localhost:3000`.

## Build

```
npm run build
npm start
```

## License

MIT
