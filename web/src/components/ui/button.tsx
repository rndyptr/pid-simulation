import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { Slot as SlotPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'cursor-pointer group whitespace-nowrap focus-visible:outline-hidden inline-flex items-center justify-center has-data-[arrow=true]:justify-between whitespace-nowrap text-sm font-medium ring-offset-background transition-[color,box-shadow] disabled:pointer-events-none disabled:opacity-60 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90 data-[state=open]:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 data-[state=open]:bg-destructive/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/90 data-[state=open]:bg-secondary/90',
        outline:
          'bg-background text-accent-foreground border border-input hover:bg-accent data-[state=open]:bg-accent',
        ghost:
          'text-accent-foreground hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground',
      },
      size: {
        lg: 'h-10 rounded-md px-4 text-sm gap-1.5 [&_svg:not([class*=size-])]:size-4',
        md: 'h-8.5 rounded-md px-3 gap-1.5 text-[0.8125rem] [&_svg:not([class*=size-])]:size-4',
        sm: 'h-7 rounded-md px-2.5 gap-1.25 text-xs [&_svg:not([class*=size-])]:size-3.5',
        icon: 'size-8.5 rounded-md [&_svg:not([class*=size-])]:size-4 shrink-0',
      },
    },
    compoundVariants: [
      { variant: 'primary', className: 'shadow-xs shadow-black/5' },
      { variant: 'secondary', className: 'shadow-xs shadow-black/5' },
      { variant: 'outline', className: 'shadow-xs shadow-black/5' },
      { variant: 'destructive', className: 'shadow-xs shadow-black/5' },
    ],
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    selected?: boolean;
    asChild?: boolean;
  }) {
  const { selected, ...rest } = props;
  const Comp = asChild ? SlotPrimitive.Slot : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...(selected && { 'data-state': 'open' })}
      {...rest}
    />
  );
}

interface ButtonArrowProps extends React.SVGProps<SVGSVGElement> {
  icon?: LucideIcon;
}

function ButtonArrow({ icon: Icon = ChevronDown, className, ...props }: ButtonArrowProps) {
  return <Icon data-slot="button-arrow" className={cn('ms-auto -me-1', className)} {...props} />;
}

export { Button, ButtonArrow, buttonVariants };
