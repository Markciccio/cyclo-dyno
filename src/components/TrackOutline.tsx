import { useMemo } from "react"
import type { Track } from "../logic/tracks"
import { sampleTrack } from "../logic/tracks"

/**
 * Sagoma del tracciato vista dall'alto con il puntino della posizione,
 * come il riquadro in alto a sinistra del cruscotto.
 */
export function TrackOutline({ track, meters, title, subtitle }: { track: Track; meters: number; title: string; subtitle?: string }) {
  const shape = useMemo(() => {
    const xs = track.points.map((p) => p.x)
    const ys = track.points.map((p) => p.y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const width = Math.max(1, Math.max(...xs) - minX)
    const height = Math.max(1, Math.max(...ys) - minY)
    const scale = 100 / Math.max(width, height)
    // Il nord deve stare in alto: in SVG la y cresce verso il basso, quindi si specchia.
    const project = (x: number, y: number) => [
      (x - minX) * scale + (100 - width * scale) / 2,
      100 - ((y - minY) * scale + (100 - height * scale) / 2),
    ]
    return {
      project,
      path: track.points.map((p, i) => `${i ? "L" : "M"}${project(p.x, p.y).map((v) => v.toFixed(1)).join(" ")}`).join("") + (track.closed ? "Z" : ""),
    }
  }, [track])

  const here = sampleTrack(track, meters)
  const [cx, cy] = shape.project(here.x, here.y)
  const [sx, sy] = shape.project(track.points[0].x, track.points[0].y)

  return (
    <div className="track-outline">
      <div className="track-outline-head">
        <small>{subtitle}</small>
        <b>{title}</b>
      </div>
      <svg viewBox="-6 -6 112 112" aria-hidden="true">
        <path d={shape.path} className="outline-road" />
        <circle cx={sx} cy={sy} r="3" className="outline-start" />
        <circle cx={cx} cy={cy} r="4.5" className="outline-here" />
      </svg>
      <dl>
        <div>
          <dt>{track.closed ? "Lunghezza giro" : "Lunghezza"}</dt>
          <dd>{(track.lengthMeters / 1000).toFixed(3).replace(".", ",")} km</dd>
        </div>
        <div>
          <dt>{track.totalClimb > 150 ? "Dislivello" : "Curve"}</dt>
          <dd>{track.totalClimb > 150 ? `${Math.round(track.totalClimb)} m` : countCorners(track)}</dd>
        </div>
      </dl>
    </div>
  )
}

/** Un tornante conta una volta sola: si contano i gruppi di punti stretti, non i punti. */
function countCorners(track: Track) {
  let corners = 0
  let inside = false
  for (const point of track.points) {
    const tight = point.radius < 250
    if (tight && !inside) corners++
    inside = tight
  }
  return corners
}
