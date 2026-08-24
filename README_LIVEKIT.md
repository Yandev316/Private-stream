LiveKit scaffold for Private Stream

Overview
- This scaffold adds a simple LiveKit integration to the existing project.
- It provides a server endpoint `/livekit/token` that mints access tokens for clients.
- It includes a demo client at `public/livekit.html` which requests a token, connects to LiveKit, captures the screen and publishes tracks.

Prerequisites
- Docker and Docker Compose (to run a LiveKit server locally)
- Environment variables set for the app server:
  - `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` — should match the LiveKit server configuration.
  - `LIVEKIT_URL` — the websocket URL for the LiveKit server (for example `ws://localhost:7880` or `wss://livekit.example.com`).

Running LiveKit server locally (quick start)
1. Create a `docker-compose.yml` containing LiveKit (example from LiveKit docs). A minimal docker-compose is:

```yaml
version: '3.7'
services:
  livekit:
    image: livekit/livekit-server:latest
    ports:
      - '7880:7880'
      - '80:80'
    environment:
      - LIVEKIT_KEYS=examplekey:examplesecret
      - LIVEKIT_LISTEN_ADDR=0.0.0.0:7880
```

2. Start:

```bash
docker-compose up -d
```

3. Use the key `examplekey` and secret `examplesecret` as `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` in your app's environment.

Running the scaffolded app
1. Install dependencies:

```bash
npm install
```

2. Set environment variables and start:

```powershell
$env:LIVEKIT_API_KEY='examplekey'
$env:LIVEKIT_API_SECRET='examplesecret'
$env:LIVEKIT_URL='ws://localhost:7880'
node server.js
```

3. Open `http://localhost:3000/livekit.html` in your browser and test transmitting.

Notes and next steps
- This scaffold assumes you run a LiveKit server; it does not embed an SFU in this repo.
- For production, run LiveKit behind TLS and configure TURN/STUN properly.
- You can extend the demo to integrate room management, permissions, and simulcast profiles.
