export type CallPerson = {
  id: string
  name: string
  role: "房主" | "主播" | "观众"
  status: "pending" | "accepted" | "joined" | "rejected" | "ended" | "expired"
  muted: boolean
  expiresAt: number
}
export type CallSnapshot = {
  enabled: boolean
  source: "live" | "browser"
  sourceMode: "auto" | "live" | "browser"
  input: { ready: boolean; sourceId?: string }
  capacity: number
  participants: CallPerson[]
  pending?: CallPerson[]
  self?: CallPerson
  mix: {
    url?: string
    state: "idle" | "starting" | "ready" | "error"
    message?: string
  }
}
