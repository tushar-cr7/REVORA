import React from 'react';

interface SectionHeaderProps {
  title: string;
  description?: string;
  icon?: React.ElementType;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function SectionHeader({ title, description, icon: Icon, className = '', size = 'md' }: SectionHeaderProps) {
  const titleSizes = {
    sm: 'text-[14px]',
    md: 'text-[16px]',
    lg: 'text-[20px] tracking-[-0.02em]',
  };

  const iconSizes = {
    sm: 'w-4 h-4',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center gap-2">
        {/* Icons here are navigation/identity, not state — neutral, not accent blue. */}
        {Icon && <Icon strokeWidth={1.75} className={`${iconSizes[size]} text-text-secondary`} />}
        <h2 className={`${titleSizes[size]} font-semibold tracking-[-0.01em] text-text-primary`}>{title}</h2>
      </div>
      {description && <p className="text-[13px] leading-relaxed text-text-secondary">{description}</p>}
    </div>
  );
}
