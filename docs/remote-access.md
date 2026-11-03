# Control the printer from anywhere (Tailscale)

The hosted site (Vercel) can only **view** the printer: Bambu's firmware rejects control commands
sent through Bambu Cloud unless they are signed by Bambu's own apps. Full control works over the
LAN, so the way to control from anywhere is to reach **a computer at home** that runs this app.
[Tailscale](https://tailscale.com) gives your phone a private, encrypted link to that computer
without opening any port on your router.

```text
phone (anywhere) ──Tailscale──► home computer: this app ──LAN MQTT──► P1S
```

## 1. Printer

On the printer's screen: **Settings → LAN Only mode: on**, then **Developer Mode: on**. Note the
8-character **access code** on the same screen. (While LAN Only is on, Handy and cloud printing do
not reach the printer.)

## 2. Home computer (same Wi-Fi as the printer)

1. Install Tailscale and sign in. Its machine name is shown in the Tailscale app, or in the admin
   console under **Machines**, e.g. `home-pc.tail1234.ts.net` (MagicDNS name).
2. Start the app and allow exactly that name:

   ```bash
   git pull origin main && npm install && npm run build
   P1S_ALLOWED_HOSTS=home-pc.tail1234.ts.net npm start
   ```

   (Windows PowerShell: `$env:P1S_ALLOWED_HOSTS="home-pc.tail1234.ts.net"; npm start`.)
   Or put the line in `.env.local`.

3. Open `http://localhost:3000`, enter the access code, press **Connect**. Controls unlock.
4. Keep the computer awake (disable sleep) while you want remote control.

## 3. Phone

1. Install Tailscale and sign in with the **same** account.
2. Open `http://home-pc.tail1234.ts.net:3000/display` (display only) or `…:3000/` (console).

Optional HTTPS: on the home computer run `tailscale serve --bg 3000`, then open
`https://home-pc.tail1234.ts.net/display`. (Requires HTTPS certificates enabled in the Tailscale
admin console under DNS.)

## Safety

- `P1S_ALLOWED_HOSTS` accepts **only the exact names listed**. Other devices on your Wi-Fi, other
  machines in your tailnet with different names, and other websites are still refused.
  `P1S_ALLOW_LAN_CLIENTS=1` is broader (any device on your network) — prefer the allow-list.
- Do **not** use `tailscale funnel`: it publishes the app on the public internet, and the app has
  no login of its own — anyone with the link could stop your print.

## Troubleshooting

| Symptom                                                        | Fix                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `This server only accepts requests to localhost. To allow "x"` | Add exactly `x` to `P1S_ALLOWED_HOSTS` and restart.                                   |
| Page does not load from the phone                              | Both devices online in the Tailscale app? Computer awake? `npm start` still running?  |
| Controls greyed out, "Read-only via Bambu Cloud"               | You are connected through the cloud: connect with the access code (step 2.3) instead. |
| Printer refuses commands                                       | Developer Mode is off, or LAN Only is off — enable both on the printer and reconnect. |
