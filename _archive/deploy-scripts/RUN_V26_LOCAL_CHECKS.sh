#!/usr/bin/env bash
set -euo pipefail
node tools/check-js.mjs
node tools/check-html-scripts.mjs
node tools/check-web-guards.mjs
node tools/check-attendance-identity.mjs
node tools/check-live-deploy-readiness.mjs
node tools/check-prepublish-consistency.mjs
node tools/check-all-fast.mjs
HR_FULL_DEV_PACKAGE_OK=1 node tools/smoke-check.mjs
