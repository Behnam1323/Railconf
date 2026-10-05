# Railway Xray VLESS + WebSocket + TLS

A real Xray-core VLESS server packaged for Railway.

## Architecture

Client
  -> HTTPS/TLS :443 on Railway
  -> WebSocket /api/ws
  -> Node WebSocket gateway
  -> Xray on 127.0.0.1:10000
  -> Freedom outbound
  -> Internet

Railway provides the public TLS certificate. Xray does not terminate TLS inside
the container.

## Deploy

1. Create a new Railway project/service.
2. Deploy this repository (or upload the project through your preferred Git workflow).
3. Railway detects the root `Dockerfile`.
4. After the first deploy, open:
   Settings -> Networking -> Generate Domain
5. Copy the generated domain, for example:
   `your-service.up.railway.app`
6. In Variables add:
   `DOMAIN=your-service.up.railway.app`
7. Add a strong random:
   `ADMIN_TOKEN=change-this-to-a-long-random-value`
8. Redeploy.

Do NOT set PORT manually unless you have a specific reason. The application
reads Railway's `PORT` automatically.

## Variables

- `DOMAIN` - your Railway public domain, without https://
- `UUID` - optional. If omitted, a UUID is generated at startup.
- `ADMIN_TOKEN` - required to access `/api/config`
- `WS_PATH` - optional, default `/api/ws`
- `XRAY_PORT` - internal only, default 10000

## Get the generated VLESS URI

After setting DOMAIN and redeploying, open:

`https://YOUR-DOMAIN/api/config?token=YOUR_ADMIN_TOKEN`

The response contains a ready VLESS URI.

The startup logs also print the URI.

## v2rayNG fields

Address: YOUR-DOMAIN
Port: 443
UUID: value from /api/config
Flow: blank
Encryption: none
Network: ws
Path: /api/ws
Host: YOUR-DOMAIN
Security: tls
SNI: YOUR-DOMAIN
Fingerprint: chrome

## Real-delay verification

The important test is the client application's real delay/latency test.
It must actually establish VLESS -> WebSocket -> Xray -> Freedom -> Internet.

`/health` only proves that the HTTP service is alive; it is NOT a proxy
connectivity test.

If v2rayNG shows a real delay and browsing works through the profile, the
end-to-end path is functioning.

## Railway port

Use the automatically assigned `PORT` for the public HTTP/WebSocket gateway.
Do not create a TCP Proxy for this VLESS-WS-TLS profile. Public access is
HTTP/HTTPS and Railway supplies TLS.

The Xray port 10000 is internal to the container.

## Notes

- This is a single-user/basic inbound configuration.
- For production use, set a fixed UUID in Railway Variables so it survives restarts.
- Keep ADMIN_TOKEN secret.
- Do not expose `/api/config` without the token.
