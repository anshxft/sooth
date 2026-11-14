// The swarm: a ribbon of worker agents flows across the frame like a murmuration, and now and then
// a small network forms in its middle (a job being won), its nodes lit by the accent, then fades.
// One Points cloud with positions updated in place each frame; no allocation per frame.
import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { SceneProps } from '../scene'

const COUNT = 1400
const NETWORK_CYCLE = 9 // seconds
const ACCENT = '#ff4f2b'
const STILL_TIME = 4.5 // reduced motion: network fully formed

/** A soft round sprite, drawn once, so points read as small lights rather than squares. */
function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.8)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

function networkLevel(t: number): number {
  const c = t % NETWORK_CYCLE
  const rise = Math.min(1, Math.max(0, (c - 2) / 1.6))
  const fall = Math.min(1, Math.max(0, (c - 6.2) / 1.6))
  return rise * (1 - fall)
}

function Swarm({ isDark, isReduced, isFramed }: { isDark: boolean; isReduced: boolean; isFramed: boolean }) {
  const span = isFramed ? 4.6 : 13 // world units across; framed, it stays between the side texts
  const lift = isFramed ? 0.7 : 1 // and waves a little less
  const points = useRef<THREE.Points>(null)
  const net = useRef<THREE.Group>(null)
  const lines = useRef<THREE.LineBasicMaterial>(null)
  const nodeMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0 }), [])
  const sprite = useMemo(dotTexture, [])
  const seeds = useMemo(() => {
    const s = new Float32Array(COUNT * 4)
    for (let i = 0; i < COUNT; i++) {
      s[i * 4] = Math.random() // where along the ribbon
      s[i * 4 + 1] = (Math.random() - 0.5) * 2 // spread across it
      s[i * 4 + 2] = (Math.random() - 0.5) * 2 // depth
      s[i * 4 + 3] = 0.6 + Math.random() * 0.8 // own speed
    }
    return s
  }, [])
  const positions = useMemo(() => new Float32Array(COUNT * 3), [])
  const network = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(1.15, 0)
    return { edges: new THREE.EdgesGeometry(geo), vertices: geo.getAttribute('position') }
  }, [])
  const nodePositions = useMemo(() => {
    const seen = new Set<string>()
    const out: THREE.Vector3[] = []
    for (let i = 0; i < network.vertices.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(network.vertices, i)
      const key = v.toArray().map((n) => n.toFixed(3)).join()
      if (!seen.has(key)) { seen.add(key); out.push(v) }
    }
    return out
  }, [network])

  useFrame((state) => {
    const t = isReduced ? STILL_TIME : state.clock.elapsedTime
    for (let i = 0; i < COUNT; i++) {
      const u = (seeds[i * 4] + t * 0.018 * seeds[i * 4 + 3]) % 1
      const across = seeds[i * 4 + 1]
      const depth = seeds[i * 4 + 2]
      const x = (u - 0.5) * span
      const wave = (Math.sin(u * Math.PI * 3 + t * 0.35) * 1.1 + Math.sin(u * Math.PI * 7 - t * 0.5) * 0.25) * lift
      const width = 0.35 + 0.45 * Math.sin(u * Math.PI) // thicker in the middle, thin at the ends
      positions[i * 3] = x
      positions[i * 3 + 1] = wave + across * width + Math.sin(t * 0.9 + i) * 0.02
      positions[i * 3 + 2] = depth * width * 1.2
    }
    const geo = points.current?.geometry
    if (geo) geo.getAttribute('position').needsUpdate = true

    const level = networkLevel(t)
    if (lines.current) lines.current.opacity = level * (isDark ? 0.55 : 0.45)
    nodeMaterial.opacity = level
    if (net.current) {
      net.current.rotation.y = t * 0.25
      net.current.rotation.x = 0.4 + Math.sin(t * 0.2) * 0.1
      net.current.scale.setScalar(0.85 + level * 0.15)
    }
  })

  const ink = isDark ? '#eceae4' : '#0c0c0b'
  return (
    <>
      <points ref={points}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.075}
          map={sprite}
          color={ink}
          transparent
          opacity={isDark ? 0.95 : 0.8}
          depthWrite={false}
          blending={isDark ? THREE.AdditiveBlending : THREE.NormalBlending}
          sizeAttenuation
        />
      </points>
      <group ref={net}>
        <lineSegments geometry={network.edges}>
          <lineBasicMaterial ref={lines} color={ink} transparent opacity={0} />
        </lineSegments>
        {nodePositions.map((p) => (
          <mesh key={p.toArray().join()} position={p} material={nodeMaterial}>
            <sphereGeometry args={[0.05, 16, 16]} />
          </mesh>
        ))}
      </group>
    </>
  )
}

export default function Flock({ isLive, isDark, isReduced, isFramed = false }: SceneProps) {
  return (
    <Canvas
      frameloop={isLive ? 'always' : 'demand'}
      dpr={[1, 1.75]}
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0, 8.5], fov: 40 }}
      style={{ background: 'transparent' }}
    >
      <Swarm isDark={isDark} isReduced={isReduced} isFramed={isFramed} />
    </Canvas>
  )
}
