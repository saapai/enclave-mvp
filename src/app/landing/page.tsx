'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { 
  FileText, 
  Search, 
  Users, 
  Calendar,
  Zap,
  Shield,
  ArrowRight,
  Mail
} from 'lucide-react'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-primary">
      {/* Header */}
      <header className="fixed top-0 w-full z-50 border-b border-line bg-background/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/landing" className="flex items-center gap-3">
            <div className="text-2xl">🔥</div>
            <div>
              <h1 className="text-xl font-bold text-primary">Enclave</h1>
              <p className="text-xs text-muted">Stop digging. Start finding.</p>
            </div>
          </Link>
          
          <div className="flex items-center gap-4">
            <a 
              href="mailto:try.inquiyr@gmail.com"
              className="text-muted hover:text-primary transition-colors flex items-center gap-2"
            >
              <Mail className="w-4 h-4" />
              <span className="hidden sm:inline">Contact</span>
            </a>
            <Link href="/">
              <Button className="bg-gradient-to-r from-blue-500 to-red-500 hover:from-blue-600 hover:to-red-600">
                Sign In
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-6xl mx-auto text-center">
          <h2 className="text-6xl sm:text-7xl font-bold mb-6">
            Stop Drowning.
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-red-400">
              Be Intelligent.
            </span>
          </h2>
          
          <p className="text-xl text-muted max-w-3xl mx-auto mb-12">
            Transform scattered documents into strategic insights. Ask questions, get answers, discover opportunities.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/">
              <Button size="lg" className="bg-gradient-to-r from-blue-500 to-red-500 hover:from-blue-600 hover:to-red-600 text-lg px-8 py-6">
                Start Free <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
            <a 
              href="mailto:try.inquiyr@gmail.com"
              className="text-muted hover:text-primary transition-colors text-lg"
            >
              Watch Demo →
            </a>
          </div>
        </div>
      </section>

      {/* Problem Section */}
      <section className="py-20 px-6 bg-panel/30">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h3 className="text-4xl font-bold mb-4">
                The Hidden Cost of
                <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-red-400">
                  Scattered Knowledge
                </span>
              </h3>
              <p className="text-lg text-muted mb-6">
                Business leaders spend <span className="text-primary font-semibold">30% of their time</span> searching for information they already have.
              </p>
              <ul className="space-y-4">
                <li className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-red-500 mt-2"></div>
                  <span className="text-muted">Documents spread across email, drives, and systems</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-red-500 mt-2"></div>
                  <span className="text-muted">Critical insights buried in lengthy reports</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-red-500 mt-2"></div>
                  <span className="text-muted">Team knowledge trapped in individual files</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-red-500 mt-2"></div>
                  <span className="text-muted">Decision delays while hunting for information</span>
                </li>
              </ul>
            </div>

            <Card className="bg-panel/50 border-line p-8">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500/20 to-red-500/20 flex items-center justify-center">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-red-500"></div>
                </div>
                <div>
                  <p className="text-sm text-muted">Business Owner Thoughts</p>
                </div>
              </div>
              <blockquote className="text-2xl italic text-primary">
                "I spend more time looking for documents than using them."
              </blockquote>
            </Card>
          </div>
        </div>
      </section>

      {/* Solution Section */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h3 className="text-5xl font-bold mb-4">
              Meet Your{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-red-400">
                AI Knowledge Assistant
              </span>
            </h3>
            <p className="text-xl text-muted max-w-3xl mx-auto">
              Upload your documents, ask natural questions, get instant insights. It's like having a brilliant analyst who's read everything.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 mb-16">
            <Card className="bg-panel border-line p-6 hover:border-primary/50 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-500/10 flex items-center justify-center mb-4">
                <FileText className="w-6 h-6 text-blue-400" />
              </div>
              <h4 className="text-xl font-semibold mb-2 text-primary">Smart Document Processing</h4>
              <p className="text-muted">
                Upload PDFs, Word docs, and text files. Connect Google Docs. Our AI extracts and indexes everything.
              </p>
            </Card>

            <Card className="bg-panel border-line p-6 hover:border-primary/50 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-purple-500/10 flex items-center justify-center mb-4">
                <Search className="w-6 h-6 text-purple-400" />
              </div>
              <h4 className="text-xl font-semibold mb-2 text-primary">Natural Language Queries</h4>
              <p className="text-muted">
                Ask questions like you're talking to a colleague. No complex search syntax needed.
              </p>
            </Card>

            <Card className="bg-panel border-line p-6 hover:border-primary/50 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500/20 to-orange-500/10 flex items-center justify-center mb-4">
                <Users className="w-6 h-6 text-orange-400" />
              </div>
              <h4 className="text-xl font-semibold mb-2 text-primary">Team Collaboration</h4>
              <p className="text-muted">
                Share workspaces, insights, and discoveries with your team seamlessly.
              </p>
            </Card>

            <Card className="bg-panel border-line p-6 hover:border-primary/50 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500/20 to-green-500/10 flex items-center justify-center mb-4">
                <Calendar className="w-6 h-6 text-green-400" />
              </div>
              <h4 className="text-xl font-semibold mb-2 text-primary">Calendar Integration</h4>
              <p className="text-muted">
                Connect Google Calendar to make events and schedules instantly searchable.
              </p>
            </Card>

            <Card className="bg-panel border-line p-6 hover:border-primary/50 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-red-500/20 to-red-500/10 flex items-center justify-center mb-4">
                <Zap className="w-6 h-6 text-red-400" />
              </div>
              <h4 className="text-xl font-semibold mb-2 text-primary">Instant Insights</h4>
              <p className="text-muted">
                Get answers in seconds, not hours. Make faster, more informed decisions.
              </p>
            </Card>

            <Card className="bg-panel border-line p-6 hover:border-primary/50 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-gray-500/20 to-gray-500/10 flex items-center justify-center mb-4">
                <Shield className="w-6 h-6 text-gray-400" />
              </div>
              <h4 className="text-xl font-semibold mb-2 text-primary">Enterprise Security</h4>
              <p className="text-muted">
                Your data stays secure with encryption and privacy controls built in.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-6 bg-panel/30">
        <div className="max-w-6xl mx-auto">
          <h3 className="text-4xl font-bold text-center mb-16">
            How It Works
          </h3>

          <div className="grid md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center mx-auto mb-4 text-2xl font-bold">
                1
              </div>
              <h4 className="text-lg font-semibold mb-2 text-primary">Upload</h4>
              <p className="text-muted text-sm">Add documents, connect Google Docs & Calendar</p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center mx-auto mb-4 text-2xl font-bold">
                2
              </div>
              <h4 className="text-lg font-semibold mb-2 text-primary">Process</h4>
              <p className="text-muted text-sm">AI extracts, indexes, and understands your content</p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center mx-auto mb-4 text-2xl font-bold">
                3
              </div>
              <h4 className="text-lg font-semibold mb-2 text-primary">Query</h4>
              <p className="text-muted text-sm">Ask questions in natural language</p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center mx-auto mb-4 text-2xl font-bold">
                4
              </div>
              <h4 className="text-lg font-semibold mb-2 text-primary">Discover</h4>
              <p className="text-muted text-sm">Get instant answers with source documents</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h3 className="text-5xl font-bold mb-6">
            Ready to{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-red-400">
              Stop Drowning?
            </span>
          </h3>
          <p className="text-xl text-muted mb-12">
            Turn your scattered documents into strategic intelligence.
          </p>

          <div className="flex flex-col items-center gap-6">
            <Link href="/">
              <Button size="lg" className="bg-gradient-to-r from-blue-500 to-red-500 hover:from-blue-600 hover:to-red-600 text-lg px-12 py-6">
                Start Free Today <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
            <p className="text-muted">
              Free forever • 5 team members • 25 docs per workspace • 500 queries/month
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-line py-8 px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🔥</span>
            <span className="text-muted">© 2025 Enclave. All rights reserved.</span>
          </div>
          <div className="flex items-center gap-6">
            <a 
              href="mailto:try.inquiyr@gmail.com"
              className="text-muted hover:text-primary transition-colors flex items-center gap-2"
            >
              <Mail className="w-4 h-4" />
              Contact
            </a>
            <Link href="/terms" className="text-muted hover:text-primary transition-colors">
              Terms & Privacy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

