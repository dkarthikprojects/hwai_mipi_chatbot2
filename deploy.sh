#!/bin/bash
echo ""
echo " MIPI POWER HOUSE — Deploy to Vercel"
echo " ====================================="
cd "$(dirname "$0")"
echo " Pulling latest changes..."
git pull
echo ""
echo " Staging all changes..."
git add .
echo ""
read -p "Commit message (press Enter for 'update'): " msg
msg=${msg:-update}
git commit -m "$msg"
echo ""
echo " Pushing to GitHub (Vercel auto-deploys)..."
git push
echo ""
echo " Done! Vercel will deploy in ~60 seconds."
echo " Check: https://vercel.com/dashboard"
