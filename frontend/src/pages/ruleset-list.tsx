import { useEffect, useState } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { useAppContext } from '@/context'
import { listRulesets, type RulesetSummary } from '@/lib/api/rules-api'
import { FlaskConical } from 'lucide-react'

export function RulesetListPage() {
  const [rulesets, setRulesets] = useState<RulesetSummary[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const { openTab } = useAppContext()

  useEffect(() => {
    listRulesets()
      .then((data) => setRulesets(data))
      .catch((err) => console.error('Failed to load rulesets:', err))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Rulesets</h1>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : rulesets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rulesets available.</p>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {rulesets.map((r) => (
            <button
              key={r.id}
              className="text-left rounded-lg border bg-card p-4 hover:border-foreground/30 hover:shadow-sm transition-all"
              onClick={() => {
                openTab(r.id, r.name)
                navigate({
                  to: '/ruleset/$rulesetId',
                  params: { rulesetId: r.id },
                })
              }}
            >
              <h2 className="font-medium text-sm truncate">{r.name}</h2>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-xs text-muted-foreground">
                  {r.format === 'rac' ? 'Rules as Code' : 'Fact Graph'}
                </p>
                {r.format === 'factGraph' && (
                  <Link
                    to="/simulate/$rulesetId"
                    params={{ rulesetId: r.id }}
                    className="text-[10px] text-blue-600 hover:underline flex items-center gap-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <FlaskConical className="size-2.5" />
                    Simulate
                  </Link>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
