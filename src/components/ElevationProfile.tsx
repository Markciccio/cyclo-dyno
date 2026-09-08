import { useMemo } from "react"
import type { Track } from "../logic/tracks"
import { normaliseDistance, sampleTrack } from "../logic/tracks"

/**
 * Profilo altimetrico con la posizione corrente, colorato per pendenza
 * come i profili delle salite: verde in falsopiano, rosso oltre il 10%.
 */
export function ElevationProfile({ track, meters }: { track: Track; meters: number }) {
  const bands = useMemo(() => {
    const low = track.minElevation
    const span = Math.max(1, track.maxElevation - low)
    const toY = (elevation: number) => 100 - ((elevation - low) / span) * 82 - 6
    const toX = (s: number) => (s / track.lengthMeters) * 100
    return track.points.slice(0, -1).map((point, index) => {
      const next = track.points[index + 1]
      return {
        d: `M${toX(point.s)} 100L${toX(point.s)} ${toY(point.elevation)}L${toX(next.s)} ${toY(next.elevation)}L${toX(next.s)} 100Z`,
        tone: gradeTone(point.grade),
      }
    })
  }, [track])

  const here = sampleTrack(track, meters)
  const x = (normaliseDistance(track, meters) / track.lengthMeters) * 100
  const flat = track.maxElevation - track.minElevation < 30

  return (
    <div className="elevation-profile">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {bands.map((band, index) => (
          <path key={index} d={band.d} className={`elev-band elev-${band.tone}`} />
        ))}
        <line x1={x} y1="0" x2={x} y2="100" className="elev-cursor" />
      </svg>
      <span>Quota {Math.round(here.elevation)} m</span>
      {!flat && <b>{Math.round(here.climb)} / {Math.round(track.totalClimb)} m D+</b>}
    </div>
  )
}

function gradeTone(grade: number) {
  const percent = grade * 100
  if (percent < 1) return "flat"
  if (percent < 5) return "easy"
  if (percent < 8) return "mid"
  if (percent < 11) return "hard"
  return "wall"
}
