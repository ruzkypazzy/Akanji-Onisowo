# Isolation — Zero Impact on VEY1, VERSE2, Pazzera

This document explains how Àkànjí Oníṣòwò (the trading ASP) is completely isolated from your other projects on the same VPS.

## File system isolation

| Project | Location |
|---|---|
| **VEY1** | `/opt/vey1/` |
| **VERSE2** | `/opt/verse2/` |
| **Pazzera** | `/opt/pazzera/` |
| **Àkànjí Oníṣòwò** | `/opt/okx-trading-asp/` (NEW) |

Àkànjí only writes to `/opt/okx-trading-asp/`. Never touches anything else.

## Docker isolation

| Project | Container name | Image |
|---|---|---|
| **VEY1** | `vey1-app` | vey1 custom |
| **VERSE2** | `verse2-app` | verse2 custom |
| **Pazzera** | `pazzera-web`, `pazzera-worker`, `pazzera-postgres`, `pazzera-redis` | pazzera custom |
| **Àkànjí** | `okx-trading-asp` (NEW) | akanji custom |

Àkànjí's container:
- Has its own filesystem (no shared volumes with other projects)
- Doesn't `docker exec` into other containers
- Doesn't `docker stop`/`rm` anything except itself
- Uses a unique container name to prevent collisions

## Port isolation

Àkànjí has **no exposed ports**. It only makes outbound HTTPS calls to OKX and Resend. No risk of port collision with VEY1 (port 3001), VERSE2 (port 8081), or Pazzera.

## Network isolation

Each Docker container has its own network namespace by default. Àkànjí's network traffic doesn't affect other projects.

## Database isolation

Àkànjí uses SQLite at `/opt/okx-trading-asp/data/journal.db`. VEY1/VERSE2/Pazzera use their own databases (different files, different services). Zero overlap.

## Wallet isolation

| Project | Wallet |
|---|---|
| **VEY1/VERSE2/Pazzera** | `0x72233b78747765244855dd27180bbed9c0245f96` (pazzycamero main) |
| **Àkànjí Oníṣòwò** | `0xce34cff4e4d54cfb8b1b5496ba9ff7a28c4ace2a` (adazycommunicator, separate email) |

Completely separate wallets, separate OKX accounts, separate funding sources. If Àkànjí blows up its 300 USDT, the other projects' funds are untouched.

## Cron / systemd isolation

If you set up the healthcheck cron or systemd service, they're scoped to Àkànjí only. The cron line is prefixed with a comment:
```
# Àkànjí Oníṣòwò healthcheck
*/5 * * * * /opt/okx-trading-asp/ops/healthcheck.sh
```

The systemd service file is `akanji.service`, not generic.

## Rollback plan

If anything ever goes wrong with Àkànjí:

```bash
cd /opt/okx-trading-asp
docker compose down
cd /opt/
sudo rm -rf okx-trading-asp/
sudo rm /etc/systemd/system/akanji.service
# Optional: remove cron line
crontab -e  # delete the akanji line
```

This leaves VEY1, VERSE2, Pazzera completely untouched. They never knew Àkànjí existed.

## What I (the agent) will NOT do

When working on Àkànjí, I commit to:

- ❌ Never modify files outside `/opt/okx-trading-asp/`
- ❌ Never `docker stop`/`rm` containers I didn't create
- ❌ Never modify existing `.env`, `docker-compose.yml`, or service definitions for VEY1/VERSE2/Pazzera
- ❌ Never `apt install` system-level packages
- ❌ Never modify nginx, systemd, or firewall configs globally
- ❌ Never move funds from any wallet except Àkànjí's
- ❌ Never `docker system prune` (could affect other projects)

If I need something that *might* affect other projects, I stop and ask first.
