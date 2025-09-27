import { SignUp } from '@clerk/nextjs'

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="w-full max-w-md p-6">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-[rgba(59,130,246,0.15)] text-blue-400 rounded-xl flex items-center justify-center mx-auto mb-4">
            <div className="text-2xl font-bold">E</div>
          </div>
          <h1 className="hero-title text-primary mb-2">Join Enclave</h1>
          <p className="hero-subtitle">Get access to your chapter's knowledge base</p>
        </div>
        <SignUp 
          appearance={{
            elements: {
              formButtonPrimary: 'bg-gradient-to-r from-blue-600 to-red-600 text-white hover:opacity-90 rounded-xl font-medium',
              card: 'bg-panel border border-line shadow-[0_0_0_1px_rgba(255,255,255,0.02)] rounded-xl',
              headerTitle: 'text-primary font-semibold',
              headerSubtitle: 'text-muted',
              socialButtonsBlockButton: 'bg-panel border border-line text-primary hover:bg-panel-2 rounded-xl',
              formFieldInput: 'bg-panel border border-line text-primary placeholder:text-subtle focus:shadow-glow-blue rounded-xl',
              formFieldLabel: 'text-white/70 font-semibold',
              identityPreviewText: 'text-muted',
              formButtonReset: 'text-muted hover:text-primary',
              dividerLine: 'bg-line',
              dividerText: 'text-subtle',
              footerActionLink: 'text-blue-400 hover:text-blue-300',
              formFieldSuccessText: 'text-green-400',
              formFieldErrorText: 'text-red-400'
            }
          }}
        />
      </div>
    </div>
  )
}
