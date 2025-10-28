/**
 * Alert Scheduler
 * Checks for pending alerts and sends SMS notifications
 */

import { supabaseAdmin } from '../lib/supabase'
import { ENV } from '../lib/env'
import twilio from 'twilio'

// ============================================================================
// TWILIO CLIENT
// ============================================================================

const twilioClient = twilio(ENV.TWILIO_ACCOUNT_SID, ENV.TWILIO_AUTH_TOKEN)

// ============================================================================
// ALERT PROCESSING
// ============================================================================

/**
 * Get pending alerts that should fire now
 */
async function getPendingAlerts(): Promise<any[]> {
  const { data, error } = await supabaseAdmin
    .rpc('get_pending_alerts')

  if (error) {
    console.error('[Alert Scheduler] Error fetching pending alerts:', error)
    return []
  }

  return data || []
}

/**
 * Send alert via SMS
 */
async function sendAlertSMS(
  recipient: string,
  message: string,
  alertId: string
): Promise<{ success: boolean; twilioSid?: string; error?: string }> {
  try {
    // Ensure recipient has + prefix
    const formattedRecipient = recipient.startsWith('+') ? recipient : `+${recipient}`

    const twilioMessage = await twilioClient.messages.create({
      body: message,
      from: ENV.TWILIO_PHONE_NUMBER,
      to: formattedRecipient
    })

    console.log(`[Alert Scheduler] Sent SMS to ${formattedRecipient}: ${twilioMessage.sid}`)

    // Log delivery
    await supabaseAdmin
      .from('alert_log')
      .insert({
        alert_id: alertId,
        recipient: formattedRecipient,
        status: 'sent',
        twilio_sid: twilioMessage.sid
      })

    return { success: true, twilioSid: twilioMessage.sid }

  } catch (error: any) {
    console.error(`[Alert Scheduler] Error sending SMS to ${recipient}:`, error)

    // Log failure
    await supabaseAdmin
      .from('alert_log')
      .insert({
        alert_id: alertId,
        recipient,
        status: 'failed',
        error_message: error.message
      })

    return { success: false, error: error.message }
  }
}

/**
 * Process a single alert
 */
async function processAlert(alert: any): Promise<void> {
  console.log(`[Alert Scheduler] Processing alert ${alert.alert_id}: ${alert.title}`)

  let successCount = 0
  let failCount = 0

  // Send to all recipients
  for (const recipient of alert.recipients) {
    const result = await sendAlertSMS(recipient, alert.message, alert.alert_id)
    
    if (result.success) {
      successCount++
    } else {
      failCount++
    }

    // Rate limit: wait 1 second between messages
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  // Mark alert as fired
  await supabaseAdmin
    .rpc('mark_alert_fired', { alert_id_param: alert.alert_id })

  console.log(`[Alert Scheduler] Alert ${alert.alert_id} complete: ${successCount} sent, ${failCount} failed`)
}

/**
 * Main scheduler loop
 */
export async function runAlertScheduler(): Promise<void> {
  console.log('[Alert Scheduler] Starting alert scheduler')

  try {
    // Get pending alerts
    const alerts = await getPendingAlerts()

    if (alerts.length === 0) {
      console.log('[Alert Scheduler] No pending alerts')
      return
    }

    console.log(`[Alert Scheduler] Found ${alerts.length} pending alerts`)

    // Process each alert
    for (const alert of alerts) {
      try {
        await processAlert(alert)
      } catch (error) {
        console.error(`[Alert Scheduler] Error processing alert ${alert.alert_id}:`, error)
        
        // Mark as failed
        await supabaseAdmin
          .from('alert')
          .update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('id', alert.alert_id)
      }
    }

    console.log('[Alert Scheduler] Alert scheduler complete')

  } catch (error) {
    console.error('[Alert Scheduler] Fatal error:', error)
  }
}

/**
 * Run scheduler continuously (for long-running process)
 */
export async function runAlertSchedulerContinuous(intervalMinutes: number = 5): Promise<void> {
  console.log(`[Alert Scheduler] Starting continuous scheduler (every ${intervalMinutes} minutes)`)

  while (true) {
    await runAlertScheduler()
    
    // Wait for next interval
    await new Promise(resolve => setTimeout(resolve, intervalMinutes * 60 * 1000))
  }
}

// If run directly, execute the scheduler once
if (require.main === module) {
  runAlertScheduler()
    .then(() => {
      console.log('Alert scheduler complete')
      process.exit(0)
    })
    .catch((error) => {
      console.error('Alert scheduler failed:', error)
      process.exit(1)
    })
}

