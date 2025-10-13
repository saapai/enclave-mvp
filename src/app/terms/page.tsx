import { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Terms of Service & Privacy Policy - Enclave',
  description: 'Terms of Service and Privacy Policy for Enclave and Entrenched Coils SMS Messaging',
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-surface text-primary">
      {/* Header */}
      <header className="border-b border-line bg-[rgba(11,12,14,0.8)] backdrop-blur sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center space-x-4">
              <div className="w-8 h-8 bg-[rgba(59,130,246,0.15)] text-blue-400 rounded-lg flex items-center justify-center">
                <span className="font-bold text-sm">E</span>
              </div>
              <h1 className="text-lg font-semibold text-primary tracking-tight">Enclave</h1>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="space-y-12">
          {/* Header Section */}
          <div>
            <h1 className="text-4xl font-bold text-primary mb-4">Terms of Service & Privacy Policy</h1>
            <p className="text-muted text-lg">
              Last Updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>

          {/* SMS Messaging Terms */}
          <section className="bg-panel border border-line rounded-xl p-8 space-y-6">
            <h2 className="text-2xl font-bold text-primary">SMS Messaging Terms</h2>
            
            <div className="space-y-4">
              <div>
                <h3 className="text-xl font-semibold text-primary mb-2">1. Service Description</h3>
                <p className="text-muted leading-relaxed">
                  Enclave and Entrenched Coils provide SMS messaging services for organizational coordination and personal assistance. 
                  Our messages include event reminders, role and ownership changes, task nudges that users have requested, and short 
                  links to relevant documents or forms.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold text-primary mb-2">2. Message Frequency</h3>
                <p className="text-muted leading-relaxed">
                  Users can expect to receive approximately 2-6 messages per month under normal circumstances. Message frequency may 
                  increase during active events or time-sensitive activities. All messaging is provided on an opt-in basis only.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold text-primary mb-2">3. Message Content</h3>
                <p className="text-muted leading-relaxed mb-2">
                  Our SMS messages will include:
                </p>
                <ul className="list-disc list-inside space-y-1 text-muted ml-4">
                  <li>Event reminders with dates, times, and locations</li>
                  <li>Role and ownership transition notifications</li>
                  <li>Task reminders that you have explicitly requested</li>
                  <li>Short links to Google Docs, forms, or other relevant resources</li>
                  <li>Weekly digests of upcoming commitments and deadlines</li>
                </ul>
                <p className="text-muted leading-relaxed mt-4">
                  <strong>We will NOT send:</strong> Content related to direct lending or loan arrangements, SHAFT content 
                  (Sex, Hate, Alcohol, Firearms, Tobacco), age-gated content, or messages containing personally identifiable 
                  information (PII) beyond your name and organization role.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold text-primary mb-2">4. Opt-In Consent</h3>
                <p className="text-muted leading-relaxed mb-2">
                  Users explicitly opt in to receive SMS updates through two methods:
                </p>
                <div className="space-y-4 ml-4">
                  <div>
                    <h4 className="font-semibold text-primary mb-1">A. Web/App Form Opt-In</h4>
                    <p className="text-muted leading-relaxed">
                      Users visit our opt-in page at{' '}
                      <Link href="/sms-optin" className="text-blue-400 hover:text-blue-300 underline">
                        https://tryenclave.com/sms-optin
                      </Link>{' '}
                      and enter their name and mobile number. They must check a box acknowledging the following disclosure:
                    </p>
                    <div className="bg-panel-2 p-4 rounded-lg border border-line mt-2">
                      <p className="text-primary/90 text-sm leading-relaxed">
                        "I agree to receive recurring SMS updates, reminders, and notifications from Enclave and Entrenched Coils. 
                        Message & data rates may apply. Reply STOP to opt out, HELP for help. Up to 6 messages per month. View our 
                        Terms of Service and Privacy Policy."
                      </p>
                    </div>
                    <p className="text-muted leading-relaxed mt-2">
                      Consent is logged with timestamp, method, and IP address in our secure database.
                    </p>
                  </div>
                  
                  <div>
                    <h4 className="font-semibold text-primary mb-1">B. SMS Keyword Opt-In</h4>
                    <p className="text-muted leading-relaxed">
                      Users can text START, JOIN, or YES to our number to opt in. They will immediately receive a confirmation message:
                    </p>
                    <div className="bg-panel-2 p-4 rounded-lg border border-line mt-2">
                      <p className="text-primary/90 text-sm leading-relaxed">
                        "[Enclave/Entrenched Coils] You're opted in for updates and reminders. Up to 6 msgs/mo. Msg&Data rates may apply. 
                        Reply HELP for help, STOP to opt out."
                      </p>
                    </div>
                    <p className="text-muted leading-relaxed mt-2">
                      Consent is logged with timestamp, source, and keyword in our system.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-xl font-semibold text-primary mb-2">5. Opt-Out Process</h3>
                <p className="text-muted leading-relaxed">
                  Users can opt out at any time by texting any of the following keywords to our number: STOP, END, CANCEL, 
                  UNSUBSCRIBE, or QUIT. Upon receiving an opt-out request, we will immediately cease sending messages and send 
                  a confirmation of opt-out.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold text-primary mb-2">6. Help Support</h3>
                <p className="text-muted leading-relaxed">
                  Users can text HELP to our number to receive assistance. They will receive information about how to contact 
                  support and how to opt out of messages.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold text-primary mb-2">7. Message & Data Rates</h3>
                <p className="text-muted leading-relaxed">
                  Standard message and data rates may apply based on your mobile carrier plan. Please check with your carrier 
                  for details about your messaging plan.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold text-primary mb-2">8. Compatible Carriers</h3>
                <p className="text-muted leading-relaxed">
                  Our SMS service is compatible with all major U.S. carriers including AT&T, T-Mobile, Verizon, Sprint, and others. 
                  If you experience issues receiving messages, please contact support.
                </p>
              </div>
            </div>
          </section>

          {/* Privacy Policy */}
          <section className="bg-panel border border-line rounded-xl p-8 space-y-6">
            <h2 className="text-2xl font-bold text-primary">Privacy Policy</h2>
            
            <div className="space-y-4">
              <div>
                <h3 className="text-xl font-semibold text-primary mb-2">1. Information We Collect</h3>
                <p className="text-muted leading-relaxed mb-2">
                  When you opt in to our SMS service, we collect:
                </p>
                <ul className="list-disc list-inside space-y-1 text-muted ml-4">
                  <li>Your mobile phone number</li>
                  <li>Your name (if provided)</li>
                  <li>Opt-in timestamp and method</li>
                  <li>IP address (for web opt-ins)</li>
                  <li>Message delivery status and timestamps</li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold text-primary mb-2">2. How We Use Your Information</h3>
                <p className="text-muted leading-relaxed mb-2">
                  We use your information solely for:
                </p>
                <ul className="list-disc list-inside space-y-1 text-muted ml-4">
                  <li>Sending you the SMS notifications you have opted in to receive</li>
                  <li>Processing opt-out requests</li>
                  <li>Providing customer support</li>
                  <li>Complying with legal obligations</li>
                  <li>Improving our service quality</li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold text-primary mb-2">3. Data Sharing</h3>
                <p className="text-muted leading-relaxed">
                  We do not sell, rent, or share your phone number or personal information with third parties for their marketing 
                  purposes. We may share information with:
                </p>
                <ul className="list-disc list-inside space-y-1 text-muted ml-4">
                  <li>Twilio (our SMS service provider) to deliver messages</li>
                  <li>Law enforcement when required by law</li>
                  <li>Service providers who assist in operating our platform under strict confidentiality agreements</li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold text-primary mb-2">4. Third-Party Lists</h3>
                <p className="text-muted leading-relaxed">
                  We do not use third-party or purchased phone number lists. All phone numbers in our system have been explicitly 
                  opted in through our web form or SMS keyword opt-in process.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold text-primary mb-2">5. Data Retention</h3>
                <p className="text-muted leading-relaxed">
                  We retain your phone number and consent information for as long as you remain opted in to our service. After 
                  you opt out, we retain your phone number on our opt-out list to ensure we do not message you again, but we 
                  delete other associated data within 90 days.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold text-primary mb-2">6. Data Security</h3>
                <p className="text-muted leading-relaxed">
                  We implement industry-standard security measures to protect your personal information, including encryption 
                  in transit and at rest, access controls, and regular security audits.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold text-primary mb-2">7. Your Rights</h3>
                <p className="text-muted leading-relaxed mb-2">
                  You have the right to:
                </p>
                <ul className="list-disc list-inside space-y-1 text-muted ml-4">
                  <li>Access the personal information we hold about you</li>
                  <li>Request correction of inaccurate information</li>
                  <li>Request deletion of your information (subject to legal obligations)</li>
                  <li>Opt out of SMS messages at any time</li>
                  <li>File a complaint with a data protection authority</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Contact Information */}
          <section className="bg-panel border border-line rounded-xl p-8 space-y-4">
            <h2 className="text-2xl font-bold text-primary">Contact Us</h2>
            <p className="text-muted leading-relaxed">
              If you have questions about these Terms of Service, our Privacy Policy, or our SMS messaging service, please contact us at:
            </p>
            <div className="bg-panel-2 p-4 rounded-lg border border-line">
              <p className="text-primary/90">
                <strong>Email:</strong> support@tryenclave.com<br />
                <strong>Website:</strong>{' '}
                <Link href="/" className="text-blue-400 hover:text-blue-300 underline">
                  https://tryenclave.com
                </Link>
              </p>
            </div>
          </section>

          {/* Footer Navigation */}
          <div className="flex justify-center space-x-6 pt-8 border-t border-line">
            <Link href="/sms-optin" className="text-blue-400 hover:text-blue-300 underline">
              SMS Opt-In
            </Link>
            <Link href="/" className="text-blue-400 hover:text-blue-300 underline">
              Back to Home
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-line mt-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <p className="text-center text-subtle text-sm">
            © {new Date().getFullYear()} Enclave. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}

