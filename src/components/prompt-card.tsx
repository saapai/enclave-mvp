'use client'

import { ReactNode } from 'react'

interface PromptCardProps {
  icon: ReactNode
  children: ReactNode
  onClick: () => void
}

export function PromptCard({ icon, children, onClick }: PromptCardProps) {
  return (
    <button
      onClick={onClick}
      className="
        group text-left w-full
        rounded-xl border border-white/12 bg-white/[0.045]
        hover:bg-white/[0.065] transition
        px-4 py-4
        shadow-[0_0_0_1px_rgba(255,255,255,0.02)] 
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(59,130,246,.45)]
      "
    >
      <div className="flex items-start gap-3">
        <span
          className="
            inline-grid place-items-center
            rounded-md p-1.5
            text-blue-400 bg-blue-500/[0.08]
            shadow-[inset_0_0_0_1px_rgba(59,130,246,.15)]
          "
        >
          {icon}
        </span>

        <span className="ui-label text-white/90">
          {children}
        </span>
      </div>
    </button>
  )
}











