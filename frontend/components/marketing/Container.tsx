import React from 'react';
import { cn } from '@/lib/utils';

export function Container({
  children,
  className = '',
  wide = false,
}: {
  children: React.ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div className={cn('mx-auto w-full px-6 sm:px-8', wide ? 'max-w-7xl' : 'max-w-6xl', className)}>
      {children}
    </div>
  );
}
