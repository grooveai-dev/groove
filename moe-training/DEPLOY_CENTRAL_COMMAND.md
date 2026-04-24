# Central Command — AWS Deployment Guide

Build guide for deploying the MoE Training Data ingest server on the groovedev.ai AWS instance.

Last updated: 2026-04-23

---

## 1. What This Server Does

Central Command receives Trajectory Envelopes from Groove desktop clients that have opted into training data sharing. It verifies cryptographic attestation (ECDH + HMAC), stores verified envelopes, stitches multi-chunk sessions, scores trajectories using a multiplier matrix, and credits contributors with points.

All source code is in: `moe-training/server/`
Shared utilities: `moe-training/shared/`

---

## 2. System Requirements

- Node.js 20+ LTS (ES modules, native fetch)
- build-essential + python3 (for compiling better-sqlite3 native bindings)
- nginx (reverse proxy, SSL termination)
- certbot (Let's Encrypt SSL for api.groovedev.ai)
- PM2 (process manager) or systemd
- 1GB+ RAM, 20GB+ disk (envelopes grow over time)

---

## 3. Environment Variables

| Variable | Default | Description |
|---|---|---|
| GROOVE_CENTRAL_PORT | 8443 | Port the Express server listens on (behind nginx) |
| NODE_ENV | production | Set to production for security defaults |

The server does NOT need any API keys. It only receives data — it does not call any external APIs. The enrichment pipeline (LLM-as-a-Judge) is currently a stub and will need API keys when activated post-launch.

---

## 4. Directory Structure on Server

```
/opt/groove-central/
  moe-training/
    package.json
    package-lock.json
    server/            <-- the server code
    shared/            <-- shared crypto/schema/constants
    client/            <-- NOT needed on server, but harmless to include
    data/              <-- created automatically on first run
      sessions.db      <-- SQLite: ECDH session state, rate limiting
      ledger.db        <-- SQLite: contributor points and balances
      envelopes/       <-- JSONL envelope storage (daily rotation)
        2026-04-26.jsonl
        2026-04-27.jsonl
```

The data/ directory is created automatically by the server components on first request. SQLite databases use WAL mode for crash safety. File permissions: directories 0o700, files 0o600.

---

## 5. Dependencies

```json
{
  "better-sqlite3": "^11.0.0",
  "uuid": "^9.0.0",
  "express": "^4.18.0"
}
```

better-sqlite3 is a native C++ addon — it needs compilation tools:

```bash
sudo apt update
sudo apt install -y build-essential python3 git
```

---

## 6. Deployment Steps

### 6a. Clone and Install

```bash
# Clone the repo (or scp the moe-training directory)
cd /opt/groove-central
git clone https://github.com/grooveai-dev/groove.git
cd groove/moe-training

# Install dependencies
npm install --production
```

### 6b. Test the Server Locally

```bash
# Start the server
GROOVE_CENTRAL_PORT=8443 node server/index.js

# In another terminal, verify health
curl http://localhost:8443/health
# Expected: {"status":"ok","uptime":...}

# Verify session endpoint
curl -X POST http://localhost:8443/v1/sessions/open \
  -H "Content-Type: application/json" \
  -d '{"session_id":"test-1","public_key":"dGVzdA==","provider":"claude-code","model":"claude-opus-4-6","machine_fingerprint":"test","app_version_hash":"abc","groove_version":"0.27.77"}'
# Expected: {"server_public_key":"..."}

# Verify stats endpoint
curl http://localhost:8443/v1/stats/summary
# Expected: {"totalEnvelopes":0,...}

# Kill the test server (Ctrl+C)
```

### 6c. PM2 Process Manager

```bash
# Install PM2 globally
sudo npm install -g pm2

# Create ecosystem config
cat > /opt/groove-central/groove/moe-training/ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [{
    name: 'groove-central',
    script: 'server/index.js',
    cwd: '/opt/groove-central/groove/moe-training',
    env: {
      NODE_ENV: 'production',
      GROOVE_CENTRAL_PORT: 8443,
    },
    instances: 1,
    max_memory_restart: '500M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: '/var/log/groove-central/error.log',
    out_file: '/var/log/groove-central/access.log',
    merge_logs: true,
  }],
};
EOF

# Create log directory
sudo mkdir -p /var/log/groove-central
sudo chown $USER:$USER /var/log/groove-central

# Start with PM2
pm2 start ecosystem.config.cjs

# Save PM2 config for auto-restart on reboot
pm2 save
pm2 startup
# (follow the instructions PM2 prints to enable startup hook)
```

### 6d. Nginx Reverse Proxy + SSL

```nginx
# /etc/nginx/sites-available/groove-central

server {
    listen 80;
    server_name api.groovedev.ai;

    # Certbot will add the redirect after SSL is set up
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name api.groovedev.ai;

    # SSL certs (managed by certbot)
    ssl_certificate /etc/letsencrypt/live/api.groovedev.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.groovedev.ai/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Proxy to Node.js server
    location /v1/ {
        proxy_pass http://127.0.0.1:8443;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Large envelopes (up to 5MB)
        client_max_body_size 5m;

        # Timeouts for stitching/scoring on SESSION_CLOSE
        proxy_read_timeout 30s;
        proxy_send_timeout 30s;
    }

    location /health {
        proxy_pass http://127.0.0.1:8443;
        proxy_http_version 1.1;
    }

    # Block everything else
    location / {
        return 404;
    }
}
```

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/groove-central /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Get SSL certificate
sudo certbot --nginx -d api.groovedev.ai
```

### 6e. DNS

Point api.groovedev.ai to the AWS instance's public IP:
- Type: A record
- Name: api
- Value: <AWS instance public IP>
- TTL: 300

If api.groovedev.ai already points to this instance for other services, add the /v1/ location block to the existing nginx config instead of creating a new server block.

---

## 7. API Endpoints

All endpoints are under /v1/ (proxied through nginx).

### Session Management

POST /v1/sessions/open
  Body: { session_id, public_key (base64), provider, model, machine_fingerprint, app_version_hash, groove_version }
  Returns: { server_public_key (base64) }
  Errors: 400 (missing fields), 429 (rate limited: 20 sessions/hour per fingerprint)

POST /v1/sessions/close
  Body: { session_id }
  Returns: { closed: true }
  Errors: 404 (unknown session)

### Data Ingestion

POST /v1/training/ingest
  Body: Full Trajectory Envelope JSON (up to 5MB)
  Returns: { accepted: true, envelope_id }
  Errors: { accepted: false, reason: "..." }
  Special: SESSION_CLOSE envelopes trigger stitching, scoring, and ledger credit

### Statistics

GET /v1/stats/summary
  Returns: { totalEnvelopes, totalSteps, totalSessions, activeSessions, uniqueContributors, storageSizeMb, totalPointsAwarded }

GET /v1/stats/daily?days=7
  Returns: [{ date, envelopes, steps, sessions, points }, ...]

GET /v1/stats/models
  Returns: { "claude-opus-4-6": { sessions, steps, points, percentage }, ... }

GET /v1/stats/providers
  Returns: { "claude-code": { sessions, steps, points }, ... }

GET /v1/stats/leaderboard?limit=10
  Returns: [{ contributor_id (truncated), total_points, total_sessions }, ...]

### Health

GET /health
  Returns: { status: "ok", uptime: seconds }

---

## 8. ECDH Handshake Flow

This is how client (Groove daemon) and server authenticate:

1. Client generates ephemeral ECDH keypair (prime256v1 curve)
2. Client POSTs public key to /v1/sessions/open
3. Server generates its own ECDH keypair, derives shared secret, stores session
4. Server returns its public key
5. Client derives the same shared secret (ECDH math)
6. Every envelope is HMAC-SHA256 signed: HMAC(shared_secret, JSON(envelope) + sequence_number)
7. Server verifies HMAC and sequence number on each ingest
8. Sequence numbers are monotonically increasing — prevents replay attacks

The shared secret NEVER crosses the wire. Both sides derive it independently from the key exchange. An attacker would need the server's ephemeral private key to forge envelopes.

---

## 9. Data Storage

### SQLite Databases

sessions.db — Active and closed session records
  Columns: session_id, server_private_key, server_public_key, shared_secret, client_public_key, provider, model, machine_fingerprint, app_version_hash, groove_version, expected_sequence, status, created_at, closed_at
  WAL mode enabled for concurrent reads

ledger.db — Contributor points
  Table credits: id, contributor_id, session_id, points, base_points, multiplier_breakdown (JSON), created_at
  Table balances: contributor_id (PK), total_points, total_sessions, last_credit_at, trust_score
  WAL mode enabled

### JSONL Envelope Storage

Location: ./data/envelopes/YYYY-MM-DD.jsonl
One JSON object per line, daily rotation.
Each line is a complete verified envelope (chunk or SESSION_CLOSE).

Storage will grow linearly with usage. Estimate: ~1KB per envelope chunk, 5-10 chunks per session.
At 100 sessions/day = ~1MB/day. At 10,000 sessions/day = ~100MB/day.

---

## 10. Scoring / Multiplier Matrix

When a SESSION_CLOSE envelope arrives, the server stitches all chunks and scores:

Base points: 1 per trajectory step

Model multiplier (applied to all steps):
  claude-opus-4-6, claude-opus-4-7: 5x
  claude-sonnet-4-6: 3x
  gpt-4.5, o3: 5x
  o4-mini: 2x
  gemini-2.5-pro: 3x
  gemini-2.5-flash: 1.5x

Quality multipliers (applied to relevant steps):
  User corrections present: 10x on correction steps
  Coordination events: 5x on coordination steps
  Error recovery arcs: 3x on error+resolution steps
  Heavy task complexity: 2x base
  Session quality >= 80: 1.5x total

---

## 11. Monitoring

Check server health:
  curl https://api.groovedev.ai/health

Check corpus stats:
  curl https://api.groovedev.ai/v1/stats/summary

Check daily growth:
  curl https://api.groovedev.ai/v1/stats/daily?days=7

Check active sessions:
  curl https://api.groovedev.ai/v1/stats/summary | jq .activeSessions

PM2 monitoring:
  pm2 status
  pm2 logs groove-central
  pm2 monit

---

## 12. Backup Strategy

Critical data to back up:
  ./data/sessions.db — session keys (active sessions need this)
  ./data/ledger.db — contributor points (this is money)
  ./data/envelopes/ — raw training data (the product)

Recommended: daily cron to rsync data/ to S3 or another volume.

```bash
# Example cron (add to crontab -e)
0 3 * * * aws s3 sync /opt/groove-central/groove/moe-training/data/ s3://groove-training-backup/$(date +\%Y-\%m-\%d)/ --quiet
```

---

## 13. Security Notes

- The server accepts connections from any origin (CORS: *) because Groove clients connect from user machines worldwide
- Rate limiting: max 20 sessions per machine fingerprint per hour (prevents session spam)
- HMAC verification on every envelope prevents forged data
- Sequence numbers prevent replay attacks
- SQLite databases contain ECDH private keys — protect with filesystem permissions (0o600)
- nginx should only expose /v1/ and /health paths — everything else returns 404
- No authentication on stats endpoints (they show aggregate data only, no PII)

---

## 14. Future Additions (Not in This Build)

- Enrichment pipeline: LLM-as-a-Judge for model fingerprinting and cognitive target classification (server/enrichment.js is a stub)
- S3 migration: move envelope storage from local JSONL to S3 for durability
- PostgreSQL migration: move from SQLite to PostgreSQL if concurrent write pressure increases
- Merkle tree: daily hash of ledger for on-chain publication (Base L2)
- Admin dashboard: web UI for monitoring corpus health, contributor activity, data quality

---

## 15. Quick Reference

Start: pm2 start ecosystem.config.cjs
Stop: pm2 stop groove-central
Restart: pm2 restart groove-central
Logs: pm2 logs groove-central
Status: pm2 status
Health: curl https://api.groovedev.ai/health
Stats: curl https://api.groovedev.ai/v1/stats/summary
