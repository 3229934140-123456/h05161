const path = require('path');
const crypto = require('crypto');

class Chunk {
  constructor(id, type = 'initial') {
    this.id = id;
    this.type = type;
    this.modules = new Set();
    this.entryModule = null;
    this.files = [];
    this.size = 0;
    this.hash = null;
  }

  addModule(moduleId) {
    this.modules.add(moduleId);
  }

  removeModule(moduleId) {
    this.modules.delete(moduleId);
  }

  hasModule(moduleId) {
    return this.modules.has(moduleId);
  }
}

class CodeSplitter {
  constructor(options = {}) {
    this.moduleGraph = options.moduleGraph;
    this.chunks = new Map();
    this.chunkGraph = new Map();
    this.moduleToChunks = new Map();
    this.splitChunks = options.splitChunks !== false;
    this.minChunkSize = options.minChunkSize || 1000;
    this.maxAsyncRequests = options.maxAsyncRequests || 5;
    this.maxInitialRequests = options.maxInitialRequests || 3;
  }

  split() {
    if (!this.moduleGraph) return this;

    this.createInitialChunks();

    if (this.splitChunks) {
      this.createAsyncChunks();
      this.extractCommonChunks();
    }

    this.assignModulesToChunks();
    this.generateChunkHashes();

    return this;
  }

  createInitialChunks() {
    const entryModules = this.moduleGraph.getEntryModules();

    entryModules.forEach((module, index) => {
      const chunkId = module.isEntry ? `main` : `chunk-${index}`;
      const chunk = new Chunk(chunkId, 'initial');
      chunk.entryModule = module.id;
      this.chunks.set(chunkId, chunk);

      module.chunkId = chunkId;
      this.chunkGraph.set(module.id, new Set([chunkId]));
    });
  }

  createAsyncChunks() {
    const dynamicEntryModules = this.moduleGraph.getDynamicEntryModules();
    const allModules = this.moduleGraph.getAllModules();

    const dynamicImportMap = new Map();

    for (const module of allModules) {
      if (module.parsed && module.parsed.dynamicImports) {
        for (const dynImp of module.parsed.dynamicImports) {
          const resolved = this.moduleGraph.parser.resolve(dynImp.source, module.filePath);
          const targetModule = this.moduleGraph.getModule(resolved);

          if (targetModule) {
            if (!dynamicImportMap.has(resolved)) {
              dynamicImportMap.set(resolved, []);
            }
            dynamicImportMap.get(resolved).push({
              from: module.id,
              import: dynImp,
              target: resolved
            });
          }
        }
      }
    }

    let chunkIndex = 0;
    for (const [targetId, imports] of dynamicImportMap) {
      const targetModule = this.moduleGraph.getModule(targetId);
      if (!targetModule) continue;

      const chunkId = `async-chunk-${chunkIndex++}`;
      const chunk = new Chunk(chunkId, 'async');
      chunk.entryModule = targetId;

      const dependentChunks = new Set();
      for (const imp of imports) {
        const fromChunks = this.chunkGraph.get(imp.from);
        if (fromChunks) {
          for (const c of fromChunks) {
            dependentChunks.add(c);
          }
        }
      }

      chunk.dependentChunks = Array.from(dependentChunks);
      targetModule.chunkId = chunkId;

      this.chunks.set(chunkId, chunk);
      this.chunkGraph.set(targetId, new Set([chunkId]));
    }
  }

  extractCommonChunks() {
    const moduleUsage = new Map();

    for (const module of this.moduleGraph.getAllModules()) {
      if (module.isEntry || module.isDynamicEntry) continue;

      const chunks = this.getModuleChunks(module);
      if (chunks.length >= 2) {
        moduleUsage.set(module.id, chunks.length);
      }
    }

    const commonModules = Array.from(moduleUsage.entries())
      .filter(([id, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1]);

    if (commonModules.length > 0) {
      const vendorChunk = new Chunk('vendors', 'initial');

      for (const [moduleId] of commonModules) {
        const module = this.moduleGraph.getModule(moduleId);
        if (module && !module.isEntry && !module.isDynamicEntry) {
          vendorChunk.addModule(moduleId);
          module.chunkId = 'vendors';

          if (!this.chunkGraph.has(moduleId)) {
            this.chunkGraph.set(moduleId, new Set());
          }
          this.chunkGraph.get(moduleId).add('vendors');
        }
      }

      if (vendorChunk.modules.size > 0) {
        this.chunks.set('vendors', vendorChunk);
      }
    }
  }

  getModuleChunks(module) {
    if (!module) return [];

    const visited = new Set();
    const chunks = new Set();

    const traverse = (moduleId) => {
      if (visited.has(moduleId)) return;
      visited.add(moduleId);

      const moduleChunks = this.chunkGraph.get(moduleId);
      if (moduleChunks) {
        for (const chunk of moduleChunks) {
          chunks.add(chunk);
        }
      }

      const dependents = this.moduleGraph.getModuleDependents(moduleId);
      for (const dep of dependents) {
        traverse(dep);
      }
    };

    traverse(module.id);
    return Array.from(chunks);
  }

  assignModulesToChunks() {
    const sortedModules = this.moduleGraph.topoSort();

    for (const moduleId of sortedModules) {
      const module = this.moduleGraph.getModule(moduleId);
      if (!module) continue;

      if (!module.chunkId) {
        const entry = this.findNearestEntry(moduleId, new Set());
        if (entry) {
          const entryModule = this.moduleGraph.getModule(entry);
          if (entryModule && entryModule.chunkId) {
            module.chunkId = entryModule.chunkId;
          } else {
            module.chunkId = 'main';
          }
        } else {
          module.chunkId = 'main';
        }
      }

      if (!this.chunks.has(module.chunkId)) {
        const chunk = new Chunk(module.chunkId, module.isDynamicEntry ? 'async' : 'initial');
        this.chunks.set(module.chunkId, chunk);
      }

      const chunk = this.chunks.get(module.chunkId);
      chunk.addModule(moduleId);

      if (!this.chunkGraph.has(moduleId)) {
        this.chunkGraph.set(moduleId, new Set());
      }
      this.chunkGraph.get(moduleId).add(module.chunkId);

      if (!this.moduleToChunks.has(moduleId)) {
        this.moduleToChunks.set(moduleId, new Set());
      }
      this.moduleToChunks.get(moduleId).add(module.chunkId);
    }

    for (const [chunkId, chunk] of this.chunks) {
      if (!chunk.entryModule) {
        const modules = Array.from(chunk.modules);
        for (const moduleId of modules) {
          const module = this.moduleGraph.getModule(moduleId);
          if (module && (module.isEntry || module.isDynamicEntry)) {
            chunk.entryModule = moduleId;
            break;
          }
        }
      }
    }
  }

  findNearestEntry(moduleId, visited) {
    if (visited.has(moduleId)) return null;
    visited.add(moduleId);

    const module = this.moduleGraph.getModule(moduleId);
    if (!module) return null;

    if (module.isEntry || module.isDynamicEntry) {
      return moduleId;
    }

    for (const dependent of module.dependents) {
      const result = this.findNearestEntry(dependent, new Set(visited));
      if (result) return result;
    }

    return null;
  }

  generateChunkHashes() {
    for (const [chunkId, chunk] of this.chunks) {
      let content = '';
      const sortedModules = Array.from(chunk.modules).sort();

      for (const moduleId of sortedModules) {
        const module = this.moduleGraph.getModule(moduleId);
        if (module) {
          content += module.optimizedSource || module.parsed?.source || '';
        }
      }

      const hash = crypto
        .createHash('md5')
        .update(content)
        .digest('hex')
        .substring(0, 8);

      chunk.hash = hash;
    }
  }

  getChunk(chunkId) {
    return this.chunks.get(chunkId);
  }

  getChunks() {
    return Array.from(this.chunks.values());
  }

  getInitialChunks() {
    return this.getChunks().filter(c => c.type === 'initial');
  }

  getAsyncChunks() {
    return this.getChunks().filter(c => c.type === 'async');
  }

  getModuleChunkIds(moduleId) {
    const chunks = this.moduleToChunks.get(moduleId);
    return chunks ? Array.from(chunks) : [];
  }

  getChunkModules(chunkId) {
    const chunk = this.chunks.get(chunkId);
    if (!chunk) return [];
    return Array.from(chunk.modules)
      .map(id => this.moduleGraph.getModule(id))
      .filter(Boolean);
  }

  getChunkFiles(chunkId, options = {}) {
    const chunk = this.chunks.get(chunkId);
    if (!chunk) return [];

    const outputDir = options.outputDir || '';
    const filename = options.filename || '[name].js';
    const chunkFilename = options.chunkFilename || '[id].[hash].js';

    let fileName;
    if (chunk.type === 'initial') {
      fileName = filename
        .replace('[name]', chunk.id)
        .replace('[hash]', chunk.hash || '');
    } else {
      fileName = chunkFilename
        .replace('[name]', chunk.id)
        .replace('[id]', chunk.id)
        .replace('[hash]', chunk.hash || '');
    }

    return [path.join(outputDir, fileName)];
  }
}

module.exports = CodeSplitter;
