'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { motion, useReducedMotion } from 'framer-motion';
import { RevoraLogo } from '@/components/brand/RevoraLogo';
import { useRouteTransition } from '@/lib/transition-context';
import {
  IRIS_DELAY,
  IRIS_DURATION,
  SHARD_BASE_DELAY,
  SHARD_STAGGER,
  SHARD_DURATION,
  SHARD_LOCK_T,
  WORDMARK_LIGHT_AT,
  WORDMARK_CROSSFADE_AT,
  WORDMARK_CROSSFADE_DURATION,
  PULSE_AT,
  BREATH_DELAY,
  MARK_EXIT_DURATION,
  FIELD_EXIT_DURATION,
  EXIT_UNMOUNT_BUFFER_MS,
  EASE_ARRIVE,
  EASE_CLOSE,
} from '@/lib/transition-timing';

const MARK_SIZE = 92;

/**
 * REVORA's signature entry — "The Resolve."
 *
 * REVORA's job is to take revenue that has scattered — a declined card, an
 * abandoned checkout, an overdue invoice — and bring it back under one
 * controlled system. The transition enacts that idea directly instead of
 * illustrating it:
 *
 * The REVORA mark itself — already built from distinct angular facets in
 * the real brand asset — separates into four pieces and locks back into
 * place at the center of the screen. At the exact moment it resolves, the
 * environment around it finishes closing from light to navy: an iris of
 * darkness contracts in from the edges of the viewport toward that same
 * center point, so the landing page stays visible and legible for most of
 * the sequence and is consumed from the outside in, not switched off. The
 * mark is the last thing standing in the light, then the system closes
 * around it. Identity (the wordmark) resolves only once the environment
 * has committed to dark, exactly as the two would naturally need to align
 * for legibility.
 *
 * Mounted once in the root layout so it survives the swap between the
 * (marketing) and (dashboard) route groups. Purely decorative
 * (pointer-events-none) — never blocks interaction, and never goes still:
 * if the actual route is slow, a barely-there breathing loop signals
 * "standing by" rather than freezing.
 *
 * Deliberately NOT gated by AnimatePresence's mount/unmount: if the whole
 * subtree were removed from the render tree the instant `active` goes
 * false, children like MarkResolve would be frozen at their last props
 * (`active: true`) and could never react to the release — their own
 * fade-out would simply never run. Instead the component stays mounted
 * for a short buffer after release so `active: false` actually propagates
 * down and each piece can play its own exit at its own pace.
 */
export function RouteTransitionOverlay() {
  const { active, origin } = useRouteTransition();
  const reduceMotion = useReducedMotion();
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const measure = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    if (active) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), EXIT_UNMOUNT_BUFFER_MS);
    return () => clearTimeout(t);
  }, [active]);

  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  const maxRadius = Math.hypot(cx, cy) + 8;

  if (!mounted || viewport.width === 0) return null;

  return (
    <motion.div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[100] overflow-hidden pointer-events-none"
      initial={{ opacity: 1 }}
      animate={{ opacity: active ? 1 : 0 }}
      transition={{ duration: reduceMotion ? 0.01 : FIELD_EXIT_DURATION, ease: 'easeIn' }}
    >
      {reduceMotion ? (
        <div className="absolute inset-0 bg-canvas" />
      ) : (
        <>
          {/* The origin spark — a brief flash exactly where the click landed, before attention shifts to center */}
          {origin && <ClickSpark x={origin.x} y={origin.y} />}

          {/* The iris: darkness contracting from the edges toward the mark's position */}
          <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
            <defs>
              <mask id="revora-iris" maskUnits="userSpaceOnUse" x={0} y={0} width={viewport.width} height={viewport.height}>
                <rect x={0} y={0} width={viewport.width} height={viewport.height} fill="white" />
                <motion.circle
                  cx={cx}
                  cy={cy}
                  fill="black"
                  initial={{ r: maxRadius }}
                  animate={{ r: 0 }}
                  transition={{ duration: IRIS_DURATION, delay: IRIS_DELAY, ease: EASE_CLOSE }}
                />
              </mask>
            </defs>
          </svg>
          <div
            className="absolute inset-0 bg-canvas"
            style={{ mask: 'url(#revora-iris)', WebkitMask: 'url(#revora-iris)' } as React.CSSProperties}
          />
        </>
      )}

      <MarkResolve active={active} reduceMotion={!!reduceMotion} />

      <span className="sr-only">Opening Revenue Command</span>
    </motion.div>
  );
}

function ClickSpark({ x, y }: { x: number; y: number }) {
  return (
    <motion.div
      className="absolute rounded-full"
      style={{
        left: x,
        top: y,
        width: 10,
        height: 10,
        marginLeft: -5,
        marginTop: -5,
        background: 'radial-gradient(circle, rgba(143,163,255,0.9) 0%, rgba(139,92,246,0.4) 55%, transparent 75%)',
      }}
      initial={{ opacity: 0.9, scale: 0.6 }}
      animate={{ opacity: 0, scale: 7 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    />
  );
}

const SHARDS = [
  { clip: 'polygon(0% 0%, 100% 0%, 50% 50%)', from: { x: 0, y: -64, rotate: -8 } }, // top
  { clip: 'polygon(100% 0%, 100% 100%, 50% 50%)', from: { x: 64, y: 0, rotate: 8 } }, // right
  { clip: 'polygon(100% 100%, 0% 100%, 50% 50%)', from: { x: 0, y: 64, rotate: -8 } }, // bottom
  { clip: 'polygon(0% 100%, 0% 0%, 50% 50%)', from: { x: -64, y: 0, rotate: 8 } }, // left
];

function MarkResolve({ active, reduceMotion }: { active: boolean; reduceMotion: boolean }) {
  const body = (
    <div className="flex flex-col items-center justify-center gap-3">
      <div className="relative" style={{ width: MARK_SIZE, height: MARK_SIZE }}>
        {reduceMotion ? (
          <Image src="/brand/revora-mark-transparent.png" alt="" fill className="object-contain" priority />
        ) : (
          SHARDS.map((s, i) => (
            <motion.div
              key={i}
              className="absolute inset-0"
              style={{ clipPath: s.clip }}
              initial={{ x: s.from.x, y: s.from.y, rotate: s.from.rotate, opacity: 0, scale: 0.86 }}
              animate={{ x: 0, y: 0, rotate: 0, opacity: 1, scale: 1 }}
              transition={{
                duration: SHARD_DURATION,
                delay: SHARD_BASE_DELAY + i * SHARD_STAGGER,
                ease: EASE_ARRIVE,
              }}
            >
              <Image src="/brand/revora-mark-transparent.png" alt="" fill className="object-contain" priority />
            </motion.div>
          ))
        )}
      </div>

      <motion.div
        className="relative"
        style={{ width: 132, height: 30 }}
        initial={reduceMotion ? undefined : { opacity: 0, y: 4 }}
        animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay: WORDMARK_LIGHT_AT, ease: EASE_ARRIVE }}
      >
        <motion.div
          className="absolute inset-0"
          initial={{ opacity: reduceMotion ? 0 : 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: WORDMARK_CROSSFADE_DURATION, delay: WORDMARK_CROSSFADE_AT }}
        >
          <RevoraLogo variant="wordmark" theme="light" width={132} height={30} />
        </motion.div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: WORDMARK_CROSSFADE_DURATION, delay: WORDMARK_CROSSFADE_AT }}
        >
          <RevoraLogo variant="wordmark" theme="dark" width={132} height={30} />
        </motion.div>
      </motion.div>
    </div>
  );

  // The mark's own visibility is driven directly by `active`, not by a fixed
  // delay: it only ever starts fading once release has genuinely happened
  // (the provider only flips `active` false once the route has committed),
  // and it fades faster than the field below so it's fully gone before the
  // field becomes transparent enough to reveal the dashboard underneath —
  // otherwise the resolved mark visibly ghosts over live content as it fades.
  const visibility = (
    <motion.div
      animate={{ opacity: active ? 1 : 0 }}
      transition={{ duration: active ? 0.01 : reduceMotion ? 0.01 : MARK_EXIT_DURATION, ease: 'easeIn' }}
    >
      {reduceMotion ? (
        body
      ) : (
        <motion.div
          initial={{ scale: 1 }}
          animate={{ scale: [1, 1.032, 1] }}
          transition={{ duration: 0.32, delay: PULSE_AT, ease: 'easeOut' }}
        >
          <motion.div
            animate={{ scale: [1, 1.008, 1] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut', delay: BREATH_DELAY }}
          >
            {body}
          </motion.div>
        </motion.div>
      )}
    </motion.div>
  );

  return <div className="absolute inset-0 flex items-center justify-center">{visibility}</div>;
}
