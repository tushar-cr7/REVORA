import React from 'react';
import Image from 'next/image';

type LogoVariant = 'primary' | 'mark' | 'wordmark' | 'monochrome';
type LogoTheme = 'dark' | 'light' | 'black' | 'white';

interface RevoraLogoProps {
  variant?: LogoVariant;
  theme?: LogoTheme;
  className?: string;
  width?: number;
  height?: number;
}

export const RevoraLogo: React.FC<RevoraLogoProps> = ({
  variant = 'primary',
  theme = 'dark',
  className = '',
  width,
  height,
}) => {
  let src = '';

  if (variant === 'primary') {
    src = theme === 'light' ? '/brand/revora-primary-light-transparent.png' : '/brand/revora-primary-dark-transparent.png';
  } else if (variant === 'mark') {
    src = '/brand/revora-mark-transparent.png';
  } else if (variant === 'wordmark') {
    src = theme === 'light' ? '/brand/revora-wordmark-light-transparent.png' : '/brand/revora-wordmark-dark-transparent.png';
  } else if (variant === 'monochrome') {
    src = theme === 'white' ? '/brand/revora-monochrome-white.png' : '/brand/revora-monochrome-black.png';
  }

  // Sensible default sizes that maintain roughly the correct aspect ratio
  const defaultSizes = {
    primary: { width: 140, height: 40 },
    mark: { width: 32, height: 32 },
    wordmark: { width: 120, height: 24 },
    monochrome: { width: 140, height: 40 },
  };

  const w = width || defaultSizes[variant].width;
  const h = height || defaultSizes[variant].height;

  return (
    <div 
      className={`relative flex items-center justify-center shrink-0 ${className}`} 
      style={{ width: w, height: h }}
    >
      <Image
        src={src}
        alt={`REVORA ${variant} logo`}
        fill
        className="object-contain"
        priority
      />
    </div>
  );
};
