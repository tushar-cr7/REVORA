'use client';

import { useEffect } from 'react';
import { motion, useSpring, useTransform, useReducedMotion } from 'framer-motion';

interface AnimatedNumberProps {
  value: number;
  format: (v: number) => string;
  className?: string;
}

/**
 * A number that behaves like money, not like ordinary UI text — it eases
 * toward its new value instead of snapping, so the reader's eye catches the
 * change without a jarring reflow. Used for every headline currency figure.
 */
export function AnimatedNumber({ value, format, className }: AnimatedNumberProps) {
  const reduceMotion = useReducedMotion();
  const spring = useSpring(value, { stiffness: 90, damping: 20, mass: 0.6 });
  const display = useTransform(spring, (v) => format(v));

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  if (reduceMotion) {
    return <span className={className}>{format(value)}</span>;
  }

  return <motion.span className={className}>{display}</motion.span>;
}
