import { SignIn } from '@clerk/nextjs'

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="w-full max-w-md p-6">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center mx-auto mb-4">
            <div className="text-white text-2xl font-bold">E</div>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Welcome to Enclave</h1>
          <p className="text-zinc-400">The answer layer for your chapter. Please sign in to continue.</p>
        </div>
        <SignIn 
          appearance={{
            elements: {
              formButtonPrimary: 'bg-blue-600 hover:bg-blue-700 text-white',
              card: 'bg-zinc-900 border border-zinc-800 shadow-2xl',
              headerTitle: 'text-white',
              headerSubtitle: 'text-zinc-400',
              socialButtonsBlockButton: 'bg-zinc-800 border-zinc-700 text-white hover:bg-zinc-700',
              formFieldInput: 'bg-zinc-800 border-zinc-700 text-white',
              formFieldLabel: 'text-zinc-300',
              identityPreviewText: 'text-zinc-400',
              formButtonReset: 'text-zinc-400 hover:text-white'
            }
          }}
        />
      </div>
    </div>
  )
}

