"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Plus, FileText, Link, MessageSquare, Calendar, RefreshCw, Loader2 } from 'lucide-react'

interface SimpleDropdownProps {
  onUpload: () => void
  onConnectDoc: () => void
  onSlack: () => void
  onCalendar: () => void
  onRefresh: () => void
  refreshing: boolean
}

export function SimpleDropdown({ onUpload, onConnectDoc, onSlack, onCalendar, onRefresh, refreshing }: SimpleDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="relative">
      <Button 
        onClick={() => setIsOpen(!isOpen)}
        className="bg-gradient-to-r from-blue-600 to-red-600 hover:from-blue-700 hover:to-red-700 text-white border-0"
      >
        <Plus className="h-4 w-4 mr-2" />
        Add
      </Button>
      
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-gray-200 shadow-lg rounded-md z-[9999]">
          <div className="py-1">
            <button
              onClick={() => {
                onUpload()
                setIsOpen(false)
              }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center"
            >
              <FileText className="h-4 w-4 mr-2" />
              Add Resource
            </button>
            <button
              onClick={() => {
                onConnectDoc()
                setIsOpen(false)
              }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center"
            >
              <Link className="h-4 w-4 mr-2" />
              Add Live Google Doc
            </button>
            <button
              onClick={() => {
                onSlack()
                setIsOpen(false)
              }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center"
            >
              <MessageSquare className="h-4 w-4 mr-2" />
              Connect Slack
            </button>
            <button
              onClick={() => {
                onCalendar()
                setIsOpen(false)
              }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center"
            >
              <Calendar className="h-4 w-4 mr-2" />
              Connect Google Calendar
            </button>
            <hr className="my-1" />
            <button
              onClick={() => {
                onRefresh()
                setIsOpen(false)
              }}
              disabled={refreshing}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center disabled:opacity-50"
            >
              {refreshing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Refreshing...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh All Docs
                </>
              )}
            </button>
          </div>
        </div>
      )}
      
      {/* Click outside to close */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-[9998]" 
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  )
}
