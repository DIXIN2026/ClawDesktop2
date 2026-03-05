import { useState, useEffect, useCallback } from 'react';
import {
  Bot, Code, FileText, Palette, TestTube, Settings2, Play, Plus,
  ArrowRight, Trash2, Workflow,
} from 'lucide-react';
import { useAgentsStore } from '../../stores/agents';
import type { AgentType, AgentConfig } from '../../stores/agents';
import { useSettingsStore } from '../../stores/settings';
import { ipc } from '../../services/ipc';

// ── Agent type config ──────────────────────────────────────────────

const AGENT_ICONS: Record<AgentType, typeof Code> = {
  coding: Code,
  requirements: FileText,
  design: Palette,
  testing: TestTube,
};

const AGENT_LABELS: Record<AgentType, string> = {
  coding: '编码智能体',
  requirements: '需求智能体',
  design: '设计智能体',
  testing: '测试智能体',
};

const AGENT_DESCRIPTIONS: Record<AgentType, string> = {
  coding: '编写代码、执行命令、修改文件',
  requirements: '分析需求、生成 PRD、拆解任务',
  design: '生成 UI 设计、组件代码、预览',
  testing: '生成测试用例、执行测试、质量报告',
};

// ── Pipeline types ──────────────────────────────────────────────────

interface PipelineStep {
  id: string;
  agentType: AgentType;
  prompt: string;
  providerId?: string;
  modelId?: string;
}

interface Pipeline {
  id: string;
  name: string;
  steps: PipelineStep[];
}

interface PipelineStepResult {
  stepId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output: string;
  durationMs: number;
  error?: string;
}

interface PipelineProgress {
  pipelineId: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  currentStepIndex: number;
  results: PipelineStepResult[];
  startedAt: number;
}

// ── Agent Card ──────────────────────────────────────────────────────

function AgentCard({ agent, onSelect, selected }: {
  agent: AgentConfig;
  onSelect: (id: string) => void;
  selected: boolean;
}) {
  const Icon = AGENT_ICONS[agent.type];
  const label = AGENT_LABELS[agent.type];
  const desc = AGENT_DESCRIPTIONS[agent.type];

  return (
    <div
      onClick={() => onSelect(agent.id)}
      className={`cursor-pointer rounded-xl border p-4 transition-all ${
        selected
          ? 'border-primary/40 bg-accent/80 shadow-sm'
          : 'border-border/70 bg-card/65 hover:border-border hover:bg-accent/40'
      }`}
    >
      <div className="flex items-center gap-3 mb-2">
        <div className={`rounded-lg p-2 ${selected ? 'bg-primary/15' : 'bg-muted'}`}>
          <Icon className={`w-5 h-5 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
        </div>
        <div>
          <h3 className="text-sm font-medium">{label}</h3>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {agent.skills.slice(0, 3).map((s) => (
            <span key={s} className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {s}
            </span>
          ))}
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs ${
          agent.status === 'running' ? 'bg-green-500/15 text-green-600' :
          agent.status === 'error' ? 'bg-red-500/15 text-red-600' :
          'bg-muted text-muted-foreground'
        }`}>
          {agent.status === 'running' ? '运行中' : agent.status === 'error' ? '错误' : '就绪'}
        </span>
      </div>
    </div>
  );
}

// ── Agent Config Panel ──────────────────────────────────────────────

function AgentConfigPanel({ agent, onUpdate }: {
  agent: AgentConfig;
  onUpdate: (id: string, updates: Partial<AgentConfig>) => void;
}) {
  const [prompt, setPrompt] = useState(agent.systemPrompt ?? '');

  useEffect(() => {
    setPrompt(agent.systemPrompt ?? '');
  }, [agent.id, agent.systemPrompt]);

  return (
    <div className="space-y-4">
      <h3 className="font-medium">
        <Settings2 className="w-4 h-4 inline-block mr-2" />
        {AGENT_LABELS[agent.type]} 配置
      </h3>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">系统提示词</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={() => { if (prompt !== (agent.systemPrompt ?? '')) onUpdate(agent.id, { systemPrompt: prompt }); }}
          rows={5}
          className="w-full resize-none rounded-lg border border-border/80 bg-background/70 p-3 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">技能列表</label>
        <div className="flex flex-wrap gap-1.5">
          {agent.skills.map((s) => (
            <span key={s} className="rounded-full border border-primary/25 bg-primary/10 px-2 py-1 text-xs text-primary">
              {s}
            </span>
          ))}
        </div>
      </div>
      {agent.defaultModel && (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">默认模型</label>
          <p className="text-sm text-muted-foreground">
            {agent.defaultModel.providerId} / {agent.defaultModel.modelId}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Pipeline Editor ─────────────────────────────────────────────────

function PipelineEditor({ pipeline, progress, onChange, onDelete, onRun }: {
  pipeline: Pipeline;
  progress?: PipelineProgress;
  onChange: (p: Pipeline) => void;
  onDelete: () => void;
  onRun: () => void;
}) {
  const addStep = () => {
    const step: PipelineStep = {
      id: `step-${Date.now()}`,
      agentType: 'coding',
      prompt: '',
    };
    onChange({ ...pipeline, steps: [...pipeline.steps, step] });
  };

  const removeStep = (stepId: string) => {
    onChange({ ...pipeline, steps: pipeline.steps.filter((s) => s.id !== stepId) });
  };

  const updateStep = (stepId: string, updates: Partial<PipelineStep>) => {
    onChange({
      ...pipeline,
      steps: pipeline.steps.map((s) => (s.id === stepId ? { ...s, ...updates } : s)),
    });
  };

  return (
    <div className="space-y-4">
      {progress && (
        <div className="space-y-2 rounded-xl border border-border/70 bg-card/70 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">执行进度</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              progress.status === 'running' ? 'bg-blue-100 text-blue-700'
                : progress.status === 'completed' ? 'bg-green-100 text-green-700'
                : progress.status === 'failed' ? 'bg-red-100 text-red-700'
                : progress.status === 'cancelled' ? 'bg-zinc-200 text-zinc-700'
                : 'bg-zinc-100 text-zinc-600'
            }`}>
              {progress.status}
            </span>
          </div>
          <div className="space-y-1">
            {progress.results.map((result) => (
              <div key={result.stepId} className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate pr-2">{result.stepId}</span>
                <span className={`shrink-0 ${
                  result.status === 'completed' ? 'text-green-600'
                    : result.status === 'failed' ? 'text-red-600'
                    : result.status === 'skipped' ? 'text-zinc-500'
                    : 'text-blue-600'
                }`}>
                  {result.status} ({Math.round(result.durationMs)}ms)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <input
          value={pipeline.name}
          onChange={(e) => onChange({ ...pipeline, name: e.target.value })}
          className="text-lg font-semibold bg-transparent border-none outline-none"
          placeholder="流水线名称"
        />
        <div className="flex gap-2">
          <button onClick={onRun} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90">
            <Play className="w-4 h-4" /> 运行
          </button>
          <button onClick={onDelete} className="rounded p-1.5 text-destructive hover:bg-destructive/10">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {pipeline.steps.map((step, idx) => (
          <div key={step.id}>
            {idx > 0 && (
              <div className="flex justify-center py-1">
                <ArrowRight className="w-4 h-4 text-zinc-400 rotate-90" />
              </div>
            )}
            <div className="rounded-lg border border-border/70 bg-card/65 p-3">
              <div className="flex items-center gap-3 mb-2">
                <span className="font-mono text-xs text-muted-foreground">#{idx + 1}</span>
                <select
                  value={step.agentType}
                  onChange={(e) => updateStep(step.id, { agentType: e.target.value as AgentType })}
                  className="rounded border border-border/80 bg-background/70 px-2 py-1 text-sm"
                >
                  {Object.entries(AGENT_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <button onClick={() => removeStep(step.id)} className="ml-auto p-1 text-muted-foreground hover:text-destructive">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <textarea
                value={step.prompt}
                onChange={(e) => updateStep(step.id, { prompt: e.target.value })}
                placeholder="任务描述..."
                rows={2}
                className="w-full resize-none rounded border border-border/80 bg-background/70 p-2 text-sm"
              />
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addStep}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-border/80 py-2 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground"
      >
        <Plus className="w-4 h-4" /> 添加步骤
      </button>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

export default function AgentsPage() {
  const { agents, loadAgents, updateAgent } = useAgentsStore();
  const defaultWorkDirectory = useSettingsStore((s) => s.workDirectory);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'agents' | 'pipelines'>('agents');
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<string | null>(null);
  const [pipelineProgress, setPipelineProgress] = useState<Record<string, PipelineProgress>>({});

  useEffect(() => {
    loadAgents();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = agents.find((a) => a.id === selectedAgent);
  const selectedPipe = pipelines.find((p) => p.id === selectedPipeline);
  const selectedPipelineProgress = selectedPipe ? pipelineProgress[selectedPipe.id] : undefined;

  useEffect(() => {
    const unsubscribe = ipc.onOrchestratorProgress((progress) => {
      if (!progress?.pipelineId) return;
      setPipelineProgress((prev) => ({
        ...prev,
        [progress.pipelineId]: progress,
      }));
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  const createPipeline = useCallback(() => {
    const id = `pipeline-${Date.now()}`;
    const newPipeline: Pipeline = {
      id,
      name: '新建流水线',
      steps: [],
    };
    setPipelines((prev) => [...prev, newPipeline]);
    setSelectedPipeline(id);
  }, []);

  const handleRunPipeline = useCallback(async (pipeline: Pipeline) => {
    if (pipeline.steps.length === 0) return;
    try {
      await ipc.executePipeline({
        id: pipeline.id,
        name: pipeline.name,
        steps: pipeline.steps.map((s) => ({
          id: s.id,
          agentType: s.agentType,
          prompt: s.prompt,
          input: 'previous_step' as const,
          providerId: s.providerId,
          modelId: s.modelId,
        })),
        workDirectory: defaultWorkDirectory?.trim() || '.',
      });
    } catch (err) {
      console.error('Pipeline execution failed:', err);
    }
  }, [defaultWorkDirectory]);

  return (
    <div className="page-shell">
      <div className="page-container h-full max-w-none space-y-3">
      {/* Tab bar */}
      <div className="panel-surface flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => setActiveTab('agents')}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-all ${
            activeTab === 'agents' ? 'border-primary/30 bg-accent text-primary' : 'border-transparent text-muted-foreground hover:border-border/70 hover:bg-accent/40'
          }`}
        >
          <Bot className="w-4 h-4" /> 智能体
        </button>
        <button
          onClick={() => setActiveTab('pipelines')}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-all ${
            activeTab === 'pipelines' ? 'border-primary/30 bg-accent text-primary' : 'border-transparent text-muted-foreground hover:border-border/70 hover:bg-accent/40'
          }`}
        >
          <Workflow className="w-4 h-4" /> 编排流水线
        </button>
      </div>

      {activeTab === 'agents' ? (
        <div className="panel-surface flex flex-1 overflow-hidden">
          {/* Agent grid */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onSelect={setSelectedAgent}
                  selected={selectedAgent === agent.id}
                />
              ))}
            </div>
          </div>

          {/* Config panel */}
          {selected && (
            <div className="w-[360px] border-l border-border/70 bg-background/60 p-4 overflow-y-auto">
              <AgentConfigPanel
                agent={selected}
                onUpdate={(id, updates) => updateAgent(id, updates)}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="panel-surface flex flex-1 overflow-hidden">
          {/* Pipeline list */}
          <div className="w-[240px] border-r border-border/70 bg-background/60 p-3 space-y-2 overflow-y-auto">
            <button
              onClick={createPipeline}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border/70 py-2 text-sm text-primary hover:bg-accent/50"
            >
              <Plus className="w-4 h-4" /> 新建流水线
            </button>
            {pipelines.map((p) => (
              <div
                key={p.id}
                onClick={() => setSelectedPipeline(p.id)}
                className={`p-2.5 rounded-lg cursor-pointer text-sm ${
                  selectedPipeline === p.id
                    ? 'border border-primary/30 bg-accent text-primary'
                    : 'border border-transparent text-foreground hover:border-border/70 hover:bg-accent/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Workflow className="w-4 h-4 shrink-0" />
                  <span className="truncate">{p.name}</span>
                </div>
                <div className="ml-6 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{p.steps.length} 步骤</span>
                  {pipelineProgress[p.id] && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      pipelineProgress[p.id].status === 'running' ? 'bg-blue-100 text-blue-700'
                        : pipelineProgress[p.id].status === 'completed' ? 'bg-green-100 text-green-700'
                        : pipelineProgress[p.id].status === 'failed' ? 'bg-red-100 text-red-700'
                        : 'bg-zinc-100 text-zinc-600'
                    }`}>
                      {pipelineProgress[p.id].status}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pipeline editor */}
          <div className="flex-1 p-4 overflow-y-auto">
            {selectedPipe ? (
              <PipelineEditor
                pipeline={selectedPipe}
                progress={selectedPipelineProgress}
                onChange={(updated) => {
                  setPipelines((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
                }}
                onDelete={() => {
                  setPipelines((prev) => prev.filter((p) => p.id !== selectedPipe.id));
                  setSelectedPipeline(null);
                }}
                onRun={() => handleRunPipeline(selectedPipe)}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                <Workflow className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">选择或创建一个编排流水线</p>
                <p className="text-xs mt-1">支持多智能体顺序/并行执行</p>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
