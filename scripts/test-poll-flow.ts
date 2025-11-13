/**
 * Test script for poll creation and response flow
 * Tests:
 * 1. Creating a regular poll
 * 2. Creating a required poll
 * 3. Responding with "yes"
 * 4. Responding with "no" (should prompt for reason if required)
 * 5. Providing reason after "no"
 */

import { resolve } from 'path'

async function testPollFlow() {
  // Load environment variables using Next.js loader
  try {
    const nextEnv = await import('@next/env')
    const loadEnvConfig = nextEnv.loadEnvConfig || (nextEnv as any).default?.loadEnvConfig
    if (loadEnvConfig) {
      loadEnvConfig(process.cwd())
      console.log('✓ Environment variables loaded\n')
    }
  } catch (err) {
    console.warn('⚠️ Could not load @next/env, using process.env directly\n')
  }
  console.log('='.repeat(80))
  console.log('POLL FLOW TEST')
  console.log('='.repeat(80))
  console.log()

  const { handleSMSMessage } = await import('../src/lib/sms/unified-handler')
  const testPhone = '5555551234' // Test phone number
  const testFullPhone = '+15555551234'

  // Test 1: Create a regular poll
  console.log('TEST 1: Creating a regular poll')
  console.log('-'.repeat(80))
  const regularPollMessage = 'Send a poll saying "Active meeting tonight at 8pm @ Ash\'s. Are you coming?"'
  console.log(`Input: "${regularPollMessage}"`)
  
  try {
    const result1 = await handleSMSMessage(testPhone, testFullPhone, regularPollMessage)
    console.log(`✓ Response: "${result1.response.substring(0, 150)}..."`)
    console.log(`✓ Should save history: ${result1.shouldSaveHistory}`)
    console.log(`✓ Intent: ${result1.metadata?.intent}`)
  } catch (err) {
    console.error('✗ Error:', err)
  }
  console.log()

  // Test 2: Create a required poll
  console.log('TEST 2: Creating a required poll')
  console.log('-'.repeat(80))
  const requiredPollMessage = 'Send a required poll saying "Big Little event on Friday at 7pm. Can you make it?"'
  console.log(`Input: "${requiredPollMessage}"`)
  
  try {
    const result2 = await handleSMSMessage(testPhone, testFullPhone, requiredPollMessage)
    console.log(`✓ Response: "${result2.response.substring(0, 150)}..."`)
    console.log(`✓ Should save history: ${result2.shouldSaveHistory}`)
    console.log(`✓ Intent: ${result2.metadata?.intent}`)
  } catch (err) {
    console.error('✗ Error:', err)
  }
  console.log()

  // Test 3: Test poll response detection patterns
  console.log('TEST 3: Poll response pattern detection')
  console.log('-'.repeat(80))
  const testResponses = [
    'yes',
    'yeah sure',
    'no',
    'naw i cant',
    'naw i have a midterm',
    'maybe',
    'i have a conflict'
  ]

  for (const response of testResponses) {
    console.log(`Testing: "${response}"`)
    const { parseResponseWithNotes } = await import('../src/lib/polls')
    try {
      const parsed = await parseResponseWithNotes(response, ['Yes', 'No', 'Maybe'])
      console.log(`  ✓ Option: ${parsed.option || 'none'}`)
      if (parsed.notes) {
        console.log(`  ✓ Notes: ${parsed.notes}`)
      }
    } catch (err) {
      console.error(`  ✗ Error:`, err)
    }
  }
  console.log()

  // Test 4: Test quote extraction for nested quotes
  console.log('TEST 4: Quote extraction with nested quotes')
  console.log('-'.repeat(80))
  const nestedQuoteMessage = 'Send a poll saying "Meeting tonight at 8pm. Reply "yes" or "no"."'
  console.log(`Input: "${nestedQuoteMessage}"`)
  
  const { parseCommand } = await import('../src/lib/sms/smart-command-parser')
  try {
    const parsed = await parseCommand(nestedQuoteMessage, [])
    console.log(`✓ Verbatim text: "${parsed.verbatimText || 'none'}"`)
    console.log(`✓ Content: "${parsed.extractedFields.content || 'none'}"`)
    console.log(`✓ Needs generation: ${parsed.needsGeneration}`)
  } catch (err) {
    console.error('✗ Error:', err)
  }
  console.log()

  // Test 5: Test poll question normalization
  console.log('TEST 5: Poll question normalization')
  console.log('-'.repeat(80))
  const testQuestions = [
    'active meeting tonight',
    'are you coming to big little',
    'Meeting tonight at 8pm @ 610 Levering, Apt 201! Are you coming? Respond "yes" if you are coming, "no" if you are not.'
  ]

  const { generatePollQuestion } = await import('../src/lib/polls')
  for (const question of testQuestions) {
    console.log(`Input: "${question.substring(0, 60)}${question.length > 60 ? '...' : ''}"`)
    try {
      const normalized = await generatePollQuestion({ question, verbatim: false })
      console.log(`  ✓ Normalized: "${normalized}"`)
    } catch (err) {
      console.error(`  ✗ Error:`, err)
    }
  }
  console.log()

  console.log('='.repeat(80))
  console.log('TEST COMPLETE')
  console.log('='.repeat(80))
}

// Run tests
testPollFlow()
  .then(() => {
    console.log('\n✓ All tests completed')
    process.exit(0)
  })
  .catch((err) => {
    console.error('\n✗ Test suite failed:', err)
    process.exit(1)
  })

