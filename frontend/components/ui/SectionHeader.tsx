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
    sm: 'text-base',
    md: 'text-lg',
    lg: 'text-xl font-display',
  };

  const iconSizes = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  };

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center gap-2">
        {Icon && <Icon className={`${iconSizes[size]} text-primary-500`} />}
        <h2 className={`${titleSizes[size]} font-medium text-text-primary`}>{title}</h2>
      </div>
      {description && <p className="text-sm text-text-secondary">{description}</p>}
    </div>
  );
}
