import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Brain, RefreshCw, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useMemoryStore } from '@/stores/memory';

function formatRatio(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

export function MemorySettings() {
  const {
    stats,
    config,
    searchResults,
    preferences,
    isSearching,
    isReindexing,
    loadStats,
    loadConfig,
    loadPreferences,
    search,
    updateConfig,
    deleteChunk,
    deletePreference,
    reindex,
  } = useMemoryStore();

  const [query, setQuery] = useState('');
  const [compactRatio, setCompactRatio] = useState(0.7);
  const [keepRecentMessages, setKeepRecentMessages] = useState(10);
  const [maxSearchResults, setMaxSearchResults] = useState(5);
  const [vectorWeight, setVectorWeight] = useState(0.7);
  const [bm25Weight, setBm25Weight] = useState(0.3);

  useEffect(() => {
    loadStats().catch(() => {});
    loadConfig().catch(() => {});
    loadPreferences(null).catch(() => {});
  }, [loadConfig, loadPreferences, loadStats]);

  useEffect(() => {
    if (!config) return;
    setCompactRatio(config.compactRatio);
    setKeepRecentMessages(config.keepRecentMessages);
    setMaxSearchResults(config.maxSearchResults);
    setVectorWeight(config.vectorWeight);
    setBm25Weight(config.bm25Weight);
  }, [config]);

  const ratioInvalid = useMemo(() => {
    return compactRatio <= 0 || compactRatio >= 1;
  }, [compactRatio]);

  const saveNumberConfig = async (key: string, val: number) => {
    if (!Number.isFinite(val)) return;
    await updateConfig(key, val);
  };

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;
    await search(q, null);
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Brain className="h-5 w-5" />
          记忆
        </h2>
        <p className="text-sm text-muted-foreground mt-1">配置记忆压缩、检索和索引状态。</p>
      </div>

      <Separator />

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">记忆块</p>
          <p className="text-xl font-semibold mt-1">{stats?.totalChunks ?? 0}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">摘要数</p>
          <p className="text-xl font-semibold mt-1">{stats?.totalSummaries ?? 0}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">带向量记忆块</p>
          <p className="text-xl font-semibold mt-1">{stats?.chunksWithEmbeddings ?? 0}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">最新写入</p>
          <p className="text-sm font-medium mt-2 truncate">{stats?.newestChunkDate ?? '-'}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">偏好记忆</p>
          <p className="text-xl font-semibold mt-1">{stats?.totalPreferenceObservations ?? preferences.length}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">图谱实体</p>
          <p className="text-xl font-semibold mt-1">{stats?.totalGraphEntities ?? 0}</p>
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <h3 className="text-base font-semibold">配置</h3>

        <div className="space-y-2">
          <Label>压缩阈值比例（0~1）</Label>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={0.1}
              max={0.95}
              step={0.05}
              value={compactRatio}
              onChange={(e) => setCompactRatio(Number(e.target.value))}
              onBlur={() => {
                if (ratioInvalid) {
                  toast.error('压缩阈值需在 (0, 1) 区间');
                  return;
                }
                void saveNumberConfig('compactRatio', compactRatio);
              }}
              className="w-40"
            />
            <span className="text-xs text-muted-foreground">{formatRatio(compactRatio)}</span>
          </div>
        </div>

        <div className="space-y-2">
          <Label>保留最近消息数</Label>
          <Input
            type="number"
            min={1}
            max={200}
            value={keepRecentMessages}
            onChange={(e) => setKeepRecentMessages(Number(e.target.value))}
            onBlur={() => void saveNumberConfig('keepRecentMessages', keepRecentMessages)}
            className="w-40"
          />
        </div>

        <div className="space-y-2">
          <Label>最大检索结果数</Label>
          <Input
            type="number"
            min={1}
            max={50}
            value={maxSearchResults}
            onChange={(e) => setMaxSearchResults(Number(e.target.value))}
            onBlur={() => void saveNumberConfig('maxSearchResults', maxSearchResults)}
            className="w-40"
          />
        </div>

        <div className="space-y-2">
          <Label>向量权重</Label>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={vectorWeight}
            onChange={(e) => setVectorWeight(Number(e.target.value))}
            onBlur={() => void saveNumberConfig('vectorWeight', vectorWeight)}
            className="w-40"
          />
        </div>

        <div className="space-y-2">
          <Label>BM25 权重</Label>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={bm25Weight}
            onChange={(e) => setBm25Weight(Number(e.target.value))}
            onBlur={() => void saveNumberConfig('bm25Weight', bm25Weight)}
            className="w-40"
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label>启用向量检索</Label>
            <p className="text-xs text-muted-foreground mt-1">关闭后仅使用 BM25 检索</p>
          </div>
          <Switch
            checked={config?.embeddingEnabled ?? true}
            onCheckedChange={(checked) => {
              void updateConfig('embeddingEnabled', checked);
            }}
          />
        </div>

        <Button
          variant="outline"
          onClick={() => {
            void reindex().then((res) => {
              toast.success(`重建完成：${res.indexed} 条`);
            }).catch((err) => {
              toast.error(err instanceof Error ? err.message : String(err));
            });
          }}
          disabled={isReindexing}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isReindexing ? 'animate-spin' : ''}`} />
          {isReindexing ? '重建中...' : '重建向量索引'}
        </Button>
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">偏好记忆（知识图谱）</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void loadPreferences(null);
            }}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            刷新
          </Button>
        </div>
        <div className="space-y-2">
          {preferences.map((item) => (
            <div key={item.id} className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  confidence {(item.confidence ?? 0).toFixed(2)} · {item.updatedAt}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-destructive"
                  onClick={() => {
                    void deletePreference(item.id).then(() => {
                      toast.success('已删除偏好记忆');
                    }).catch((err) => {
                      toast.error(err instanceof Error ? err.message : String(err));
                    });
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-sm mt-2 whitespace-pre-wrap break-words">{item.content}</p>
            </div>
          ))}
          {preferences.length === 0 && (
            <p className="text-xs text-muted-foreground">暂无偏好记忆。用户偏好会在对话中自动提取。</p>
          )}
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <h3 className="text-base font-semibold">检索</h3>
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleSearch();
              }
            }}
            placeholder="输入关键词检索历史记忆"
          />
          <Button onClick={() => void handleSearch()} disabled={isSearching || !query.trim()}>
            <Search className="h-4 w-4 mr-1.5" />
            搜索
          </Button>
        </div>

        <div className="space-y-2">
          {searchResults.map((item) => (
            <div key={item.chunkId} className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  {item.source} · score {item.score.toFixed(3)}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-destructive"
                  onClick={() => {
                    void deleteChunk(item.chunkId).then(() => {
                      toast.success('已删除记忆条目');
                    }).catch((err) => {
                      toast.error(err instanceof Error ? err.message : String(err));
                    });
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-sm mt-2 whitespace-pre-wrap break-words">{item.content}</p>
            </div>
          ))}
          {searchResults.length === 0 && (
            <p className="text-xs text-muted-foreground">暂无检索结果</p>
          )}
        </div>
      </div>
    </div>
  );
}
