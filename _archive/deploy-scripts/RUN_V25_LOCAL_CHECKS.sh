#!/usr/bin/env bash
set -euo pipefail
npm run check
npm run check:attendance-identity
npm run check:live-deploy-readiness
npm run check:prepublish
