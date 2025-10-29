/**
 * Announcement Sender Worker
 * Polls for scheduled announcements and sends them
 */

import { supabase } from '../lib/supabase';
import { sendAnnouncement } from '../lib/announcements';
import twilio from 'twilio';

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function processScheduledAnnouncements() {
  console.log('[Announcement Sender] Checking for scheduled announcements...');

  try {
    const { data: announcements, error } = await supabase
      .rpc('get_pending_announcements');

    if (error) {
      console.error('[Announcement Sender] Error fetching announcements:', error);
      return;
    }

    if (!announcements || announcements.length === 0) {
      console.log('[Announcement Sender] No pending announcements');
      return;
    }

    console.log(`[Announcement Sender] Found ${announcements.length} announcements to send`);

    for (const announcement of announcements) {
      console.log(`[Announcement Sender] Sending announcement ${announcement.announcement_id}`);
      
      const sentCount = await sendAnnouncement(
        announcement.announcement_id,
        twilioClient
      );

      console.log(`[Announcement Sender] Sent to ${sentCount} recipients`);
    }
  } catch (err) {
    console.error('[Announcement Sender] Error:', err);
  }
}

// Run immediately if called directly
if (require.main === module) {
  console.log('[Announcement Sender] Starting...');
  
  // Run once
  processScheduledAnnouncements().then(() => {
    console.log('[Announcement Sender] Complete');
    process.exit(0);
  }).catch(err => {
    console.error('[Announcement Sender] Fatal error:', err);
    process.exit(1);
  });
}

// Export for cron jobs
export { processScheduledAnnouncements };

