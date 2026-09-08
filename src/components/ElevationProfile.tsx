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
    // Con un vertice ogni 5 m le bande diventerebbero un codice a barre: si aggregano.
    const target = 120
    const group = Math.max(1, Math.ceil((track.points.length - 1) / target))
    const bands = []
    for (let i = 0; i < track.points.length - 1; i += group) {
      const point = track.points[i]
      const next = track.points[Math.min(track.points.length - 1, i + group)]
      bands.push({
        d: `M${toX(point.s)} 100L${toX(point.s)} ${toY(point.elevation)}L${toX(next.s)} ${toY(next.elevation)}L${toX(next.s)} 100Z`,
        // Pendenza già filtrata sui 100 m: riderivarla qui rifarebbe le strisce.
        tone: gradeTone((point.grade + next.grade) / 2),
      })
    }
    return bands
  }, [track])

  const here = sampleTrack(track, meters)
  const x = (normaliseDistance(track, meters) / track.lengthMeters) * 100
  const flat = track.maxElevation - track.minElevation < 150

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
