import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { runAnalysis, getReports, resolveFinding, downloadReportPdf, getSystemPrompt, updateSystemPrompt, resetSystemPrompt } from '@/api/advisor'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Shield, Play, CheckCircle, AlertTriangle, AlertOctagon, Info, Sparkles, Download, Settings2, RotateCcw } from 'lucide-react'
import type { Severity, AdvisoryReport } from '@/types'

const severityConfig: Record<Severity, { variant: 'destructive' | 'warning' | 'default' | 'secondary' | 'outline'; icon: typeof AlertOctagon; label: string }> = {
  critical: { variant: 'destructive', icon: AlertOctagon, label: 'Critical' },
  high: { variant: 'destructive', icon: AlertTriangle, label: 'High' },
  medium: { variant: 'warning', icon: AlertTriangle, label: 'Medium' },
  low: { variant: 'secondary', icon: Info, label: 'Low' },
  info: { variant: 'outline', icon: Info, label: 'Info' },
}

function getScoreLabel(score: number): { label: string; description: string; color: string } {
  if (score >= 90) return { label: 'Excellent', description: 'Your network security posture is strong with minimal issues.', color: 'text-green-500' }
  if (score >= 80) return { label: 'Good', description: 'Your network is well-secured with a few areas for improvement.', color: 'text-green-500' }
  if (score >= 70) return { label: 'Fair', description: 'Your network has some security gaps that should be addressed.', color: 'text-yellow-500' }
  if (score >= 50) return { label: 'Needs Work', description: 'Several security issues found. Review and address the findings below.', color: 'text-yellow-500' }
  return { label: 'Critical', description: 'Significant security vulnerabilities detected. Immediate action recommended.', color: 'text-red-500' }
}

function ScoreGauge({ score }: { score: number }) {
  const { label, description, color } = getScoreLabel(score)
  return (
    <div className="flex flex-col items-center text-center">
      <span className={`text-6xl font-bold ${color}`}>{Math.round(score)}</span>
      <span className={`text-sm font-semibold mt-1 ${color}`}>{label}</span>
      <span className="text-xs text-muted-foreground mt-1 max-w-[200px]">{description}</span>
    </div>
  )
}

export default function AdvisorPage() {
  const queryClient = useQueryClient()
  const [showPromptEditor, setShowPromptEditor] = useState(false)
  const [promptText, setPromptText] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const { data: reports = [] } = useQuery({ queryKey: ['advisor', 'reports'], queryFn: getReports })

  const { data: systemPrompt } = useQuery({
    queryKey: ['advisor', 'system-prompt'],
    queryFn: getSystemPrompt,
  })

  const analyzeMutation = useMutation({
    mutationFn: runAnalysis,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['advisor'] }),
  })

  const resolveMutation = useMutation({
    mutationFn: resolveFinding,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['advisor'] }),
  })

  const promptMutation = useMutation({
    mutationFn: updateSystemPrompt,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['advisor', 'system-prompt'] })
    },
  })

  const resetPromptMutation = useMutation({
    mutationFn: resetSystemPrompt,
    onSuccess: (data) => {
      setPromptText(data.prompt)
      queryClient.invalidateQueries({ queryKey: ['advisor', 'system-prompt'] })
    },
  })

  const handleDownload = async (reportId: number) => {
    setDownloading(true)
    setDownloadError(null)
    try {
      await downloadReportPdf(reportId)
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : 'PDF download failed')
    } finally {
      setDownloading(false)
    }
  }

  const handleOpenPromptEditor = () => {
    setPromptText(systemPrompt?.prompt || '')
    setShowPromptEditor(true)
  }

  const latestReport: AdvisoryReport | undefined = reports[0]

  const categories = latestReport
    ? [...new Set(latestReport.findings.map((f) => f.category))]
    : []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Network Advisor</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleOpenPromptEditor}>
            <Settings2 className="h-4 w-4 mr-2" />AI Prompt
          </Button>
          <Button onClick={() => analyzeMutation.mutate()} disabled={analyzeMutation.isPending}>
            <Play className="h-4 w-4 mr-2" />
            {analyzeMutation.isPending ? 'Analyzing...' : 'Run Analysis'}
          </Button>
        </div>
      </div>

      {/* System Prompt Editor */}
      {showPromptEditor && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              AI System Prompt
              {systemPrompt?.is_default && <Badge variant="outline">Default</Badge>}
              {systemPrompt && !systemPrompt.is_default && <Badge variant="secondary">Custom</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This prompt is sent to the AI model as the system instruction when generating the security analysis summary.
              Customize it to change the tone, focus, or format of the AI output.
            </p>
            <textarea
              className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder="Enter system prompt for the AI advisor..."
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => promptMutation.mutate(promptText)}
                disabled={promptMutation.isPending}
              >
                Save Prompt
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => resetPromptMutation.mutate()}
                disabled={resetPromptMutation.isPending}
              >
                <RotateCcw className="h-3 w-3 mr-1" />Reset to Default
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowPromptEditor(false)}
              >
                Close
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
              <CardContent className="p-6">
                <div className="flex items-center justify-center mb-4">
                  <ScoreGauge score={latestReport.overall_score} />
                </div>
                <div className="border-t pt-3 space-y-1">
                  <p className="text-xs text-muted-foreground font-medium mb-2">Score Guide</p>
                  <div className="flex justify-between text-xs"><span className="text-green-500">90-100 Excellent</span><span className="text-green-500">80-89 Good</span></div>
                  <div className="flex justify-between text-xs"><span className="text-yellow-500">70-79 Fair</span><span className="text-yellow-500">50-69 Needs Work</span></div>
                  <div className="text-xs"><span className="text-red-500">0-49 Critical</span></div>
                </div>
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

          {/* Download Button */}
          <div className="flex items-center justify-end gap-3">
            {downloadError && <span className="text-sm text-destructive">{downloadError}</span>}
            <Button
              variant="outline"
              onClick={() => handleDownload(latestReport.id)}
              disabled={downloading}
            >
              <Download className="h-4 w-4 mr-2" />
              {downloading ? 'Generating PDF...' : 'Download Report (PDF)'}
            </Button>
          </div>

          {/* AI Summary */}
          {latestReport.ai_summary && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  AI Analysis
                  <Badge variant="outline">AI-Enhanced</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{latestReport.ai_summary}</p>
              </CardContent>
            </Card>
          )}

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
