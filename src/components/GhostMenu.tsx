import { useEffect, useRef, useState } from "react"
import type { GhostChoice, VehicleProfile } from "../types"
import { vehicles } from "../logic/challenges"

/**
 * Mini menù per scegliere chi corre accanto. Parte da "nessuno": il ghost
 * è un confronto che si chiede, non qualcosa che compare da solo.
 */
export function GhostMenu({
  choice,
  onChange,
  bestLabel,
  vehicle,
}: {
  choice: GhostChoice
  onChange: (choice: GhostChoice) => void
  /** Nome del record sul tracciato, assente se non ne esiste ancora uno. */
  bestLabel?: string
  vehicle: VehicleProfile
}) {
  const [open, setOpen] = useState(false)
  const holder = useRef<HTMLDivElement>(null)

  // Un tocco fuori chiude il menù: sul manubrio non si prende la mira.
  useEffect(() => {
    if (!open) return
    const close = (event: Event) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", close)
    return () => document.removeEventListener("pointerdown", close)
  }, [open])

  const options: { id: GhostChoice; label: string; note: string }[] = [
    { id: "none", label: "NESSUNO", note: "corri da solo" },
    ...(Object.keys(vehicles) as VehicleProfile[]).map((id) => ({
      id: id as GhostChoice,
      label: vehicles[id].label,
      note: id === vehicle ? "stessi watt · stesso mezzo" : "stessi watt",
    })),
    ...(bestLabel ? [{ id: "best" as GhostChoice, label: "RECORD", note: bestLabel }] : []),
  ]
  const current = options.find((o) => o.id === choice) ?? options[0]

  return (
    <div className="ghost-menu" ref={holder}>
      <button className={choice === "none" ? "" : "armed"} onClick={() => setOpen(!open)} aria-expanded={open}>
        <b>◑ GHOST</b>
        <span>{current.label}</span>
      </button>
      {open && (
        <ul>
          {options.map((option) => (
            <li key={option.id}>
              <button
                className={option.id === choice ? "chosen" : ""}
                onClick={() => {
                  onChange(option.id)
                  setOpen(false)
                }}
              >
                <b>{option.label}</b>
                <small>{option.note}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
