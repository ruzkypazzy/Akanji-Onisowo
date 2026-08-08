#!/bin/bash
# Àkànjí Oníṣòwò — VPS install script
# Run this once on the VPS to set up the trading agent.
#
# Usage: bash install.sh

set -e

echo "🌅 Káàrọ̀ — Installing Àkànjí Oníṣòwò..."

# 1. Create the install directory
INSTALL_DIR="/opt/okx-trading-asp"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# 2. Clone the repo
if [ ! -d ".git" ]; then
  echo "📦 Cloning repository..."
  git clone https://github.com/ruzkypazzy/Akanji-Onisowo.git .
else
  echo "📦 Repository already cloned, pulling latest..."
  git pull
fi

# 3. Install onchainos CLI (required for trading)
if ! command -v onchainos &> /dev/null; then
  echo "🔧 Installing onchainos CLI..."
  curl -fsSL https://raw.githubusercontent.com/okx/onchainos-skills/main/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi
echo "✅ onchainos $(onchainos --version)"

# 4. Install Node deps
echo "📚 Installing npm dependencies..."
npm install --production=false

# 5. Create data + logs directories
mkdir -p data logs

# 6. Build TypeScript
echo "🔨 Building TypeScript..."
npx tsc

# 7. Create .env if it doesn't exist
if [ ! -f ".env" ]; then
  echo "⚙️  Creating .env from .env.example..."
  cp .env.example .env
  echo ""
  echo "⚠️  IMPORTANT: Edit .env to fill in your actual values!"
  echo "   Required: OKX_WALLET_ADDRESS, RESEND_API_KEY"
  echo ""
fi

# 8. Start the agent in paper mode (change TRADING_MODE=live in .env when ready)
echo ""
echo "✅ Install complete!"
echo ""
echo "Next steps:"
echo "  1. Edit .env with your actual config (wallet, email, etc.)"
echo "  2. Test in paper mode:  docker compose up -d"
echo "  3. Check logs:          docker compose logs -f"
echo "  4. When ready for live: edit .env, set TRADING_MODE=live, restart"
echo ""
echo "Káàlẹ́, o. Àkànjí is ready to trade."
