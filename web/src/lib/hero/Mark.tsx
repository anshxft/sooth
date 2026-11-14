// The SOOTH aperture, extruded into a solid and driven by scroll. Four states blend as the page
// scrolls: solid (intro), blueprint wireframe on a construction grid (commit: sealed), aperture
// open (reveal), accent core lit (settle), then solid again. `drive.current` holds the scroll
// progress 0..1; the scene eases toward it every frame, so scrubbing stays smooth.
import { useMemo, useRef, type MutableRefObject } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import * as THREE from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import { playsEntry } from './entry'

// brand/mark-ink.svg: six blades around a hexagonal opening, 60 degrees apart.
export const BLADES = [
  'M19.32 -6.54 L57.90 15.74 A60.0 60.0 0 0 1 19.32 56.80 Z',
  'M15.32 13.46 L15.32 58.01 A60.0 60.0 0 0 1 -39.53 45.13 Z',
  'M-4.00 20.00 L-42.58 42.27 A60.0 60.0 0 0 1 -58.85 -11.67 Z',
  'M-19.32 6.54 L-57.90 -15.74 A60.0 60.0 0 0 1 -19.32 -56.80 Z',
  'M-15.32 -13.46 L-15.32 -58.01 A60.0 60.0 0 0 1 39.53 -45.13 Z',
  'M4.00 -20.00 L42.58 -42.27 A60.0 60.0 0 0 1 58.85 11.67 Z',
]
const ACCENT = new THREE.Color('#ff4f2b')
const UNIT = 1 / 40 // svg units to world units
const CHAPTERS = 5 // must match pages/Hero.tsx

/** 0 outside [a, d], 1 inside [b, c], smooth ramps between. */
function band(p: number, a: number, b: number, c: number, d: number): number {
  const s = (x: number) => x * x * (3 - 2 * x)
  if (p <= a || p >= d) return 0
  if (p < b) return s((p - a) / (b - a))
  if (p > c) return 1 - s((p - c) / (d - c))
  return 1
}

type Drive = MutableRefObject<number>

// First visit in a session: the mark spins in from far away and settles where it rests, so the
// page opens on the logo itself instead of a separate splash. Reduced motion skips it.
const ENTRY_SECONDS = 2.4
// Phones: how far the mark moves down (text above) or up (text below) to stay clear of the words.
const NARROW_Y = -1.8
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 4)

function Aperture({ drive, isDark, isReduced }: { drive: Drive; isDark: boolean; isReduced: boolean }) {
  const group = useRef<THREE.Group>(null)
  const blades = useRef<(THREE.Group | null)[]>([])
  const eased = useRef(drive.current)
  const grid = useRef<THREE.Group>(null)
  const glow = useRef<THREE.PointLight>(null)
  const entryStart = useRef<number | null>(null)
  const restX = useRef(0)
  const restY = useRef(0)

  const parts = useMemo(() => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">${BLADES.map((d) => `<path d="${d}"/>`).join('')}</svg>`
    return new SVGLoader().parse(svg).paths.map((path) => {
      const shapes = SVGLoader.createShapes(path)
      const geo = new THREE.ExtrudeGeometry(shapes, { depth: 12, bevelEnabled: true, bevelThickness: 1.4, bevelSize: 1.1, bevelSegments: 3, curveSegments: 24 })
      geo.translate(0, 0, -6)
      geo.computeBoundingBox()
      const c = new THREE.Vector3()
      geo.boundingBox!.getCenter(c)
      return { geo, edges: new THREE.EdgesGeometry(geo, 20), out: new THREE.Vector3(c.x, c.y, 0).normalize() }
    })
  }, [])

  const solid = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: isDark ? '#eceae4' : '#141413',
    roughness: isDark ? 0.34 : 0.5,
    metalness: 0,
    clearcoat: isDark ? 1 : 0.4,
    clearcoatRoughness: 0.12,
    transparent: true,
  }), [isDark])
  const lines = useMemo(() => new THREE.LineBasicMaterial({ color: isDark ? '#eceae4' : '#0c0c0b', transparent: true, opacity: 0 }), [isDark])
  const core = useMemo(() => new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0 }), [])
  const gridMaterial = useMemo(() => new THREE.LineBasicMaterial({ color: isDark ? '#eceae4' : '#0c0c0b', transparent: true, opacity: 0.08 }), [isDark])

  const gridLines = useMemo(() => {
    const pts: number[] = []
    for (let i = -10; i <= 10; i++) pts.push(i * 0.5, -5, 0, i * 0.5, 5, 0, -5, i * 0.5, 0, 5, i * 0.5, 0)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return geo
  }, [])
  const ring = useMemo(() => {
    const curve = new THREE.EllipseCurve(0, 0, 2.3, 2.3)
    return new THREE.BufferGeometry().setFromPoints(curve.getPoints(128))
  }, [])

  useFrame((state, dt) => {
    eased.current = isReduced ? drive.current : THREE.MathUtils.damp(eased.current, drive.current, 5, dt)
    const p = eased.current
    const wire = band(p, 0.14, 0.24, 0.44, 0.54)
    const open = band(p, 0.38, 0.5, 0.66, 0.76)
    const lit = band(p, 0.56, 0.66, 0.84, 0.94)
    const idle = isReduced ? 0 : state.clock.elapsedTime * 0.08

    // Make room for the words: chapters alternate left and right, so the mark leans the other way
    // (+1 while a left chapter shows, -1 for a right one). Narrow screens keep it centred and smaller.
    const isWide = state.size.width / state.size.height > 1.2
    const lean = Math.cos(Math.PI * (Math.max(p * CHAPTERS, 0.5) - 0.5)) // held at +1 until chapter 1 is centred
    // Wide screens: a bigger mark out on the free side, past the words (half-width at z=0 is 3.73·aspect).
    const halfWidth = 3.73 * (state.size.width / state.size.height)
    const x = isWide ? lean * Math.min(halfWidth * 0.42, 3.9) : 0
    const size = isWide ? Math.min(1.45, halfWidth * 0.2) : 0.6
    if (entryStart.current === null) entryStart.current = state.clock.elapsedTime
    const left = playsEntry ? 1 - easeOut((state.clock.elapsedTime - entryStart.current) / ENTRY_SECONDS) : 0 // 1 → 0
    if (group.current) {
      restX.current = THREE.MathUtils.damp(restX.current, x, 4, dt)
      group.current.position.x = restX.current - left * left * 5
      // Phones stack text and mark: words at the top (left chapters) put the mark low, words at the
      // bottom (right chapters) put it high, gliding between them with the scroll.
      restY.current = THREE.MathUtils.damp(restY.current, isWide ? 0 : lean * NARROW_Y, 4, dt)
      group.current.position.y = restY.current + left * left * 2.6
      group.current.position.z = -left * 9
      group.current.rotation.z = -p * Math.PI * 2 - idle + left * Math.PI * 3
      group.current.rotation.x = -0.55 + Math.sin(p * Math.PI) * 0.35 + left * 0.9
      group.current.rotation.y = Math.sin(p * Math.PI * 2) * 0.45 - left * 1.4
      group.current.scale.setScalar(size * (1 + open * 0.06) * (1 - left * 0.5))
    }
    parts.forEach((part, i) => {
      const b = blades.current[i]
      if (!b) return
      // Blades slide out from the centre in svg units (the group is scaled to world size).
      b.position.set(part.out.x * open * 22, part.out.y * open * 22, Math.sin(i * 1.7) * open * 7)
    })
    solid.opacity = (1 - wire * 0.92) * (1 - left * left)
    lines.opacity = wire * 0.9 + open * 0.15
    core.opacity = lit
    gridMaterial.opacity = 0.05 + wire * 0.22
    if (glow.current) glow.current.intensity = lit * 8
    if (grid.current && group.current) {
      grid.current.rotation.z = group.current.rotation.z * 0.25
      grid.current.position.x = restX.current
    }
  })

  return (
    <>
      <group ref={grid} position={[0, 0, -1.5]}>
        <lineSegments geometry={gridLines} material={gridMaterial} />
        <lineLoop geometry={ring} material={gridMaterial} />
      </group>
      <group ref={group}>
        <group scale={[UNIT, -UNIT, UNIT]}>
          {parts.map((part, i) => (
            <group key={i} ref={(g) => { blades.current[i] = g }}>
              <mesh geometry={part.geo} material={solid} />
              <lineSegments geometry={part.edges} material={lines} />
            </group>
          ))}
        </group>
        <mesh material={core} rotation={[0, 0, Math.PI / 6]}>
          <circleGeometry args={[0.5, 6]} />
        </mesh>
        <pointLight ref={glow} color={ACCENT} intensity={0} distance={5} decay={2} position={[0, 0, 0.6]} />
      </group>
    </>
  )
}

export default function Mark({ drive, isDark, isReduced, isLive }: { drive: Drive; isDark: boolean; isReduced: boolean; isLive: boolean }) {
  return (
    <Canvas
      frameloop={isLive ? 'always' : 'demand'}
      dpr={[1, 1.25]} // full-screen canvas: above 1.25 the GPU cost grows fast for no visible gain
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0, 13], fov: 32 }}
      style={{ background: 'transparent' }}
    >
      <ambientLight intensity={isDark ? 0.3 : 0.7} />
      <directionalLight position={[4, 6, 6]} intensity={isDark ? 1.6 : 1.2} />
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={2.6} color="#ffffff" position={[0, 5, 2]} scale={[10, 2, 1]} rotation-x={Math.PI / 2} />
        <Lightformer form="rect" intensity={1.4} color="#ffffff" position={[-6, 0, 2]} scale={[3, 8, 1]} rotation-y={Math.PI / 2} />
        <Lightformer form="rect" intensity={0.9} color="#ffd9cf" position={[6, -1, 2]} scale={[3, 8, 1]} rotation-y={-Math.PI / 2} />
      </Environment>
      <Aperture drive={drive} isDark={isDark} isReduced={isReduced} />
    </Canvas>
  )
}
