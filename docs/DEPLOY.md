# Deployment — VPS Setup

This guide covers deploying Àkànjí Oníṣòwò to a Contabo VPS (or any Linux box with Docker).

## Prerequisites

- Linux server (Ubuntu 22.04+ recommended)
- Docker + Docker Compose installed
- Node.js 20+ (only for local testing)
- onchainos CLI (installed by the script)
- Outbound HTTPS to `web3.okx.com` and `api.resend.com`

## One-time setup

### 1. Clone the repository

```bash
sudo mkdir -p /opt/okx-trading-asp
sudo chown $USER:$USER /opt/okx-trading-asp
cd /opt/okx-trading-asp
git clone https://github.com/ruzkypazzy/Akanji-Onisowo.git .
```

### 2. Run the install script

```bash
bash install.sh
```

This will:
- Install onchainos CLI if not present
- Install npm dependencies
- Build TypeScript
- Create `data/` and `logs/` directories
- Create a `.env` file from `.env.example`

### 3. Configure `.env`

Edit `/opt/okx-trading-asp/.env`:

```bash
# Wallet (REQUIRED)
OKX_WALLET_ADDRESS=0xce34cff4e4d54cfb8b1b5496ba9ff7a28c4ace2a
OKX_ACCOUNT_EMAIL=adazycommunicator@gmail.com

# Email (REQUIRED for live mode)
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM=akanji@resend.dev
EMAIL_TO=pazzycamero@gmail.com

# Trading mode (start in paper!)
TRADING_MODE=paper
```

### 4. Login to the onchainos Agentic Wallet

```bash
source ~/.bashrc
onchainos wallet login
# This prints a URL. Open it in your browser, sign in with adazycommunicator@gmail.com.
# After you approve, the CLI detects it and finishes.
```

Verify the wallet is active:
```bash
onchainos wallet status
# Should show: email: adazycommunicator@gmail.com, loggedIn: true
```

### 5. Start in paper mode (test run)

```bash
cd /opt/okx-trading-asp
bash run.sh start
```

This starts the Docker container in the background. Check it's working:

```bash
bash run.sh logs
```

You should see tick messages every 30 seconds.

### 6. Test for 24-48 hours in paper mode

Watch the logs. Verify:
- Heartbeat fires every 30s
- No errors in the journal
- Daily P&L email arrives at 00:00 UTC+8

If something is wrong, stop the agent and debug:
```bash
bash run.sh stop
```

### 7. Switch to live mode

When you're confident:

1. Edit `.env`: set `TRADING_MODE=live`
2. Restart: `bash run.sh stop && bash run.sh start`
3. The agent is now trading real money with the 300 USDT in the wallet.

## Daily operations

### Check status
```bash
bash run.sh status
```

### View logs
```bash
bash run.sh logs
```

### Pause trading (keep monitoring)
```bash
bash run.sh pause
# To resume:
bash run.sh resume
```

### Emergency stop (closes all positions, shuts down)
```bash
bash run.sh stop-all
```

## Monitoring

### Heartbeat watchdog

Add to crontab:
```bash
*/5 * * * * /opt/okx-trading-asp/ops/healthcheck.sh
```

This runs every 5 minutes and emails you if the agent has been silent for >90 seconds.

### systemd service (optional, for auto-start on reboot)

```bash
sudo cp /opt/okx-trading-asp/ops/akanji.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable akanji.service
sudo systemctl start akanji.service
```

## Upgrading

```bash
cd /opt/okx-trading-asp
git pull
npm install
npx tsc
bash run.sh stop && bash run.sh start
```

## Troubleshooting

### Agent won't start
- Check Docker is running: `docker ps`
- Check `.env` is valid: `cat .env`
- Check onchainos is logged in: `onchainos wallet status`
- Check logs: `bash run.sh logs`

### No signals firing
- The signal sources depend on onchainos CLI queries. Check `onchainos market token --chain xlayer --address <token>` works
- The X Layer DEX is thin — not all signals fire every day. This is normal.

### Heartbeat stale
- Restart the agent: `bash run.sh stop && bash run.sh start`
- Check system resources: `df -h /`, `free -h`

### Funds not arriving
- Check the wallet address: `onchainos wallet addresses`
- Check the balance: `onchainos wallet balance --chain xlayer`
- Confirm the sender used the correct chain (X Layer, chain ID 196)
