#!/bin/bash

# Load environment variables from .env.local
set -a
source .env.local
set +a

# Run the consolidator
npx tsx src/workers/event-consolidator.ts

