# Jitsi server for every video call (`meet.thenura.care`)

A **dedicated** host running the official [docker-jitsi-meet](https://github.com/jitsi/docker-jitsi-meet)
release `stable-11248`, locked down for 1:1 calls: patient–doctor consultations and Period
Buddy calls. It is the **only** video path in Nura (there is no WebRTC fallback any more).
It runs on its own host, never on the
API server: video is CPU- and bandwidth-heavy, and a call spike must not take the API down.

| File | Role |
|---|---|
| `install.sh` | Installs Docker if missing, downloads the pinned release, creates `/opt/jitsi/.env` once (secrets), layers `nura.env`, starts web/prosody/jicofo/jvb |
| `nura.env` | Our settings (no secrets): JWT-only auth, token-based roles, recording/streaming/P2P off |
| `custom-config.js`, `custom-interface_config.js` | Web UI defaults (no invite, no promos, no third-party requests) |
| `../cloudformation/jitsi.yml` | Optional EC2 host (own VPC, security group, Elastic IP, SSM, encrypted disk) |
| `../../src/scripts/jitsiTokenCheck.js` | Prints test links to prove the server refuses bad tokens |

How a call is authorised: see the API's `src/utils/videoCall.js`. In short, the API checks
the booking (assigned doctor or booked patient, paid, inside the join window) or the Period Buddy
pairing (active, both accounts live; both buddies are plain participants) and signs a token
for **one room and one person** that lasts at most `JITSI_TOKEN_TTL_SECONDS`. The Jitsi server
refuses anyone without a valid token (`JWT_ALLOW_EMPTY=0`, no guest domain). A token for another
room is refused too (prosody `token_verification` checks the `room` claim). Moderator comes
**only** from the token's `context.user.affiliation` (prosody `token_affiliation`).

> **Why jicofo auth and auto-owner are off.** Verified in the jicofo source used by this release
> (`JitsiMeetConferenceImpl` → `AuthenticationRoleManager`): when jicofo authentication is on, it
> makes **every** authenticated participant a moderator, the patient included. Auto-owner makes
> whoever joins first a moderator. So `JICOFO_ENABLE_AUTH=0` + `ENABLE_AUTO_OWNER=0`, and prosody
> alone decides. Prosody still requires the token to connect at all. Re-verify after any upgrade
> (step 6 checks it).

---

## 1. Choose the host

**First check the AWS credits.** This couldn't be checked from the repo (no AWS access). In the
AWS console go to **Billing and Cost Management → Credits**. For each credit, open it and read
**Applicable products / services** and the expiry. Promotional credits usually cover both
Lightsail and EC2, but some programmes exclude services or cap them. Data transfer is billed as
part of the service, so check that it's covered too.

| | Lightsail 4 GB (recommended) | EC2 `t3.medium` (template) |
|---|---|---|
| Size | 2 vCPU, 4 GB, 80 GB SSD | 2 vCPU, 4 GiB, 30 GB gp3 |
| Price (Mumbai) | $24/month **with 2 TB transfer** (Mumbai bundles get half the usual allowance) | ~ $33/month compute + ~ $0.11/GB data out beyond the free tier |
| Fits because | Video is mostly bandwidth: a 1:1 call through the bridge sends roughly 1–3 GB/hour out. A flat bundle is cheaper and predictable | CloudFormation-managed, VPC, SSM, easy resize to `c6i/c7i` |
| Watch | Burstable CPU (like `t3`): load-test; resize = snapshot → bigger bundle | Pay per GB of video; burst credits (template sets `unlimited`) |

**Recommendation:** Lightsail 4 GB in Mumbai (`ap-south-1`), if the credits cover Lightsail.
Otherwise use EC2 with `../cloudformation/jitsi.yml`. Any other Ubuntu 24.04 VPS with a static IP
works the same way: `install.sh` doesn't depend on AWS.

**Capacity is unknown until load-tested.** 4 GB is a pilot size. A rough planning figure is a
few dozen concurrent 1:1 calls, but that depends on resolution, simulcast and the CPU. Before
launch, run `jitsi-meet-torture` (or the `ENABLE_LOAD_TEST_CLIENT` page) with N parallel 2-person
rooms. Watch CPU, `jvb` stress (`curl -s localhost:8080/colibri/stats` on the host) and packet
loss, then size for peak plus headroom.

### Ports (security group / Lightsail firewall)

| Port | Proto | Source | Why |
|---|---|---|---|
| 443 | TCP | 0.0.0.0/0 (and ::/0 if IPv6) | Web app, XMPP over WebSocket, bridge channel |
| 80 | TCP | 0.0.0.0/0 | Let's Encrypt HTTP-01 challenge + redirect to HTTPS |
| 10000 | UDP | 0.0.0.0/0 | Media (JVB) |
| 22 | TCP | **your admin /32 only**, or closed | Admin. Prefer SSM Session Manager (EC2) / the Lightsail browser SSH with 22 restricted |

Nothing else. JVB's 8080 and jicofo's 8888 are bound to `127.0.0.1` by the release's
compose file. Networks that block all UDP will fail to get media. If pilot users report "connected
but no video", add a TURN server (coturn on 443/TCP+TLS). It's deliberately not in this pilot.

### 1a. Lightsail

```bash
REGION=ap-south-1
aws lightsail create-instances --region $REGION --instance-names nura-jitsi \
  --availability-zone ${REGION}a --blueprint-id ubuntu_24_04 --bundle-id medium_3_0
aws lightsail allocate-static-ip --region $REGION --static-ip-name nura-jitsi-ip
aws lightsail attach-static-ip --region $REGION --static-ip-name nura-jitsi-ip --instance-name nura-jitsi
aws lightsail put-instance-public-ports --region $REGION --instance-name nura-jitsi --port-infos \
  'fromPort=443,toPort=443,protocol=tcp' 'fromPort=80,toPort=80,protocol=tcp' \
  'fromPort=10000,toPort=10000,protocol=udp' \
  'fromPort=22,toPort=22,protocol=tcp,cidrs=<YOUR.ADMIN.IP>/32'
aws lightsail get-static-ip --region $REGION --static-ip-name nura-jitsi-ip --query staticIp.ipAddress
```

Check `aws lightsail get-bundles` for the 4 GB bundle id in your account (`medium_3_0` at the
time of writing). Turn on automatic snapshots for the instance (Lightsail → Snapshots).

### 1b. EC2 (CloudFormation)

```bash
aws cloudformation deploy --region ap-south-1 --stack-name nura-jitsi \
  --template-file infra/cloudformation/jitsi.yml --capabilities CAPABILITY_IAM
  # optional: --parameter-overrides InstanceType=t3.medium AdminCidr=<YOUR.ADMIN.IP>/32
aws cloudformation describe-stacks --region ap-south-1 --stack-name nura-jitsi --query 'Stacks[0].Outputs'
```

The template creates its own VPC, security group (table above, no SSH unless `AdminCidr`),
Elastic IP, an encrypted 30 GB gp3 disk kept on termination, IMDSv2, an SSM role, and Docker
with log rotation via user data. Open a shell with the `SessionManagerCommand` output.

## 2. DNS

At the DNS provider for `thenura.care` (Spaceship, see `docs/INFRASTRUCTURE.md` §8): an **A record `meet` → the static/Elastic IP**, with a
low TTL (300) for the pilot. If the zone has CAA records, allow `letsencrypt.org`. Wait until
`dig +short meet.thenura.care` returns the IP **before** step 3, or the certificate request fails.

## 3. Install

```bash
# on the Jitsi host
git clone --depth 1 https://github.com/utkarshpayal/period-buddy-be.git /tmp/nura-be   # or scp infra/jitsi
cd /tmp/nura-be/infra/jitsi
sudo ./install.sh --domain meet.thenura.care --email <ops-mailbox>@thenura.care --public-ip <STATIC_IP>
```

Re-running is safe: `/opt/jitsi/.env` (secrets) is created once and kept, and our settings are
re-applied. Config lives in `/opt/jitsi/config` (persistent), so restarts and upgrades keep the
certificate and generated config. Containers restart `unless-stopped` and Docker starts at boot.
Logs rotate at 20 MB × 5 per container (`/etc/docker/daemon.json`). The web container's access
log already replaces `?jwt=` query strings with `[params_redacted]`.

Certificate: the web container gets and renews a Let's Encrypt certificate for the domain.
Check it with `curl -sI https://meet.thenura.care | head -1` and in a browser.

## 4. Connect the API

Add to the API's Secrets Manager secret `nura/api/env` (`infra/scripts/push-env-to-secret.sh`),
then re-run the API pipeline:

| Key | Value |
|---|---|
| `JITSI_DOMAIN` | `meet.thenura.care` |
| `JITSI_APP_ID` | `nura-api` (= `JWT_APP_ID` on the host) |
| `JITSI_APP_SECRET` | from `sudo grep '^JWT_APP_SECRET=' /opt/jitsi/.env \| cut -d= -f2-` |
| `JITSI_AUDIENCE` | `jitsi` |
| optional | `JITSI_TOKEN_TTL_SECONDS` (600), `CONSULTATION_JOIN_EARLY_MINUTES` (10), `CONSULTATION_JOIN_GRACE_MINUTES` (30), `CONSULTATION_DEFAULT_DURATION_MINUTES` (60), `VIDEO_JOIN_RATE_LIMIT_MAX` (30 / `VIDEO_JOIN_RATE_LIMIT_WINDOW_MS` 600000) |

Move the secret over a private channel only, never chat or tickets. If it leaks, see "Rotate the secret" below.

## 5. The clinician portal's CSP

The portal loads `https://meet.thenura.care/external_api.js` and frames the meeting. If a
`Content-Security-Policy` is ever added to the portal's hosting, allow `script-src` and
`frame-src https://meet.thenura.care`. The portal also needs camera/microphone, which the iframe
API requests with `allow="camera; microphone; ..."`.

## 6. Verify enforcement (do this before the API gets the `JITSI_*` values)

On a trusted laptop with the API's `JITSI_*` values in a local env file:

```bash
node --env-file=.env.jitsi-check src/scripts/jitsiTokenCheck.js
```

Open each printed link in a private browser window:

| Link | Expected |
|---|---|
| valid-moderator | Joins; is moderator (can mute/remove the other person) |
| valid-participant (second window) | Joins; is **not** moderator (no moderator menu on the other tile) |
| valid-participant alone first, then moderator | Participant is still **not** moderator after joining first (checks auto-owner is off) |
| wrong-room | Refused (authentication / "not allowed" error), never enters the room |
| expired | Refused |
| wrong-secret | Refused |
| no-room-claim | Refused |
| no-token (bare room URL) | Refused: asks for authentication, no anonymous entry |

Then end-to-end through the product: book a test consultation, join as the doctor from the
portal (Chrome) and as the patient from an **Android development build** of the app. Check
audio and video both ways, mute, camera off, audio-only, leave and rejoin, and toggling Wi-Fi
off and on during the call (reconnect). Then a Period Buddy call between two test accounts
(both participants, neither can mute the other).

## 7. Rollout order

Jitsi is the only video path, so the order matters:

1. Jitsi host up and step 6 passing.
2. `JITSI_*` in the API secret and the API deployed. That API no longer relays WebRTC call
   signaling, so **installed app builds from before this change can't make video calls any
   more** (their call screen never connects). Chat and everything else keep working.
3. Ship the app build with Jitsi calls, then raise `minVersion` in the CMS (App settings) to
   it so older builds are asked to update. The clinician portal updates itself on deploy.

## Local testing (laptop, no server)

Same images and settings, on `https://meet.localtest.me:8443` (a public name for 127.0.0.1;
port 8443 so it can't clash with anything on 443):

1. `mkcert -install`, unpack the pinned release into `~/jitsi-local`, `cp env.example .env && ./gen-passwords.sh`.
2. Append `nura.env` with `@DOMAIN@`→`meet.localtest.me`, `@PUBLIC_IP@`→`127.0.0.1`, then
   `CONFIG=$HOME/jitsi-local/config`, `ENABLE_LETSENCRYPT=0`, `HTTP_PORT=8000`, `HTTPS_PORT=8443`,
   `PUBLIC_URL=https://meet.localtest.me:8443` and a generated `JWT_APP_SECRET` (later lines win).
3. `mkcert -cert-file $CONFIG/web/keys/cert.crt -key-file $CONFIG/web/keys/cert.key meet.localtest.me`,
   copy the two `custom-*.js` files into `$CONFIG/web/`.
4. `mkdir -p $CONFIG/storage/{web,prosody,transcripts}` and make the whole `$CONFIG` owned by uid 1000
   (`docker run --rm -v "$CONFIG:/c" alpine chown -R 1000:1000 /c`), else `web`/`prosody` crash-loop with
   "not writable by the container user". Then `docker compose up -d` (the first run downloads the images).
5. API env: `JITSI_DOMAIN=meet.localtest.me:8443` (the port is allowed), `JITSI_APP_ID=nura-api`,
   `JITSI_APP_SECRET=<that JWT_APP_SECRET>`; restart the API.

A phone can't reach this (`meet.localtest.me` is the phone itself): test devices against the real server.

## Operations

- **Status / logs:** `cd /opt/jitsi/current && sudo docker compose ps` / `sudo docker compose logs --tail 200 prosody`
- **Restart:** `cd /opt/jitsi/current && sudo docker compose restart`
- **Upgrade:** read the release notes, re-check the env names in `nura.env`, then
  `sudo ./install.sh ... --release stable-NNNNN`, then repeat step 6.
- **Roll back the Jitsi release:** `cd /opt/jitsi/current && sudo docker compose down`, then
  `sudo ln -sfn /opt/jitsi/docker-jitsi-meet-<previous> /opt/jitsi/current && cd /opt/jitsi/current && sudo docker compose up -d`.
- **Jitsi down / misconfigured:** the API's join answers fail and the apps show "video calls aren't
  available" or "couldn't reach the video service"; chat keeps working. Removing `JITSI_APP_SECRET`
  from the API turns joins into a clean 503 while you fix the host. There is no other video path to
  fall back to: rolling back means reverting the code in all three repos (API, app, portal).
- **Rotate the secret:** `sudo sed -i 's/^JWT_APP_SECRET=.*/JWT_APP_SECRET=<new>/' /opt/jitsi/.env`,
  `cd /opt/jitsi/current && sudo docker compose up -d --force-recreate prosody`, and update
  `JITSI_APP_SECRET` on the API right away. Calls already in progress continue. New joins need the new secret.
- **Tear down:** delete the stack / Lightsail instance (and the static IP, which bills while unattached) and the DNS record.
