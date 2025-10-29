# Metadata API Plan Limitation Analysis

## Critical Finding

You are the workspace owner, PAT has correct scopes, base is accessible, but Metadata API still returns 403.

**Workspace Status:** Team Trial

## Hypothesis: Plan-Based Restriction

### Evidence Supporting This Theory

1. ✅ **Owner Status**: You're confirmed workspace owner
2. ✅ **Correct PAT Scopes**: All 4 required scopes enabled
3. ✅ **Base Accessible**: Base appears in listing endpoint
4. ❌ **Metadata API Fails**: Returns 403 on `/v0/meta/bases/{baseId}`
5. ⚠️ **Workspace Plan**: "Team Trial" (may have limitations)

### Why This Matters

Airtable may restrict Metadata API access to:
- **Paid plans only**: Pro, Business, Enterprise
- **NOT available on**: Free plan, Team Trial

The Metadata API (`/v0/meta/bases/{baseId}`) modifies base schema, which may be:
- A premium feature
- Not included in trial plans
- Requires active paid subscription

## Verification Steps

### Step 1: Check Airtable Documentation

1. Visit: https://airtable.com/developers/web/api
2. Look for Metadata API documentation
3. Check if there's a "Plan Requirements" section
4. Note if it mentions Pro/Business plan requirement

### Step 2: Contact Airtable Support

**Ask specifically:**
- "Does Metadata API (`/v0/meta/bases`) require a paid plan?"
- "Is Metadata API available on Team Trial workspaces?"
- "What plan is required for programmatic field creation?"

**Provide:**
- Workspace name: "My First Workspace"
- Base ID: `appecxe8XTHF7yA5a`
- Error: `INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND` (HTTP 403)
- Your role: Workspace Owner

### Step 3: Test with Paid Plan (If Possible)

If you have access to another workspace with a paid plan:
1. Create a test base in that workspace
2. Create a PAT with same scopes
3. Try Metadata API on that workspace
4. If it works → confirms plan limitation

## Solutions

### Option 1: Upgrade to Paid Plan (Recommended if Metadata API is needed)

1. Go to Workspace → Settings → Billing
2. Upgrade from "Team Trial" to:
   - **Pro Plan**: Check if includes Metadata API
   - **Business Plan**: Higher tier, more likely to include Metadata API
3. Test Metadata API after upgrade

**Cost Consideration**: 
- Determine if automatic field creation is worth paid subscription
- Alternatively, create fields manually (free)

### Option 2: Manual Field Creation (Current Workaround)

Since Metadata API isn't working:

1. When polls are sent, system logs field names needed:
   ```
   yo_is_ash_gay_Question_2025_10_29
   yo_is_ash_gay_Response_2025_10_29
   yo_is_ash_gay_Notes_2025_10_29
   ```

2. Create these fields manually in Airtable:
   - Question field: Single line text
   - Response field: Single select (Yes, No, Maybe)
   - Notes field: Long text

3. Poll responses will save once fields exist

### Option 3: Alternative Approach (If Metadata API Never Works)

Consider:
- Pre-creating a fixed set of poll fields
- Reusing fields across polls (instead of per-poll fields)
- Using a different structure (single poll response table)

## Error Message Analysis

Your curl test returned:
```json
{
  "error": {
    "type": "INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND",
    "message": "Invalid permissions, or the requested model was not found..."
  }
}
```

The phrase "model" in Airtable API often refers to:
- Base schema structure
- Metadata/configuration
- Not just data records

This suggests it's a schema/metadata access issue, which aligns with plan-based restrictions.

## Next Steps

1. **Immediate**: Continue using manual field creation workaround
2. **Short-term**: Contact Airtable Support to confirm plan requirement
3. **Long-term**: Decide whether to upgrade plan or continue manual creation

## Expected Response from Airtable Support

They should clarify:
- ✅ Metadata API is/isn't available on Team Trial
- ✅ What plan is required for Metadata API
- ✅ If there's a way to enable it on your current plan
- ✅ Alternative solutions if plan can't be upgraded

## If Plan Limitation Confirmed

The system will:
1. ✅ Continue working (polls send successfully)
2. ✅ Log field names that need manual creation
3. ⚠️ Require manual field creation before poll responses
4. ✅ Save responses once fields exist

This is inconvenient but functional - fields just need to be created manually ahead of time.

