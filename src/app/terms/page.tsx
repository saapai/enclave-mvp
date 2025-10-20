export default function TermsPage() {
  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">Terms of Service</h1>
        
        <div className="space-y-6 text-gray-300 leading-relaxed">
          <p className="text-sm text-gray-400">
            <strong>Effective Date:</strong> October 2025<br />
            <strong>Last Updated:</strong> October 2025
          </p>

          <p>
            Welcome to Enclave ("we," "our," "us"). By accessing or using our website, app, or SMS messaging services, you agree to these Terms of Service. Please read them carefully.
          </p>

          <hr className="border-gray-700" />

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">1. Use of Services</h2>
            <p>Enclave provides coordination, reminder, and communication tools for organizations and their members.</p>
            <p>By signing up or opting in, you agree to receive relevant communications in connection with your use of our services.</p>
            
            <p className="mt-4">You agree to:</p>
            <ul className="list-disc list-inside ml-4 mt-2 space-y-1">
              <li>Use our services only for lawful and intended purposes.</li>
              <li>Provide accurate information during sign-up or opt-in.</li>
              <li>Refrain from interfering with, abusing, or attempting to disrupt our systems.</li>
            </ul>
            
            <p className="mt-4">We may suspend or terminate your access if we determine you have violated these Terms.</p>
          </section>

          <hr className="border-gray-700" />

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">2. SMS Messaging Terms</h2>
            <p>When you provide your mobile number and opt in to receive SMS messages from Enclave:</p>
            <ul className="list-disc list-inside ml-4 mt-2 space-y-1">
              <li>You consent to receive recurring text messages such as event reminders, task notifications, and organizational updates.</li>
              <li><strong>Frequency:</strong> Up to 6 messages per month.</li>
              <li><strong>Message & Data Rates:</strong> May apply depending on your carrier plan.</li>
              <li>Reply STOP to unsubscribe or HELP for assistance.</li>
            </ul>
            
            <p className="mt-4">We will not share, sell, or transfer your mobile information with third parties or affiliates for marketing or promotional purposes.</p>
            <p>Limited sharing with service providers (e.g., hosting, SMS infrastructure) may occur solely to deliver Enclave's services and under confidentiality obligations.</p>
          </section>

          <hr className="border-gray-700" />

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">3. Intellectual Property</h2>
            <p>All Enclave content—including trademarks, logos, software, and designs—is owned by Enclave or its licensors. You may not copy, modify, or distribute any content without prior written permission.</p>
          </section>

          <hr className="border-gray-700" />

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">4. Disclaimers and Limitation of Liability</h2>
            <p>Our services are provided "as is" without warranties of any kind.</p>
            <p>To the fullest extent permitted by law, Enclave is not liable for indirect, incidental, or consequential damages resulting from your use of our services.</p>
          </section>

          <hr className="border-gray-700" />

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">5. Modifications</h2>
            <p>We may update these Terms periodically. The latest version will always be posted at <a href="https://www.tryenclave.com/terms" className="text-blue-400 hover:text-blue-300 underline">https://www.tryenclave.com/terms</a>.</p>
            <p>Continued use of our services after updates constitutes acceptance of the revised terms.</p>
          </section>

          <hr className="border-gray-700" />

          <section>
            <h2 className="text-2xl font-semibold mb-4 text-white">6. Contact Us</h2>
            <p>For questions or concerns about these Terms, contact us at:</p>
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
