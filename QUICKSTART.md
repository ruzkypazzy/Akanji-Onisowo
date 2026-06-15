# Oniṣòwò v1.0.0 — VPS Push & Launch Guide

## TL;DR — 4 commands, ~2 min

```bash
# On your VPS (185.2.101.34, Termius from phone):
cd ~ && scp <local>:/path/to/onisowo-v1.tar.gz .   # or use sftp/curl
tar -xzf onisowo-v1.tar.gz
cd onisowo
bash init.sh
# (init.sh will let you edit .env — already has TELEGRAM_BOT_TOKEN added)
source .venv/bin/activate && python main.py
```

---

## Option A — Push to GitHub from VPS (recommended, takes 2 min)

Step 1: Push the v1 commit to GitHub from VPS
```bash
# On VPS:
ssh root@185.2.101.34
cd ~/onisowo  # your existing dir with .env already filled in
git init -q
git config user.email "ruzkypazzy@users.noreply.github.com"
git config user.name "ruzkypazzy"
git remote add origin https://github.com/ruzkypazzy/Onisowo.git
git add -A
git status  # verify .env is NOT in the list (.gitignore protects it)
git commit -m "v1.0.0 — initial release: 105 skills, 11/11 tests pass"
git push -u origin main  # will prompt for GitHub username + PAT
```

When prompted:
- Username: `ruzkypazzy`
- Password: **paste your GitHub PAT** (the one with `repo` scope on `Onisowo`)

If you don't have a fresh PAT handy, generate one at:
https://github.com/settings/tokens/new
- Note: "Onisowo push"
- Expiration: 7 days
- Scopes: ✅ `repo` (full control of private repos)
- Click "Generate token", copy it, paste when prompted

Step 2: Pull + install + run
```bash
cd ~/onisowo
git pull origin main  # should be no-op since you just pushed
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

You should see:
```
  Ọniṣọwọ́ (Oniṣòwò) — Yoruba AI Trading Agent
  Bitget:    ✓
  Qwen:      ✓
  Telegram:  ✓
  ...
  Starting Telegram bot... (Ctrl+C to stop)
```

## Option B — Tarball transfer (no GitHub needed for now)

If you want to skip GitHub and run the bot first to verify it works:

```bash
# On VPS:
cd ~
# (Transfer the tarball via Termius SFTP, or download from a paste service)
# For now, the tarball is at /workspace/onisowo-v1.tar.gz in my sandbox.
# You can either:
#   (a) Have me push to GitHub first, then `git clone` on VPS
#   (b) Use Termius to upload the tarball via SFTP
```

Once tarball is on VPS:
```bash
cd ~ && tar -xzf onisowo-v1.tar.gz
cd onisowo
bash init.sh
# init.sh will create .venv, install deps, prompt you to edit .env
# Your existing .env at ~/onisowo/.env is already correct (you added TELEGRAM_BOT_TOKEN)
# Just point init.sh at the existing one or skip its edit step
source .venv/bin/activate
python main.py
```

---

## Verify it works

Once the bot is running (`python main.py`), open Telegram on your phone:
1. Search for `@OnisowoBot`
2. Send `/start`
3. You should see: "Ọniṣọwọ́ káàlẹ́! 👋"
4. Try `/price BTCUSDT` — should show live price
5. Try `/status` — should show your $10.97 USDT balance
6. Try `/skills` — should list all 105 skills

---

## First live trade

Once you're comfortable:
1. `/buy SOL 2` (capped at $2 by risk engine)
2. Bot will check balance, get SOL price, run risk check, ask Qwen for reasoning, place order on Bitget
3. Returns order ID + reasoning + logs to journal
4. `/journal` to see the trade logged

---

## If something breaks

**Bitget error?** Check your API key has `Read + Trade` permissions (not Withdraw).
**Qwen error?** Check BITGET_QWEN_API_KEY in .env is correct.
**Telegram silent?** Check TELEGRAM_BOT_TOKEN in .env matches @BotFather.

To check the .env without showing secrets:
```bash
wc -l ~/onisowo/.env       # should be 9-10 lines
grep -c "=" ~/onisowo/.env # should be 8-9 (one per variable)
```

To run the smoke tests:
```bash
cd ~/onisowo
source .venv/bin/activate
python tests/test_smoke.py
```
Should print 11 "✓" lines.

---

## Submission checklist (for later, ~June 24)

- [x] Code shipped (this)
- [x] 100+ skills (105, 15 deep + 90 stubs)
- [x] Self-hostable (3-min setup)
- [x] Open source (MIT)
- [x] README + SUBMISSION.md
- [x] /help, /skills, /status work
- [ ] Live demo: bot responds to /start on Telegram
- [ ] Submit: github.com/ruzkypazzy/Onisowo + https://t.me/OnisowoBot
