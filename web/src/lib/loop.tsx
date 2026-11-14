// Looping film band, Apple-style: muted, inline, no controls. It loads and plays only while on
// screen and pauses off screen, so a long page with several films stays light. With reduced motion
// it shows the still poster instead. Files live in public/video/<name>.{webm,mp4,jpg}.
import { useEffect, useRef, useState } from 'react'
import { cn } from './utils'

const NEAR_SCREEN = '200px' // start loading a little before the film scrolls in

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function LoopVideo({ name, className }: { name: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [isReduced] = useState(prefersReducedMotion)

  useEffect(() => {
    const video = ref.current
    if (!video || isReduced) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) video.play().catch(() => undefined) // autoplay refused: the poster stays
        else video.pause()
      },
      { rootMargin: NEAR_SCREEN },
    )
    observer.observe(video)
    return () => observer.disconnect()
  }, [isReduced])

  if (isReduced) {
    return <img src={`/video/${name}.jpg`} alt="" aria-hidden="true" className={cn('block bg-term object-cover', className)} />
  }
  return (
    <video
      ref={ref}
      className={cn('block bg-term object-cover', className)}
      poster={`/video/${name}.jpg`}
      muted
      loop
      playsInline
      preload="none"
      disablePictureInPicture
      aria-hidden="true"
      tabIndex={-1}
    >
      <source src={`/video/${name}.webm`} type="video/webm" />
      <source src={`/video/${name}.mp4`} type="video/mp4" />
    </video>
  )
}

/** A full-width film band inside a blueprint grid. */
export function FilmBand({ name }: { name: string }) {
  return (
    <div className="col-span-12 overflow-hidden bg-term!">
      <LoopVideo name={name} className="aspect-video w-full md:aspect-[21/9]" />
    </div>
  )
}
