
export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="w-full max-w-md p-6">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-[rgba(59,130,246,0.15)] text-blue-400 rounded-xl flex items-center justify-center mx-auto mb-6">
            <div className="text-2xl font-bold">E</div>
          </div>
          <h1 className="text-4xl font-bold text-primary mb-3 tracking-tight">Welcome to Enclave</h1>
          <p className="text-lg text-white/65 leading-relaxed max-w-sm mx-auto mb-8">The answer layer for your chapter. Please sign in to continue.</p>
          
          {/* Custom Sign In Button */}
          <button 
            onClick={() => window.location.href = '/sign-in/clerk'}
            className="w-full bg-gradient-to-r from-blue-600 to-red-600 text-white font-medium py-3 px-6 rounded-xl hover:opacity-90 transition-opacity"
          >
            Sign In
          </button>
        </div>
      </div>
    </div>
  )
}

