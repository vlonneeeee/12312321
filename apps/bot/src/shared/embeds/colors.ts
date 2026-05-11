export const Colors = {
  primary: 0x5865f2,
  success: 0x57f287,
  warning: 0xfee75c,
  danger: 0xed4245,
  neutral: 0x2b2d31,
  premium: 0xff73fa,
  music: 0x1db954,
  economy: 0xf1c40f,
  moderation: 0xed4245,
  level: 0x3498db,
} as const;

export type ColorKey = keyof typeof Colors;
