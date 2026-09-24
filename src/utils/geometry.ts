// Small 2D vector and angle helpers. All angles are in degrees.

import type { Vec2 } from '../types';

export const RAD_TO_DEG = 180 / Math.PI;

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function scale(a: Vec2, k: number): Vec2 {
  return { x: a.x * k, y: a.y * k };
}

export function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function length(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** Angle ABC at vertex b, in degrees (0..180). Null for degenerate input. */
export function angleAt(a: Vec2, b: Vec2, c: Vec2): number | null {
  const ba = sub(a, b);
  const bc = sub(c, b);
  const denom = length(ba) * length(bc);
  if (denom < 1e-9) return null;
  const cos = clamp(dot(ba, bc) / denom, -1, 1);
  return Math.acos(cos) * RAD_TO_DEG;
}

/** Angle between two vectors, in degrees (0..180). */
export function angleBetween(u: Vec2, v: Vec2): number | null {
  const denom = length(u) * length(v);
  if (denom < 1e-9) return null;
  return Math.acos(clamp(dot(u, v) / denom, -1, 1)) * RAD_TO_DEG;
}

/**
 * Signed tilt of a vector from "straight up" in image coordinates (y down),
 * degrees. Positive when the vector leans towards +x.
 */
export function tiltFromVertical(v: Vec2): number | null {
  if (length(v) < 1e-9) return null;
  return Math.atan2(v.x, -v.y) * RAD_TO_DEG;
}

/**
 * Rotation of a body segment (shoulder or hip line) away from the image plane
 * direction, estimated from 2D foreshortening. With the camera looking along
 * the baseline, a segment that is square to the net points at the camera and
 * appears short; a segment turned 90 degrees (pointing at the net) appears at
 * full length. turn = asin(projectedWidth / fullWidth), 0..90 degrees.
 * The sign (turned towards / away from the net) is not observable this way,
 * so metrics only use it in phases where the direction is known.
 */
export function foreshorteningAngle(projectedWidth: number, fullWidth: number): number | null {
  if (!(fullWidth > 1e-9) || !Number.isFinite(projectedWidth)) return null;
  return Math.asin(clamp(Math.abs(projectedWidth) / fullWidth, 0, 1)) * RAD_TO_DEG;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
