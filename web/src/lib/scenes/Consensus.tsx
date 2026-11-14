// "Many agents, one truth": five pearl agents orbit on tilted paths, then glide into one line and
// the middle one lights up with the accent, then they part again. Studio light is built from
// Lightformers, so nothing is downloaded. Motion is time-based, so it is the same at any frame rate.
import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import * as THREE from 'three'
import type { SceneProps } from '../scene'

const AGENTS = 5
const CYCLE = 11 // seconds: orbit, gather, hold, part
const ACCENT = new THREE.Color('#ff4f2b')

const smooth = (x: number) => x * x * x * (x * (x * 6 - 15) + 10) // smootherstep: no jerk at either end
/** 0 while orbiting, 1 while in line. */
function gathered(t: number): number {
  const c = t % CYCLE
  if (c < 6) return 0
  if (c < 7.6) return smooth((c - 6) / 1.6)
  if (c < 9.2) return 1
  return 1 - smooth((c - 9.2) / 1.8)
}
const STILL_TIME = 8.4 // reduced motion: the aligned moment

function Agents({ isDark, isReduced }: { isDark: boolean; isReduced: boolean }) {
  const group = useRef<THREE.Group>(null)
  const spheres = useRef<(THREE.Mesh | null)[]>([])
  const core = useRef<THREE.MeshStandardMaterial>(null)
  const glow = useRef<THREE.PointLight>(null)
  const pointer = useThree((s) => s.pointer)
  const pearl = useMemo(
    () => new THREE.MeshPhysicalMaterial({
      color: isDark ? '#eceae4' : '#d9d6cc',
      roughness: 0.32,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      sheen: 0.6,
      sheenColor: new THREE.Color('#ffffff'),
    }),
    [isDark],
  )
  // The middle agent is the answer: same pearl, plus an accent glow that rises as the line forms.
  const answer = useMemo(() => {
    const m = pearl.clone()
    m.emissive = ACCENT.clone()
    m.emissiveIntensity = 0
    return m
  }, [pearl])
  const orbit = useMemo(
    () => Array.from({ length: AGENTS }, (_, i) => ({
      radius: 2.0 + (i % 3) * 0.32,
      speed: 0.32 + i * 0.045,
      phase: (i / AGENTS) * Math.PI * 2,
      tilt: (i - 2) * 0.16,
    })),
    [],
  )

  useFrame((state, dt) => {
    const t = isReduced ? STILL_TIME : state.clock.elapsedTime
    const g = gathered(t)
    orbit.forEach((o, i) => {
      const m = spheres.current[i]
      if (!m) return
      const a = t * o.speed + o.phase
      const ox = Math.cos(a) * o.radius
      const oy = Math.sin(a) * o.radius * 0.28 + Math.sin(a * 2) * o.tilt
      const oz = Math.sin(a) * o.radius * 0.55
      const lx = (i - (AGENTS - 1) / 2) * 1.12
      m.position.set(THREE.MathUtils.lerp(ox, lx, g), THREE.MathUtils.lerp(oy, 0, g), THREE.MathUtils.lerp(oz, 0, g))
      m.scale.setScalar(0.42 + (i === 2 ? g * 0.06 : 0))
    })
    answer.emissiveIntensity = g * 0.55
    if (core.current) core.current.emissiveIntensity = g * 3.2
    if (glow.current) glow.current.intensity = g * 6
    if (group.current && !isReduced) {
      // Follows the pointer a little, eased, like the object noticing you.
      group.current.rotation.y = THREE.MathUtils.damp(group.current.rotation.y, pointer.x * 0.25, 3, dt)
      group.current.rotation.x = THREE.MathUtils.damp(group.current.rotation.x, -pointer.y * 0.12 + 0.08, 3, dt)
    }
  })

  return (
    <group ref={group}>
      {orbit.map((o, i) => (
        <mesh key={o.phase} ref={(m) => { spheres.current[i] = m }} material={i === 2 ? answer : pearl}>
          <sphereGeometry args={[1, 64, 64]} />
          {i === 2 && (
            <mesh scale={0.55}>
              <sphereGeometry args={[1, 32, 32]} />
              <meshStandardMaterial ref={core} color={ACCENT} emissive={ACCENT} emissiveIntensity={0} transparent opacity={0.85} />
              <pointLight ref={glow} color={ACCENT} intensity={0} distance={4} decay={2} />
            </mesh>
          )}
        </mesh>
      ))}
      {[0, 1, 2].map((r) => (
        <mesh key={r} rotation={[Math.PI / 2 + 0.28 + r * 0.05, 0, r * 0.4]}>
          <torusGeometry args={[2.0 + r * 0.32, 0.004, 8, 200]} />
          <meshBasicMaterial color={isDark ? '#eceae4' : '#0c0c0b'} transparent opacity={0.12} />
        </mesh>
      ))}
    </group>
  )
}

export default function Consensus({ isLive, isDark, isReduced }: SceneProps) {
  return (
    <Canvas
      frameloop={isLive ? 'always' : 'demand'}
      dpr={[1, 1.75]}
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0.6, 7.2], fov: 34 }}
      style={{ background: 'transparent' }}
    >
      <ambientLight intensity={isDark ? 0.25 : 0.55} />
      <directionalLight position={[3, 5, 4]} intensity={isDark ? 1.4 : 1.1} />
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={2.4} color="#ffffff" position={[0, 5, -2]} scale={[10, 2, 1]} rotation-x={Math.PI / 2} />
        <Lightformer form="rect" intensity={1.2} color="#ffffff" position={[-5, 1, 1]} scale={[3, 6, 1]} rotation-y={Math.PI / 2} />
        <Lightformer form="rect" intensity={0.8} color="#ffd9cf" position={[5, 0, 2]} scale={[3, 6, 1]} rotation-y={-Math.PI / 2} />
      </Environment>
      <Agents isDark={isDark} isReduced={isReduced} />
    </Canvas>
  )
}
