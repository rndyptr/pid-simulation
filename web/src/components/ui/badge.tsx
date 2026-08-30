import * as React from 'react';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const badgeVariants = cva(
  'inline-flex items-center justify-center border border-transparent font-medium rounded-full [&_svg]:-ms-px [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'text-blue-300 bg-blue-500/15',
        secondary: 'text-muted-foreground bg-muted',
        success: 'text-emerald-300 bg-emerald-500/15',
        warning: 'text-amber-300 bg-amber-500/15',
        destructive: 'text-red-300 bg-red-500/15',
      },
      size: {
        md: 'h-6 px-2.5 text-[11px] tracking-wide',
        sm: 'h-5 px-2 text-[10px] tracking-wide',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

function Badge({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

export { Badge, badgeVariants };
