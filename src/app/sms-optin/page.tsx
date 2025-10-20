'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, CheckCircle, AlertCircle, MessageSquare } from 'lucide-react'

export default function SMSOptInPage() {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const formatPhoneNumber = (value: string) => {
    // Remove all non-numeric characters
    const phoneNumber = value.replace(/\D/g, '')
    
    // Format as (XXX) XXX-XXXX
    if (phoneNumber.length <= 3) {
      return phoneNumber
    } else if (phoneNumber.length <= 6) {
      return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3)}`
    } else {
      return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6, 10)}`
    }
  }

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value)
    setPhone(formatted)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!name.trim() || !phone.trim() || !agreed) {
      setError('Please fill in all fields and agree to the terms')
      return
    }

    // Extract just the digits from the phone number
    const phoneDigits = phone.replace(/\D/g, '')
    
    if (phoneDigits.length !== 10) {
      setError('Please enter a valid 10-digit phone number')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/sms/optin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim(),
          phone: `+1${phoneDigits}`,
          method: 'web_form',
          ipAddress: '', // Will be captured server-side
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to opt in')
      }

      setSuccess(true)
      setName('')
      setPhone('')
      setAgreed(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-surface text-primary flex flex-col">
        {/* Header */}
        <header className="border-b border-line bg-[rgba(11,12,14,0.8)] backdrop-blur">
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

        {/* Success Message */}
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md w-full">
            <div className="bg-panel border border-line rounded-xl p-8 text-center">
              <div className="w-16 h-16 bg-green-500/10 text-green-400 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle className="h-8 w-8" />
              </div>
              <h2 className="text-2xl font-bold text-primary mb-4">You're All Set!</h2>
              <p className="text-muted leading-relaxed mb-6">
                You've successfully opted in to receive SMS updates from Enclave and Entrenched Coils. 
                You'll receive up to 6 messages per month with event reminders, task nudges, and important updates.
              </p>
              <div className="bg-panel-2 p-4 rounded-lg border border-line mb-6">
                <p className="text-sm text-primary/90 leading-relaxed">
                  <strong>Remember:</strong> You can opt out at any time by texting STOP to our number. 
                  Text HELP for assistance.
                </p>
              </div>
              <div className="space-y-3">
                <Button
                  onClick={() => setSuccess(false)}
                  className="w-full bg-gradient-to-r from-blue-600 to-red-600 hover:from-blue-700 hover:to-red-700 text-white border-0"
                >
                  Opt In Another Number
                </Button>
                <Link href="/">
                  <Button variant="outline" className="w-full">
                    Back to Home
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-line mt-8">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <p className="text-center text-subtle text-sm">
              © {new Date().getFullYear()} Enclave. All rights reserved.
            </p>
          </div>
        </footer>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface text-primary flex flex-col">
      {/* Header */}
      <header className="border-b border-line bg-[rgba(11,12,14,0.8)] backdrop-blur">
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
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="max-w-2xl w-full">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-[rgba(59,130,246,0.15)] text-blue-400 rounded-full flex items-center justify-center mx-auto mb-6">
              <MessageSquare className="h-8 w-8" />
            </div>
            <h1 className="text-4xl font-bold text-primary mb-4">SMS Notifications</h1>
            <p className="text-lg text-muted leading-relaxed">
              Stay updated with event reminders, task nudges, and important notifications from Enclave and Entrenched Coils.
            </p>
          </div>

          {/* What You'll Receive */}
          <div className="bg-panel border border-line rounded-xl p-6 mb-8">
            <h2 className="text-lg font-semibold text-primary mb-4">What You'll Receive</h2>
            <ul className="space-y-3">
              <li className="flex items-start">
                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                <span className="text-muted">Event reminders with dates, times, and locations</span>
              </li>
              <li className="flex items-start">
                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                <span className="text-muted">Role and ownership change notifications</span>
              </li>
              <li className="flex items-start">
                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                <span className="text-muted">Task reminders you've requested</span>
              </li>
              <li className="flex items-start">
                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                <span className="text-muted">Short links to relevant documents and forms</span>
              </li>
              <li className="flex items-start">
                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                <span className="text-muted">Weekly digests of upcoming commitments</span>
              </li>
            </ul>
            <div className="mt-4 pt-4 border-t border-line">
              <p className="text-sm text-muted">
                <strong className="text-primary">Frequency:</strong> Typically 2-6 messages per month. May increase during active events.
              </p>
            </div>
          </div>

          {/* Opt-In Form */}
          <div className="bg-panel border border-line rounded-xl p-8">
            <h2 className="text-2xl font-bold text-primary mb-6">Opt In to SMS Updates</h2>
            
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-start">
                  <AlertCircle className="h-5 w-5 text-red-400 mr-3 flex-shrink-0 mt-0.5" />
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              <div>
                <label htmlFor="name" className="block text-sm font-medium text-primary mb-2">
                  Full Name
                </label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Enter your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-panel border border-line text-primary"
                  disabled={loading}
                  required
                />
              </div>

              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-primary mb-2">
                  Mobile Phone Number
                </label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="(555) 123-4567"
                  value={phone}
                  onChange={handlePhoneChange}
                  className="bg-panel border border-line text-primary"
                  disabled={loading}
                  maxLength={14}
                  required
                />
                <p className="text-xs text-muted mt-1">
                  U.S. phone numbers only. Message & data rates may apply.
                </p>
              </div>

              <div className="bg-panel-2 p-4 rounded-lg border border-line">
                <div className="flex items-start space-x-3">
                  <input
                    id="agree"
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-line bg-panel text-blue-600 focus:ring-blue-500"
                    disabled={loading}
                    required
                  />
                  <label htmlFor="agree" className="text-sm text-muted leading-relaxed cursor-pointer">
                    I agree to receive recurring SMS updates, reminders, and notifications from Enclave and Entrenched Coils. 
                    Message & data rates may apply. Reply STOP to opt out, HELP for help. Up to 6 messages per month. View our{' '}
                    <Link href="/terms" className="text-blue-400 hover:text-blue-300 underline" target="_blank">
                      Terms of Service and Privacy Policy
                    </Link>.
                  </label>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading || !agreed}
                className="w-full bg-gradient-to-r from-blue-600 to-red-600 hover:from-blue-700 hover:to-red-700 text-white border-0 h-12 text-base"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  'Submit Opt-In'
                )}
              </Button>
            </form>

            <div className="mt-6 pt-6 border-t border-line">
              <p className="text-sm text-muted text-center">
                Already opted in?{' '}
                <span className="text-primary">Text HELP</span> to our number for assistance or{' '}
                <span className="text-primary">STOP</span> to opt out.
              </p>
            </div>
          </div>

          {/* Alternative Method */}
          <div className="mt-8 bg-panel-2 border border-line rounded-xl p-6">
            <h3 className="text-lg font-semibold text-primary mb-3">Alternative: Text to Opt In</h3>
            <p className="text-muted leading-relaxed mb-4">
              You can also opt in by texting <strong className="text-primary">START</strong>,{' '}
              <strong className="text-primary">JOIN</strong>, or <strong className="text-primary">YES</strong> to our number.
            </p>
            <p className="text-sm text-subtle">
              Note: The phone number will be provided to you via our platform or onboarding materials.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-line mt-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-center space-x-6 mb-4">
            <Link href="/terms" className="text-blue-400 hover:text-blue-300 underline text-sm">
              Terms of Service
            </Link>
            <Link href="/privacy" className="text-blue-400 hover:text-blue-300 underline text-sm">
              Privacy Policy
            </Link>
            <Link href="/" className="text-blue-400 hover:text-blue-300 underline text-sm">
              Back to Home
            </Link>
          </div>
          <p className="text-center text-subtle text-sm">
            © {new Date().getFullYear()} Enclave. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}



