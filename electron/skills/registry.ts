/**
 * Skill Registry
 * In-memory registry backed by SQLite (installed_skills table).
 */
import {
  getInstalledSkills,
  installSkill as dbInstallSkill,
  uninstallSkill as dbUninstallSkill,
} from '../utils/db.js';
import type { SkillManifest } from './loader.js';
import { WEB_SEARCH_TOOL } from './builtin/web-search.js';

export class SkillRegistry {
  private skills: Map<string, SkillManifest>;

  constructor() {
    this.skills = new Map();
  }

  /**
   * Register built-in skills that ship with the application.
   */
  loadBuiltins(): void {
    const webSearchManifest: SkillManifest = {
      id: 'builtin-web-search',
      name: WEB_SEARCH_TOOL.name,
      version: '1.0.0',
      description: WEB_SEARCH_TOOL.description,
      author: 'ClawDesktop',
      category: 'utility',
      tools: [
        {
          name: WEB_SEARCH_TOOL.name,
          description: WEB_SEARCH_TOOL.description,
          parameters: {
            query: { type: 'string', description: 'The search query', required: true },
            max_results: { type: 'number', description: 'Maximum number of results (1-10, default 5)' },
          },
        },
      ],
    };
    this.skills.set(webSearchManifest.id, webSearchManifest);
  }

  /**
   * Load installed skills from the SQLite database into memory.
   */
  loadFromDatabase(): void {
    this.loadBuiltins();
    const rows = getInstalledSkills();
    for (const row of rows) {
      if (!row.manifest) continue;
      try {
        const manifest: unknown = JSON.parse(row.manifest);
        if (typeof manifest === 'object' && manifest !== null && 'id' in (manifest as Record<string, unknown>)) {
          this.skills.set(row.id, manifest as SkillManifest);
        }
      } catch {
        // Skip corrupted manifest entries
      }
    }
  }

  /**
   * Get all registered skills.
   */
  getAll(): SkillManifest[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get a skill by its ID.
   */
  getById(id: string): SkillManifest | undefined {
    return this.skills.get(id);
  }

  /**
   * Get skills by category.
   */
  getByCategory(category: string): SkillManifest[] {
    return this.getAll().filter((s) => s.category.toLowerCase() === category.toLowerCase());
  }

  /**
   * Search skills by name and description.
   */
  search(query: string): SkillManifest[] {
    const lower = query.toLowerCase();
    return this.getAll().filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.description.toLowerCase().includes(lower) ||
        s.id.toLowerCase().includes(lower),
    );
  }

  /**
   * Install a skill: add to in-memory registry and persist to DB.
   */
  install(manifest: SkillManifest, source: string): void {
    this.skills.set(manifest.id, manifest);
    dbInstallSkill({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      source,
      manifest: JSON.stringify(manifest),
    });
  }

  /**
   * Uninstall a skill: remove from memory and DB.
   */
  uninstall(id: string): boolean {
    const existed = this.skills.delete(id);
    if (existed) {
      dbUninstallSkill(id);
    }
    return existed;
  }

  /**
   * Get skills relevant to a specific agent type.
   * Returns all skills whose category matches the agent type,
   * plus any skills in the "utility" category (available to all agents).
   */
  getToolsForAgent(agentType: string): SkillManifest[] {
    const lowerType = agentType.toLowerCase();
    return this.getAll().filter(
      (s) =>
        s.category.toLowerCase() === lowerType ||
        s.category.toLowerCase() === 'utility',
    );
  }
}
