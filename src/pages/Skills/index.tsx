import { useState, useEffect, useCallback } from 'react';
import {
  Puzzle,
  Search,
  Download,
  Trash2,
  Star,
  Package,
  Code,
  Paintbrush,
  TestTube,
  Wrench,
  RefreshCw,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ipc } from '@/services/ipc';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  downloads?: number;
  rating?: number;
  tools?: Array<{ name: string; description: string }>;
  installed?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORIES = [
  { value: 'all', label: '全部', icon: Package },
  { value: 'code', label: '编码', icon: Code },
  { value: 'design', label: '设计', icon: Paintbrush },
  { value: 'test', label: '测试', icon: TestTube },
  { value: 'utility', label: '工具', icon: Wrench },
] as const;

type CategoryValue = (typeof CATEGORIES)[number]['value'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SkillsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<CategoryValue>('all');
  const [marketSkills, setMarketSkills] = useState<SkillInfo[]>([]);
  const [installedSkills, setInstalledSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());

  // Fetch installed skills from backend
  const loadInstalled = useCallback(async () => {
    try {
      const list = await ipc.listInstalledSkills();
      const mapped: SkillInfo[] = (list ?? []).map((item) => ({
        id: String(item['id'] ?? ''),
        name: String(item['name'] ?? ''),
        version: String(item['version'] ?? ''),
        description: String(item['description'] ?? ''),
        author: String(item['author'] ?? ''),
        category: String(item['category'] ?? 'utility'),
        installed: true,
      }));
      setInstalledSkills(mapped);
    } catch {
      // Silently fail — backend may not be ready
    }
  }, []);

  // Search marketplace
  const searchMarket = useCallback(async (query: string) => {
    if (!query.trim()) {
      setMarketSkills([]);
      return;
    }
    setLoading(true);
    try {
      const results = await ipc.searchSkills(query);
      const mapped: SkillInfo[] = (results ?? []).map((item) => ({
        id: String(item['id'] ?? ''),
        name: String(item['name'] ?? ''),
        version: String(item['version'] ?? ''),
        description: String(item['description'] ?? ''),
        author: String(item['author'] ?? ''),
        category: String(item['category'] ?? 'utility'),
        downloads: typeof item['downloads'] === 'number' ? item['downloads'] : undefined,
        rating: typeof item['rating'] === 'number' ? item['rating'] : undefined,
      }));
      setMarketSkills(mapped);
    } catch {
      setMarketSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInstalled();
  }, [loadInstalled]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      void searchMarket(searchQuery);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, searchMarket]);

  const handleInstall = async (skill: SkillInfo) => {
    setInstallingIds((prev) => new Set(prev).add(skill.id));
    try {
      await ipc.installSkill(skill.id);
      await loadInstalled();
    } catch {
      // Installation failed — ignore for now
    } finally {
      setInstallingIds((prev) => {
        const next = new Set(prev);
        next.delete(skill.id);
        return next;
      });
    }
  };

  const handleUninstall = async (id: string) => {
    try {
      await ipc.uninstallSkill(id);
      await loadInstalled();
    } catch {
      // Uninstall failed
    }
  };

  const installedIds = new Set(installedSkills.map((s) => s.id));

  const filterByCategory = (skills: SkillInfo[]): SkillInfo[] => {
    if (activeCategory === 'all') return skills;
    return skills.filter((s) => s.category.toLowerCase() === activeCategory);
  };

  const filteredMarket = filterByCategory(marketSkills);
  const filteredInstalled = filterByCategory(installedSkills);

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Puzzle className="h-6 w-6" />
          <h1 className="text-2xl font-bold">技能商店</h1>
        </div>
        <p className="text-muted-foreground mb-6">
          从 ClawHub 市场浏览和安装技能，扩展智能体能力。
        </p>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索技能..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Category Tabs */}
        <Tabs value={activeCategory} onValueChange={(v) => setActiveCategory(v as CategoryValue)}>
          <TabsList className="mb-6">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              return (
                <TabsTrigger key={cat.value} value={cat.value} className="gap-1.5">
                  <Icon className="h-3.5 w-3.5" />
                  {cat.label}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {/* Installed Skills Section */}
          <TabsContent value={activeCategory} forceMount>
            {filteredInstalled.length > 0 && (
              <div className="mb-8">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  已安装 ({filteredInstalled.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredInstalled.map((skill) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      installed
                      installing={false}
                      onUninstall={() => void handleUninstall(skill.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Market Results */}
            {searchQuery.trim() && (
              <div>
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Search className="h-5 w-5" />
                  搜索结果
                  {loading && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
                </h2>
                {filteredMarket.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredMarket.map((skill) => (
                      <SkillCard
                        key={skill.id}
                        skill={skill}
                        installed={installedIds.has(skill.id)}
                        installing={installingIds.has(skill.id)}
                        onInstall={() => void handleInstall(skill)}
                        onUninstall={() => void handleUninstall(skill.id)}
                      />
                    ))}
                  </div>
                ) : !loading ? (
                  <div className="text-center text-muted-foreground py-12">
                    未找到匹配的技能。尝试其他搜索词。
                  </div>
                ) : null}
              </div>
            )}

            {/* Empty state */}
            {!searchQuery.trim() && filteredInstalled.length === 0 && (
              <div className="text-center text-muted-foreground py-20">
                尚未安装任何技能。使用搜索栏浏览 ClawHub 市场。
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skill Card
// ---------------------------------------------------------------------------

interface SkillCardProps {
  skill: SkillInfo;
  installed: boolean;
  installing: boolean;
  onInstall?: () => void;
  onUninstall?: () => void;
}

function SkillCard({ skill, installed, installing, onInstall, onUninstall }: SkillCardProps) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <CardTitle className="text-base">{skill.name}</CardTitle>
          <Badge variant="outline" className="text-xs shrink-0 ml-2">
            {skill.category}
          </Badge>
        </div>
        <CardDescription className="line-clamp-2">{skill.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-3">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{skill.author}</span>
          <span>v{skill.version}</span>
          {typeof skill.rating === 'number' && skill.rating > 0 && (
            <span className="flex items-center gap-0.5">
              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
              {skill.rating.toFixed(1)}
            </span>
          )}
          {typeof skill.downloads === 'number' && skill.downloads > 0 && (
            <span className="flex items-center gap-0.5">
              <Download className="h-3 w-3" />
              {skill.downloads.toLocaleString()}
            </span>
          )}
        </div>
      </CardContent>
      <CardFooter>
        {installed ? (
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={onUninstall}
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            卸载
          </Button>
        ) : (
          <Button
            size="sm"
            className="w-full"
            disabled={installing}
            onClick={onInstall}
          >
            {installing ? (
              <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-1.5" />
            )}
            {installing ? '安装中...' : '安装'}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
