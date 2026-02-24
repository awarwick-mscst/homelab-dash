import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { runAnalysis, getReports, resolveFinding } from '@/api/advisor'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Shield, Play, CheckCircle, AlertTriangle, AlertOctagon, Info } from 'lucide-react'
import type { Severity, AdvisoryReport } from '@/types'

const severityConfig: Record<Severity, { variant: 'destructive' | 'warning' | 'default' | 'secondary' | 'outline'; icon: typeof AlertOctagon; label: string }> = {
  critical: { variant: 'destructive', icon: AlertOctagon, label: 'Critical' },
  high: { variant: 'destructive', icon: AlertTriangle, label: 'High' },
  medium: { variant: 'warning', icon: AlertTriangle, label: 'Medium' },
  low: { variant: 'secondary', icon: Info, label: 'Low' },
  info: { variant: 'outline', icon: Info, label: 'Info' },
}

function ScoreGauge({ score }: { score: number }) {
  const color = score >= 80 ? 'text-green-500' : score >= 50 ? 'text-yellow-500' : 'text-red-500'
  return (
    <div className="flex flex-col items-center">
      <span className={`text-6xl font-bold ${color}`}>{Math.round(score)}</span>
      <span className="text-sm text-muted-foreground mt-1">Security Score</span>
    </div>
  )
}

export default function AdvisorPage() {
  const queryClient = useQueryClient()

  const { data: reports = [] } = useQuery({ queryKey: ['advisor', 'reports'], queryFn: getReports })

  const analyzeMutation = useMutation({
    mutationFn: runAnalysis,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['advisor'] }),
  })

  const resolveMutation = useMutation({
    mutationFn: resolveFinding,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['advisor'] }),
  })

  const latestReport: AdvisoryReport | undefined = reports[0]

  const categories = latestReport
    ? [...new Set(latestReport.findings.map((f) => f.category))]
    : []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Network Advisor</h1>
        <Button onClick={() => analyzeMutation.mutate()} disabled={analyzeMutation.isPending}>
          <Play className="h-4 w-4 mr-2" />
          {analyzeMutation.isPending ? 'Analyzing...' : 'Run Analysis'}
        </Button>
      </div>

      {!latestReport ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No analysis reports yet. Run an analysis to check your network security posture.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Score and summary */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <Card className="md:col-span-2">
              <CardContent className="p-6 flex items-center justify-center">
                <ScoreGauge score={latestReport.overall_score} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-red-500">{latestReport.critical_count + latestReport.high_count}</p>
                <p className="text-sm text-muted-foreground">Critical/High</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-yellow-500">{latestReport.medium_count}</p>
                <p className="text-sm text-muted-foreground">Medium</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-blue-500">{latestReport.low_count + latestReport.info_count}</p>
                <p className="text-sm text-muted-foreground">Low/Info</p>
              </CardContent>
            </Card>
          </div>

          {/* Findings by category */}
          {categories.map((cat) => (
            <div key={cat}>
              <h2 className="text-lg font-semibold mb-3 capitalize">{cat}</h2>
              <div className="space-y-3">
                {latestReport.findings
                  .filter((f) => f.category === cat)
                  .map((finding) => {
                    const config = severityConfig[finding.severity]
                    const Icon = config.icon
                    return (
                      <Card key={finding.id} className={finding.is_resolved ? 'opacity-60' : ''}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <Icon className="h-4 w-4" />
                                <h3 className="font-medium">{finding.title}</h3>
                                <Badge variant={config.variant}>{config.label}</Badge>
                                {finding.is_resolved && (
                                  <Badge variant="success"><CheckCircle className="h-3 w-3 mr-1" />Resolved</Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground mb-2">{finding.description}</p>
                              <p className="text-sm"><strong>Recommendation:</strong> {finding.recommendation}</p>
                            </div>
                            {!finding.is_resolved && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => resolveMutation.mutate(finding.id)}
                                disabled={resolveMutation.isPending}
                              >
                                <CheckCircle className="h-3 w-3 mr-1" />Resolve
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
