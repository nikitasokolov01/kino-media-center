import type React from "react";
// Inline SVG icon components for the embedded player controls.
// All icons use currentColor, 24x24 viewBox, Feather-style stroke geometry.
// Pass size (default 16) and className as needed.

interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

const Svg = ({
  size = 16,
  className = "",
  style,
  children,
}: IconProps & { children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={style}
    aria-hidden="true"
  >
    {children}
  </svg>
);

/** Filled triangle play */
export function PlayIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Two vertical bars */
export function PauseIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Filled square stop */
export function StopIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Two triangles pointing right (skip forward / next episode) */
export function SkipForwardIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <polygon points="5 4 15 12 5 20 5 4" fill="currentColor" stroke="none" />
      <line x1="19" y1="4" x2="19" y2="20" strokeWidth={2.5} />
    </Svg>
  );
}

/** Speaker with two sound waves */
export function VolumeHighIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </Svg>
  );
}

/** Speaker with one sound wave */
export function VolumeMidIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </Svg>
  );
}

/** Speaker crossed out */
export function VolumeMuteIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </Svg>
  );
}

/** Subtitle / CC icon (rectangle with text lines) */
export function SubtitlesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2" y="7" width="20" height="13" rx="2" />
      <line x1="6" y1="12" x2="11" y2="12" />
      <line x1="14" y1="12" x2="18" y2="12" />
      <line x1="6" y1="16" x2="9" y2="16" />
      <line x1="12" y1="16" x2="18" y2="16" />
    </Svg>
  );
}

/** Headphones for audio track selection */
export function HeadphonesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" />
      <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </Svg>
  );
}

/** Sliders icon for source/settings */
export function SlidersIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </Svg>
  );
}

/** Expand corners (enter fullscreen) */
export function MaximizeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </Svg>
  );
}

/** Contract corners (exit fullscreen) */
export function MinimizeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="10" y1="14" x2="3" y2="21" />
      <line x1="21" y1="3" x2="14" y2="10" />
    </Svg>
  );
}

/** X close icon */
export function XIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </Svg>
  );
}

/** Info circle */
export function InfoIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="8" strokeWidth={3} />
      <line x1="12" y1="12" x2="12" y2="16" />
    </Svg>
  );
}

/** Retry / rotate CCW */
export function RetryIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 .49-4.9" />
    </Svg>
  );
}
