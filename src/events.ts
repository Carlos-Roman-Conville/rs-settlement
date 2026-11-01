// Events the reducer returns. The host folds them; the engine never pushes.

export type SettlementEvent =
  | { type: 'postFilled'; post: string; holder: string; wage: number; cause?: string }
  | { type: 'shared.action.outcome'; cause: string; status: 'completed'; stimuli: { post: string; holder: string; wage: number }[]; payload: { type: 'postFilled'; post: string; holder: string; wage: number; cause?: string } }
  | { type: 'titleChanged'; title: string; subject: string; from: string; to: string; txn: string }
  | { type: 'leaseChanged'; lease: string; title: string; tenant: string; status: 'active' | 'ended' }
  | { type: 'operatorChanged'; biz: string; from: string; to: string }
  | { type: 'managerChanged'; biz: string; from: string | null; to: string | null }
  | { type: 'businessStatusChanged'; biz: string; from: string; to: string }
  | { type: 'projectCompleted'; project: string; kind: string; target: string; result: string | null }
  | { type: 'fixtureChanged'; bldg: string; fixtures: string[] }
  | { type: 'wagePaid'; post: string; to: string; amount: number }
  | { type: 'rentPaid'; lease: string; to: string; amount: number }
  | { type: 'officeChanged'; office: string; holder: string | null }
  | { type: 'permissionChanged'; permission: string; status: string }
  | { type: 'parcelSplit'; parent: string; children: string[] }
  | { type: 'parcelMerged'; parcels: string[]; result: string }
