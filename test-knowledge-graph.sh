#!/bin/bash
set -a
source .env.local
set +a

# Test the knowledge graph SQL function
curl -X POST https://api.tryenclave.com/api/internal/consolidate \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${INTERNAL_API_KEY}" \
  -d '{"workspaceId":"aac9ccee-65c9-471e-be81-37bd4c9bd86f"}'
