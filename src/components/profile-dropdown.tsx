'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronDown, LogOut } from 'lucide-react'

interface ProfileDropdownProps {
  userName: string
  userEmail: string
  userInitials: string
  onSignOut: () => void
}

export function ProfileDropdown({ userName, userEmail, userInitials, onSignOut }: ProfileDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="secondary"
        className="h-9 px-3 bg-[#2a2a2f] border border-gray-600 hover:bg-[#3a3a3f] text-white font-medium"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center space-x-2">
          <div className="h-6 w-6 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 flex items-center justify-center">
            <span className="text-white text-xs font-medium">
              {userInitials}
            </span>
          </div>
          <span className="hidden sm:inline text-sm">
            {userName || 'Profile'}
          </span>
          <ChevronDown className="h-3 w-3" />
        </div>
      </Button>
      
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-[#1a1a1f] border border-gray-700 shadow-xl rounded-lg z-[9999]">
          <div className="py-1">
            <div className="flex flex-col space-y-1 px-3 py-2 border-b border-gray-700">
              <p className="text-sm font-medium leading-none text-white">{userName}</p>
              <p className="text-xs leading-none text-gray-300">
                {userEmail}
              </p>
            </div>
            <button
              onClick={() => {
                onSignOut()
                setIsOpen(false)
              }}
              className="w-full px-3 py-2 text-left text-sm text-white hover:bg-[#2a2a2f] flex items-center"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Log out
            </button>
          </div>
        </div>
      )}
      
      {/* Click outside to close */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-[9998]" 
          onClick={() => setIsOpen(false)}
        ></div>
      )}
    </div>
  )
}

