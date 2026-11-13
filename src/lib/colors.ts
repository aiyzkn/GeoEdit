export const ROUTE_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
]

export function routeColor(routeColor: string | undefined, idx: number): string {
  return routeColor ?? ROUTE_COLORS[idx % ROUTE_COLORS.length]
}
