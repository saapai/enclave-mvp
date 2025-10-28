export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>
        
        <div className="space-y-6 text-gray-300 leading-relaxed">
          <p className="text-sm text-gray-400">
            <strong>Effective Date:</strong> October 2025<br />
            <strong>Last Updated:</strong> October 2025
          </p>

          <p>
            Enclave ("we," "our," "us") respects your privacy and is committed to protecting your personal information. This Privacy Policy describes how we collect, use, and protect your information when you interact with our website, app, and SMS messaging services.
          </p>

          <hr className="border-gray-700" />

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">1. Information We Collect</h2>
            <ul className="list-disc list-inside ml-4 space-y-1">
              <li><strong>Contact Information:</strong> Name, email, and phone number provided when you register or opt in.</li>
              <li><strong>Consent Records:</strong> Timestamp, IP address, and opt-in method (form or SMS keyword) for compliance purposes.</li>
              <li><strong>Usage Data:</strong> Non-identifiable information such as browser type and interaction logs for service improvement.</li>
            </ul>
          </section>

          <hr className="border-gray-700" />

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">2. How We Use Information</h2>
            <p>We use the collected information to:</p>
            <ul className="list-disc list-inside ml-4 mt-2 space-y-1">
              <li>Send reminders, updates, and communications you've opted in to receive.</li>
              <li>Manage accounts, membership roles, and coordination workflows.</li>
              <li>Maintain legal and carrier compliance.</li>
              <li>Analyze service performance and enhance functionality.</li>
            </ul>
            
            <p className="mt-4"><strong>We never sell or rent your personal data.</strong></p>
          </section>

          <hr className="border-gray-700" />

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">3. SMS Privacy</h2>
            <p>By opting in, you consent to receive recurring SMS messages related to your organization's activities and your account.</p>
            <ul className="list-disc list-inside ml-4 mt-2 space-y-1">
              <li><strong>Frequency:</strong> Up to 6 messages per month.</li>
              <li><strong>Message & Data Rates:</strong> May apply.</li>
              <li>Reply STOP to unsubscribe; HELP for help.</li>
            </ul>
            
            <p className="mt-4">We will not share, sell, or transfer your mobile information with third parties or affiliates for marketing or promotional purposes.</p>
            <p>Mobile numbers, consent records, and SMS metadata are used solely for Enclave's service operations.</p>
            <p>Information may be shared with trusted vendors only as needed to provide the messaging service, under strict confidentiality terms.</p>
          </section>

          <hr className="border-gray-700" />

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">4. Data Sharing and Security</h2>
            <p>We may share limited data with third-party vendors (such as cloud or SMS infrastructure providers) that support our services.</p>
            <p>All partners are required to handle information securely and use it only as directed by Enclave.</p>
            <p>We use reasonable administrative, technical, and physical safeguards to protect data against unauthorized access or misuse.</p>
          </section>

          <hr className="border-gray-700" />

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">5. Data Retention and Deletion</h2>
            <p>We retain user and consent information as long as necessary to operate our services or comply with regulations.</p>
            <p>Upon request, we will delete or anonymize your personal data in accordance with applicable laws.</p>
          </section>

          <hr className="border-gray-700" />

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">6. Your Rights</h2>
            <p>You can:</p>
            <ul className="list-disc list-inside ml-4 mt-2 space-y-1">
              <li>Opt out of SMS messages at any time by replying STOP.</li>
              <li>Request access, correction, or deletion of your data by emailing <a href="mailto:try.inquiyr@gmail.com" className="text-blue-400 hover:text-blue-300 underline">try.inquiyr@gmail.com</a>.</li>
            </ul>
            
            <p className="mt-4">We will respond to such requests within a reasonable timeframe.</p>
          </section>

          <hr className="border-gray-700" />

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">7. Policy Updates</h2>
            <p>We may update this Privacy Policy periodically. Any updates will be posted at <a href="https://www.tryenclave.com/privacy" className="text-blue-400 hover:text-blue-300 underline">https://www.tryenclave.com/privacy</a> with a revised effective date.</p>
          </section>

          <hr className="border-gray-700" />

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">8. Contact Us</h2>
            <p>For questions about this Privacy Policy, contact:</p>
            <p>
              <strong>Email:</strong> <a href="mailto:try.inquiyr@gmail.com" className="text-blue-400 hover:text-blue-300 underline">try.inquiyr@gmail.com</a><br />
              <strong>Website:</strong> <a href="https://www.tryenclave.com" className="text-blue-400 hover:text-blue-300 underline">https://www.tryenclave.com</a>
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}

