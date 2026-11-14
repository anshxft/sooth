// Small helpers shared by the SOOTH isometric figures (the kit itself stays a verbatim copy).
import type { Point3 } from './iso-kit'

/** A point moved from `from` to `to` by u (0..1), hopping `hop` units up mid-way. */
export function along(from: Point3, to: Point3, u: number, hop = 0): Point3 {
  return [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u, from[2] + (to[2] - from[2]) * u + Math.sin(u * Math.PI) * hop]
}

export const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3))
