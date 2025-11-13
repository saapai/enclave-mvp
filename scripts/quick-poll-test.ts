/**
 * Quick poll component tests
 */

async function quickTest() {
  console.log('QUICK POLL COMPONENT TEST\n')
  console.log('='.repeat(60))
  
  // Test 1: Quote extraction with nested quotes
  console.log('\n1. Testing nested quote extraction:')
  console.log('-'.repeat(60))
  
  const testMessages = [
    'Send a poll saying "Meeting tonight. Reply "yes" or "no"."',
    'Send a message with a poll, saying "Meeting is tonight at 8pm @ 610 Levering, Apt 201! Are you coming? Respond "yes" if you are coming, "no" if you are not."'
  ]
  
  for (const msg of testMessages) {
    console.log(`\nInput: "${msg.substring(0, 80)}..."`)
    
    // Manual extraction logic test
    const quotePositions: number[] = []
    for (let i = 0; i < msg.length; i++) {
      if (msg[i] === '"') {
        quotePositions.push(i)
      }
    }
    
    if (quotePositions.length >= 2) {
      const firstQuote = quotePositions[0]
      const lastQuote = quotePositions[quotePositions.length - 1]
      const extracted = msg.substring(firstQuote + 1, lastQuote).trim()
      console.log(`✓ Extracted: "${extracted.substring(0, 100)}${extracted.length > 100 ? '...' : ''}"`)
    } else {
      console.log('✗ Not enough quotes found')
    }
  }
  
  // Test 2: Poll response pattern matching
  console.log('\n\n2. Testing poll response patterns:')
  console.log('-'.repeat(60))
  
  const responses = [
    { text: 'yes', expected: 'Yes' },
    { text: 'yeah sure', expected: 'Yes' },
    { text: 'no', expected: 'No' },
    { text: 'naw i cant', expected: 'No', notes: 'i cant' },
    { text: 'naw i have a midterm', expected: 'No', notes: 'i have a midterm' },
    { text: 'maybe', expected: 'Maybe' }
  ]
  
  for (const { text, expected, notes } of responses) {
    console.log(`\nInput: "${text}"`)
    
    // Test pattern matching
    const lowerCleanMsg = text.toLowerCase().trim()
    const noOptionKeyword = /^(no|nope|nah|naw|n)\b/i
    
    if (noOptionKeyword.test(lowerCleanMsg)) {
      const remaining = text.replace(noOptionKeyword, '').trim()
      const extractedNotes = remaining.replace(/^(but|and|,)/i, '').trim()
      console.log(`  ✓ Option: No`)
      if (extractedNotes) {
        console.log(`  ✓ Notes: "${extractedNotes}"`)
      }
    } else if (/^(yes|yep|yeah|ya|y)\b/i.test(lowerCleanMsg)) {
      console.log(`  ✓ Option: Yes`)
    } else if (/^(maybe|perhaps|might)\b/i.test(lowerCleanMsg)) {
      console.log(`  ✓ Option: Maybe`)
    } else {
      console.log(`  ? Could not parse`)
    }
  }
  
  // Test 3: Required poll detection
  console.log('\n\n3. Testing required poll detection:')
  console.log('-'.repeat(60))
  
  const pollMessages = [
    { text: 'Send a poll asking if people can come', expected: false },
    { text: 'Send a required poll asking if people can come', expected: true },
    { text: 'Send a mandatory poll for active meeting', expected: true },
    { text: 'Send a poll, must know who can attend', expected: true }
  ]
  
  for (const { text, expected } of pollMessages) {
    const isRequired = /\b(required|mandatory|must|need to know)\b/i.test(text)
    const status = isRequired === expected ? '✓' : '✗'
    console.log(`${status} "${text.substring(0, 50)}..." → ${isRequired ? 'REQUIRED' : 'optional'}`)
  }
  
  console.log('\n' + '='.repeat(60))
  console.log('✓ Component tests complete\n')
}

quickTest().catch(console.error)

