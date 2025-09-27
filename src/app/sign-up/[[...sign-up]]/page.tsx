'use client'

import { SignUp } from '@clerk/nextjs'

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="w-full max-w-md p-6">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-[rgba(59,130,246,0.15)] text-blue-400 rounded-xl flex items-center justify-center mx-auto mb-6">
            <div className="text-2xl font-bold">E</div>
          </div>
          <h1 className="text-4xl font-bold text-primary mb-3 tracking-tight">Join Enclave</h1>
          <p className="text-lg text-white/65 leading-relaxed max-w-sm mx-auto">Get access to your chapter's knowledge base</p>
        </div>
        <SignUp 
          signInUrl="/sign-in"
          fallbackRedirectUrl="/"
          forceRedirectUrl="/"
          unsafeMetadata={{
            allowSignUp: true
          }}
          appearance={{
            baseTheme: undefined,
            elements: {
              rootBox: 'w-full',
              card: 'bg-panel border border-line shadow-[0_0_0_1px_rgba(255,255,255,0.02)] rounded-xl p-6',
              headerTitle: 'hidden',
              headerSubtitle: 'hidden',
              socialButtonsBlockButton: 'bg-panel border border-line text-primary hover:bg-panel-2 rounded-xl h-10',
              socialButtonsBlockButtonText: 'text-primary',
              formButtonPrimary: 'bg-gradient-to-r from-blue-600 to-red-600 text-white hover:opacity-90 rounded-xl font-medium h-10',
              formFieldInput: 'bg-panel border border-line text-primary placeholder:text-subtle focus:shadow-glow-blue rounded-xl h-10',
              formFieldLabel: 'text-white/70 font-semibold text-sm',
              identityPreviewText: 'text-muted text-sm',
              formButtonReset: 'text-muted hover:text-primary text-sm',
              dividerLine: 'bg-line',
              dividerText: 'text-subtle text-sm',
              footerActionLink: 'text-blue-400 hover:text-blue-300 text-sm',
              formFieldSuccessText: 'text-green-400 text-sm',
              formFieldErrorText: 'text-red-400 text-sm',
              formFieldWarningText: 'text-yellow-400 text-sm',
              identityPreviewEditButton: 'text-blue-400 hover:text-blue-300',
              formHeaderTitle: 'text-primary font-semibold',
              formHeaderSubtitle: 'text-muted text-sm',
              otpCodeFieldInput: 'bg-panel border border-line text-primary focus:shadow-glow-blue rounded-xl',
              formResendCodeLink: 'text-blue-400 hover:text-blue-300 text-sm',
              footerAction: 'text-muted text-sm',
              footerActionText: 'text-muted text-sm',
              formFieldRow: 'space-y-2',
              formField: 'space-y-2'
            }
          }}
        />
      </div>
    </div>
  )
}
