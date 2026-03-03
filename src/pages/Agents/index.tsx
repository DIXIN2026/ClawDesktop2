import { useState, useEffect, useCallback } from 'react';
import {
  Bot, Code, FileText, Palette, TestTube, Settings2, Play, Plus,
  ArrowRight, Trash2, Workflow,
} from 'lucide-react';
import { useAgentsStore } from '../../stores/agents';
import type { AgentType, AgentConfig } from '../../stores/agents';
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
      className={`p-4 rounded-lg border cursor-pointer transition-all ${
        selected
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
          : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300'
      }`}
    >
      <div className="flex items-center gap-3 mb-2">
        <div className={`p-2 rounded-lg ${selected ? 'bg-blue-100 dark:bg-blue-800' : 'bg-zinc-100 dark:bg-zinc-800'}`}>
          <Icon className={`w-5 h-5 ${selected ? 'text-blue-600' : 'text-zinc-600 dark:text-zinc-300'}`} />
        </div>
        <div>
          <h3 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">{label}</h3>
          <p className="text-xs text-zinc-500">{desc}</p>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {agent.skills.slice(0, 3).map((s) => (
            <span key={s} className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700 text-zinc-500">
              {s}
            </span>
          ))}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          agent.status === 'running' ? 'bg-green-100 text-green-700' :
          agent.status === 'error' ? 'bg-red-100 text-red-700' :
          'bg-zinc-100 text-zinc-500'
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
      <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
        <Settings2 className="w-4 h-4 inline-block mr-2" />
        {AGENT_LABELS[agent.type]} 配置
      </h3>
      <div>
        <label className="text-xs text-zinc-500 mb-1 block">系统提示词</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={() => { if (prompt !== (agent.systemPrompt ?? '')) onUpdate(agent.id, { systemPrompt: prompt }); }}
          rows={5}
          className="w-full text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 bg-transparent resize-none"
        />
      </div>
      <div>
        <label className="text-xs text-zinc-500 mb-1 block">技能列表</label>
        <div className="flex flex-wrap gap-1.5">
          {agent.skills.map((s) => (
            <span key={s} className="text-xs px-2 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 border border-blue-200 dark:border-blue-700">
              {s}
            </span>
          ))}
        </div>
      </div>
      {agent.defaultModel && (
        <div>
          <label className="text-xs text-zinc-500 mb-1 block">默认模型</label>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            {agent.defaultModel.providerId} / {agent.defaultModel.modelId}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Pipeline Editor ─────────────────────────────────────────────────

function PipelineEditor({ pipeline, onChange, onDelete, onRun }: {
  pipeline: Pipeline;
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
      <div className="flex items-center justify-between">
        <input
          value={pipeline.name}
          onChange={(e) => onChange({ ...pipeline, name: e.target.value })}
          className="text-lg font-semibold bg-transparent border-none outline-none text-zinc-900 dark:text-zinc-100"
          placeholder="流水线名称"
        />
        <div className="flex gap-2">
          <button onClick={onRun} className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700">
            <Play className="w-4 h-4" /> 运行
          </button>
          <button onClick={onDelete} className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
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
            <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-3">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs text-zinc-400 font-mono">#{idx + 1}</span>
                <select
                  value={step.agentType}
                  onChange={(e) => updateStep(step.id, { agentType: e.target.value as AgentType })}
                  className="text-sm border border-zinc-200 dark:border-zinc-600 rounded px-2 py-1 bg-transparent"
                >
                  {Object.entries(AGENT_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <button onClick={() => removeStep(step.id)} className="ml-auto p-1 text-zinc-400 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <textarea
                value={step.prompt}
                onChange={(e) => updateStep(step.id, { prompt: e.target.value })}
                placeholder="任务描述..."
                rows={2}
                className="w-full text-sm bg-transparent border border-zinc-200 dark:border-zinc-700 rounded p-2 resize-none"
              />
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addStep}
        className="flex items-center gap-1.5 w-full justify-center py-2 border-2 border-dashed border-zinc-300 dark:border-zinc-600 rounded-lg text-zinc-500 hover:text-zinc-700 hover:border-zinc-400 text-sm"
      >
        <Plus className="w-4 h-4" /> 添加步骤
      </button>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

export default function AgentsPage() {
  const { agents, loadAgents, updateAgent } = useAgentsStore();
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'agents' | 'pipelines'>('agents');
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<string | null>(null);

  useEffect(() => {
    loadAgents();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = agents.find((a) => a.id === selectedAgent);
  const selectedPipe = pipelines.find((p) => p.id === selectedPipeline);

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
        workDirectory: process.cwd?.() ?? '.',
      });
    } catch (err) {
      console.error('Pipeline execution failed:', err);
    }
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
        <button
          onClick={() => setActiveTab('agents')}
          className={`flex items-center gap-1.5 text-sm font-medium pb-1 border-b-2 ${
            activeTab === 'agents' ? 'border-blue-500 text-blue-600' : 'border-transparent text-zinc-500 hover:text-zinc-700'
          }`}
        >
          <Bot className="w-4 h-4" /> 智能体
        </button>
        <button
          onClick={() => setActiveTab('pipelines')}
          className={`flex items-center gap-1.5 text-sm font-medium pb-1 border-b-2 ${
            activeTab === 'pipelines' ? 'border-blue-500 text-blue-600' : 'border-transparent text-zinc-500 hover:text-zinc-700'
          }`}
        >
          <Workflow className="w-4 h-4" /> 编排流水线
        </button>
      </div>

      {activeTab === 'agents' ? (
        <div className="flex flex-1 overflow-hidden">
          {/* Agent grid */}
          <div className="flex-1 p-4 overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
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
            <div className="w-[360px] border-l border-zinc-200 dark:border-zinc-700 p-4 overflow-y-auto">
              <AgentConfigPanel
                agent={selected}
                onUpdate={(id, updates) => updateAgent(id, updates)}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Pipeline list */}
          <div className="w-[240px] border-r border-zinc-200 dark:border-zinc-700 p-3 space-y-2 overflow-y-auto">
            <button
              onClick={createPipeline}
              className="flex items-center gap-1.5 w-full justify-center py-2 text-sm text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg"
            >
              <Plus className="w-4 h-4" /> 新建流水线
            </button>
            {pipelines.map((p) => (
              <div
                key={p.id}
                onClick={() => setSelectedPipeline(p.id)}
                className={`p-2.5 rounded-lg cursor-pointer text-sm ${
                  selectedPipeline === p.id
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Workflow className="w-4 h-4 shrink-0" />
                  <span className="truncate">{p.name}</span>
                </div>
                <span className="text-xs text-zinc-400 ml-6">{p.steps.length} 步骤</span>
              </div>
            ))}
          </div>

          {/* Pipeline editor */}
          <div className="flex-1 p-4 overflow-y-auto">
            {selectedPipe ? (
              <PipelineEditor
                pipeline={selectedPipe}
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
              <div className="flex flex-col items-center justify-center h-full text-zinc-400">
                <Workflow className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">选择或创建一个编排流水线</p>
                <p className="text-xs mt-1">支持多智能体顺序/并行执行</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
