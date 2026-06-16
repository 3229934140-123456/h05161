const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class BuildCache {
  constructor(options = {}) {
    this.cacheDir = options.cacheDir || '.mini-bundler-cache';
    this.cacheFile = path.join(this.cacheDir, 'build-cache.json');
    this.fileTimestamps = new Map();
    this.fileHashes = new Map();
    this.moduleCache = new Map();
    this.loaded = false;
  }

  load() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }

    if (fs.existsSync(this.cacheFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.cacheFile, 'utf-8'));
        this.fileTimestamps = new Map(data.fileTimestamps || []);
        this.fileHashes = new Map(data.fileHashes || []);
        this.moduleCache = new Map(data.moduleCache || []);
        this.loaded = true;
      } catch (e) {
        console.warn(`Failed to load cache: ${e.message}`);
        this.loaded = false;
      }
    }

    return this;
  }

  save() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }

    const data = {
      version: '1.0.0',
      timestamp: Date.now(),
      fileTimestamps: Array.from(this.fileTimestamps.entries()),
      fileHashes: Array.from(this.fileHashes.entries()),
      moduleCache: Array.from(this.moduleCache.entries())
    };

    fs.writeFileSync(this.cacheFile, JSON.stringify(data, null, 2));
    return this;
  }

  getFileHash(filePath) {
    if (!fs.existsSync(filePath)) return null;

    const content = fs.readFileSync(filePath);
    return crypto
      .createHash('md5')
      .update(content)
      .digest('hex');
  }

  isFileChanged(filePath) {
    if (!fs.existsSync(filePath)) return true;

    const currentHash = this.getFileHash(filePath);
    const cachedHash = this.fileHashes.get(filePath);

    if (!cachedHash) return true;

    return currentHash !== cachedHash;
  }

  updateFileInfo(filePath) {
    if (!fs.existsSync(filePath)) return this;

    const stats = fs.statSync(filePath);
    const hash = this.getFileHash(filePath);

    this.fileTimestamps.set(filePath, stats.mtimeMs);
    this.fileHashes.set(filePath, hash);

    return this;
  }

  getCachedModule(moduleId) {
    return this.moduleCache.get(moduleId);
  }

  setCachedModule(moduleId, data) {
    this.moduleCache.set(moduleId, {
      ...data,
      cachedAt: Date.now()
    });
    return this;
  }

  invalidateModule(moduleId) {
    this.moduleCache.delete(moduleId);
    this.fileTimestamps.delete(moduleId);
    this.fileHashes.delete(moduleId);
    return this;
  }

  clear() {
    this.fileTimestamps.clear();
    this.fileHashes.clear();
    this.moduleCache.clear();

    if (fs.existsSync(this.cacheFile)) {
      fs.unlinkSync(this.cacheFile);
    }

    return this;
  }

  getChangedModules(moduleGraph) {
    const changed = [];
    const allModules = moduleGraph.getAllModules();

    for (const module of allModules) {
      if (this.isFileChanged(module.filePath)) {
        changed.push(module.filePath);
      }
    }

    return changed;
  }

  getAffectedModules(moduleGraph, changedModules) {
    const affected = new Set(changedModules);
    const visited = new Set();

    const traverse = (moduleId) => {
      if (visited.has(moduleId)) return;
      visited.add(moduleId);

      const dependents = moduleGraph.getModuleDependents(moduleId);
      for (const dep of dependents) {
        affected.add(dep);
        traverse(dep);
      }
    };

    for (const moduleId of changedModules) {
      traverse(moduleId);
    }

    return Array.from(affected);
  }

  incrementalBuild(bundler) {
    if (!this.loaded) {
      this.load();
    }

    const moduleGraph = bundler.moduleGraph;
    if (!moduleGraph) return null;

    const changedModules = this.getChangedModules(moduleGraph);

    if (changedModules.length === 0) {
      console.log('No changes detected, skipping rebuild.');
      return { changed: [], affected: [], skipped: true };
    }

    console.log(`Detected ${changedModules.length} changed file(s):`);
    changedModules.forEach(f => console.log(`  - ${path.basename(f)}`));

    const affectedModules = this.getAffectedModules(moduleGraph, changedModules);

    for (const moduleId of changedModules) {
      bundler.invalidateModule(moduleId);
      this.updateFileInfo(moduleId);
    }

    for (const moduleId of affectedModules) {
      this.invalidateModule(moduleId);
    }

    return {
      changed: changedModules,
      affected: affectedModules,
      skipped: false
    };
  }

  getStats() {
    return {
      cachedFiles: this.fileHashes.size,
      cachedModules: this.moduleCache.size,
      cacheDir: this.cacheDir
    };
  }
}

module.exports = BuildCache;
