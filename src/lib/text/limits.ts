export function smsTighten(s: string, max = 300): string {
  const oneLine = s.replace(/\s+\n/g, ' ').replace(/\n{2,}/g, '\n').trim()
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + '…'
}


