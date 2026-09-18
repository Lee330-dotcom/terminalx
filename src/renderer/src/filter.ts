export type ConnectionFilter =
  | { kind: 'all' }
  | { kind: 'favorite' }
  | { kind: 'recent' }
  | { kind: 'frequent' }
  | { kind: 'group'; groupId: string }
