'use client'

import React, { createContext, useContext, useState } from 'react'

type SpaceContextValue = {
  currentSpaceId: string
  currentSpaceName: string
  setSpace: (spaceId: string, name?: string) => void
}

const DEFAULT_SPACE_ID = '00000000-0000-0000-0000-000000000000'

const SpaceContext = createContext<SpaceContextValue | undefined>(undefined)

export function SpaceProvider({ children }: { children: React.ReactNode }) {
  const [currentSpaceId, setCurrentSpaceId] = useState<string>(DEFAULT_SPACE_ID)
  const [currentSpaceName, setCurrentSpaceName] = useState<string>('Default')

  const setSpace = (spaceId: string, name?: string) => {
    setCurrentSpaceId(spaceId)
    if (name) setCurrentSpaceName(name)
  }

  return (
    <SpaceContext.Provider value={{ currentSpaceId, currentSpaceName, setSpace }}>
      {children}
    </SpaceContext.Provider>
  )
}

export function useSpace() {
  const ctx = useContext(SpaceContext)
  if (!ctx) throw new Error('useSpace must be used within SpaceProvider')
  return ctx
}


