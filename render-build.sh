#!/usr/bin/env bash
# Sair se der erro
set -o errexit

npm install
npx prisma migrate deploy
npm run build