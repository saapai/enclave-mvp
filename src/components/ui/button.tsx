import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center gap-2 rounded-xl ui-label transition focus-visible:outline-none focus-visible:ring-2 ring-offset-0 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-gradient-to-r from-blue-600 to-red-600 text-white hover:opacity-90 px-3 py-2",
        secondary: "border border-white/12 bg-white/[0.045] hover:bg-white/[0.065] text-white/90 px-3 py-1.5",
        ghost: "text-white/80 hover:text-white px-2 py-1",
        outline: "border border-line text-muted hover:text-primary hover:bg-panel-2 px-3 py-1.5",
      },
      size: {
        default: "px-3 py-2",
        sm: "px-2 py-1",
        lg: "px-4 py-3",
        icon: "p-2",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
