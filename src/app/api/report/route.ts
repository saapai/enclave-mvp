import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    
    const body = await request.json()
    const { category, message, userEmail } = body

    if (!category || !message) {
      return NextResponse.json({ error: 'Category and message are required' }, { status: 400 })
    }

    // Get user's email from Clerk if available
    let email = userEmail
    if (userId && !email) {
      try {
        const { clerkClient } = await import('@clerk/nextjs/server')
        const client = await clerkClient()
        const user = await client.users.getUser(userId)
        email = user.emailAddresses[0]?.emailAddress || 'unknown'
      } catch (error) {
        console.error('Failed to get user email:', error)
        email = 'unknown'
      }
    }

    // Send email using a simple email service
    const emailData = {
      to: 'saathvikpai817@gmail.com',
      from: 'noreply@enclave.app', // You'll need to configure this
      subject: `Enclave Report: ${category}`,
      text: `
Category: ${category}
User Email: ${email}
User ID: ${userId || 'anonymous'}

Message:
${message}

---
Sent from Enclave App
      `,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Enclave Report</h2>
          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <p><strong>Category:</strong> ${category}</p>
            <p><strong>User Email:</strong> ${email}</p>
            <p><strong>User ID:</strong> ${userId || 'anonymous'}</p>
          </div>
          <div style="background: white; padding: 15px; border: 1px solid #ddd; border-radius: 5px;">
            <h3>Message:</h3>
            <p style="white-space: pre-wrap;">${message}</p>
          </div>
          <p style="color: #666; font-size: 12px; margin-top: 20px;">
            Sent from Enclave App
          </p>
        </div>
      `
    }

    // For now, we'll use a simple approach - you can integrate with SendGrid, Resend, etc.
    // This is a placeholder that logs the report
    console.log('=== ENCLAVE REPORT ===')
    console.log('Category:', category)
    console.log('User Email:', email)
    console.log('User ID:', userId || 'anonymous')
    console.log('Message:', message)
    console.log('=====================')

    // TODO: Replace this with actual email sending service
    // For now, we'll simulate success
    // You can integrate with services like:
    // - SendGrid: https://sendgrid.com/
    // - Resend: https://resend.com/
    // - Nodemailer: https://nodemailer.com/

    return NextResponse.json({ 
      success: true, 
      message: 'Report submitted successfully' 
    })

  } catch (error) {
    console.error('Report submission error:', error)
    return NextResponse.json(
      { error: 'Failed to submit report' },
      { status: 500 }
    )
  }
}


