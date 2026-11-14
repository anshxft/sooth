// First visit in a session: the hero mark spins in and the first lines of text rise with it.
// Read once per page load by both the mark (Mark.tsx) and the text (pages/Hero.tsx).
export const playsEntry = (() => {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || sessionStorage.getItem('sooth-entry')) return false
    sessionStorage.setItem('sooth-entry', '1')
  } catch {
    // storage blocked: play it on this load
  }
  return true
})()
