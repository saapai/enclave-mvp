import { SignUp } from '@clerk/nextjs'

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="w-full max-w-md p-6">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-white rounded-xl flex items-center justify-center mx-auto mb-4">
            <div className="text-black text-2xl font-bold">E</div>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Join Enclave</h1>
          <p className="text-gray-400">Get access to your chapter's knowledge base</p>
        </div>
        <SignUp 
          appearance={{
            elements: {
              formButtonPrimary: 'bg-white text-black hover:bg-gray-200',
              card: 'bg-gray-900 border border-gray-700 shadow-2xl',
              headerTitle: 'text-white',
              headerSubtitle: 'text-gray-400',
              socialButtonsBlockButton: 'bg-gray-800 border-gray-600 text-white hover:bg-gray-700',
              formFieldInput: 'bg-gray-800 border-gray-600 text-white',
              formFieldLabel: 'text-gray-300',
              identityPreviewText: 'text-gray-400',
              formButtonReset: 'text-gray-400 hover:text-white'
            }
          }}
        />
      </div>
    </div>
  )
}
