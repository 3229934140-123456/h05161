const path = require('path');
const DependencyParser = require('./parser');

class ModuleNode {
  constructor(filePath, parsed) {
    this.id = filePath;
    this.filePath = filePath;
    this.parsed = parsed;
    this.dependencies = new Set();
    this.dependents = new Set();
    this.dynamicDependencies = new Set();
    this.isEntry = false;
    this.isDynamicEntry = false;
    this.visited = false;
    this.processed = false;
    this.chunkId = null;
    this.exports = parsed ? parsed.exports : [];
    this.imports = parsed ? parsed.imports : [];
    this.usedExports = new Set();
    this.sideEffects = true;
    this.hash = null;
  }

  addDependency(depId) {
    this.dependencies.add(depId);
  }

  addDependent(depId) {
    this.dependents.add(depId);
  }

  addDynamicDependency(depId) {
    this.dynamicDependencies.add(depId);
  }
}

class ModuleGraph {
  constructor(options = {}) {
    this.parser = new DependencyParser(options);
    this.modules = new Map();
    this.entries = new Set();
    this.dynamicEntries = new Set();
    this.cycleChains = [];
    this.resolutionCache = new Map();
  }

  addEntry(filePath) {
    const absolutePath = path.resolve(filePath);
    this.entries.add(absolutePath);
    return absolutePath;
  }

  build() {
    for (const entry of this.entries) {
      this.processModule(entry, null, new Set(), new Set(), false);
    }
    this.detectCycles();
    return this;
  }

  processModule(filePath, fromModule, visited, recursionStack, isDynamic) {
    if (this.resolutionCache.has(filePath)) {
      return this.resolutionCache.get(filePath);
    }

    if (recursionStack.has(filePath)) {
      const cyclePath = Array.from(recursionStack);
      cyclePath.push(filePath);
      this.cycleChains.push(cyclePath);
      return filePath;
    }

    if (visited.has(filePath) && this.modules.has(filePath)) {
      if (fromModule) {
        const module = this.modules.get(filePath);
        const from = this.modules.get(fromModule);
        if (module && from) {
          if (isDynamic) {
            from.addDynamicDependency(filePath);
          } else {
            from.addDependency(filePath);
          }
          module.addDependent(fromModule);
        }
      }
      return filePath;
    }

    visited.add(filePath);
    recursionStack.add(filePath);

    let parsed;
    try {
      parsed = this.parser.parse(filePath);
    } catch (e) {
      console.warn(`Warning: Failed to parse ${filePath}: ${e.message}`);
      recursionStack.delete(filePath);
      return filePath;
    }

    const module = new ModuleNode(filePath, parsed);
    module.isEntry = this.entries.has(filePath);
    module.isDynamicEntry = isDynamic;
    if (isDynamic) {
      this.dynamicEntries.add(filePath);
    }
    this.modules.set(filePath, module);

    for (const imp of parsed.imports) {
      const resolved = this.parser.resolve(imp.source, filePath);
      if (resolved) {
        const depPath = this.processModule(resolved, filePath, visited, new Set(recursionStack), false);
        if (depPath) {
          module.addDependency(depPath);
          if (this.modules.has(depPath)) {
            this.modules.get(depPath).addDependent(filePath);
          }
        }
      }
    }

    for (const dynImp of parsed.dynamicImports) {
      const resolved = this.parser.resolve(dynImp.source, filePath);
      if (resolved) {
        const depPath = this.processModule(resolved, filePath, visited, new Set(recursionStack), true);
        if (depPath) {
          module.addDynamicDependency(depPath);
          if (this.modules.has(depPath)) {
            this.modules.get(depPath).addDependent(filePath);
          }
        }
      }
    }

    recursionStack.delete(filePath);
    this.resolutionCache.set(filePath, filePath);
    return filePath;
  }

  detectCycles() {
    this.cycleChains = [];
    const visited = new Set();
    const recursionStack = new Set();

    const dfs = (moduleId) => {
      if (recursionStack.has(moduleId)) {
        const cyclePath = Array.from(recursionStack);
        cyclePath.push(moduleId);
        this.cycleChains.push(cyclePath);
        return;
      }

      if (visited.has(moduleId)) return;

      visited.add(moduleId);
      recursionStack.add(moduleId);

      const module = this.modules.get(moduleId);
      if (module) {
        for (const dep of module.dependencies) {
          dfs(dep);
        }
      }

      recursionStack.delete(moduleId);
    };

    for (const entry of this.entries) {
      dfs(entry);
    }

    return this.cycleChains;
  }

  hasCycle() {
    return this.cycleChains.length > 0;
  }

  topoSort() {
    const result = [];
    const visited = new Set();
    const temp = new Set();
    const hasCycle = { value: false };

    const dfs = (moduleId) => {
      if (temp.has(moduleId)) {
        hasCycle.value = true;
        return;
      }
      if (visited.has(moduleId)) return;

      temp.add(moduleId);
      const module = this.modules.get(moduleId);

      if (module) {
        for (const dep of module.dependencies) {
          dfs(dep);
        }
      }

      temp.delete(moduleId);
      visited.add(moduleId);
      result.push(moduleId);
    };

    const moduleIds = Array.from(this.modules.keys());
    for (const moduleId of moduleIds) {
      if (!visited.has(moduleId)) {
        dfs(moduleId);
      }
    }

    if (hasCycle.value) {
      return this.topoSortWithCycles();
    }

    return result;
  }

  topoSortWithCycles() {
    const inDegree = new Map();
    const result = [];
    const queue = [];

    for (const [id, module] of this.modules) {
      inDegree.set(id, module.dependents.size);
      if (module.dependents.size === 0) {
        queue.push(id);
      }
    }

    const tempDependencies = new Map();
    for (const [id, module] of this.modules) {
      tempDependencies.set(id, new Set(module.dependencies));
    }

    while (queue.length > 0) {
      const node = queue.shift();
      result.unshift(node);

      for (const dep of tempDependencies.get(node) || []) {
        const deps = tempDependencies.get(dep);
        if (deps) {
          deps.delete(node);
          if (deps.size === 0) {
            queue.push(dep);
          }
        }
      }
    }

    for (const [id] of this.modules) {
      if (!result.includes(id)) {
        result.push(id);
      }
    }

    return result;
  }

  getModule(filePath) {
    return this.modules.get(filePath);
  }

  getAllModules() {
    return Array.from(this.modules.values());
  }

  getEntryModules() {
    return Array.from(this.entries).map(id => this.modules.get(id)).filter(Boolean);
  }

  getDynamicEntryModules() {
    return Array.from(this.dynamicEntries).map(id => this.modules.get(id)).filter(Boolean);
  }

  getModuleDependencies(moduleId) {
    const module = this.modules.get(moduleId);
    return module ? Array.from(module.dependencies) : [];
  }

  getModuleDependents(moduleId) {
    const module = this.modules.get(moduleId);
    return module ? Array.from(module.dependents) : [];
  }

  getCycles() {
    return this.cycleChains;
  }

  invalidateModule(filePath) {
    const absolutePath = path.resolve(filePath);
    this.resolutionCache.delete(absolutePath);

    const module = this.modules.get(absolutePath);
    if (module) {
      for (const dep of module.dependencies) {
        const depModule = this.modules.get(dep);
        if (depModule) {
          depModule.dependents.delete(absolutePath);
        }
      }
      for (const dependent of module.dependents) {
        const depModule = this.modules.get(dependent);
        if (depModule) {
          depModule.dependencies.delete(absolutePath);
          depModule.dynamicDependencies.delete(absolutePath);
        }
      }
      this.modules.delete(absolutePath);
    }

    this.dynamicEntries.delete(absolutePath);

    return this;
  }

  rebuildModule(filePath) {
    this.invalidateModule(filePath);
    const absolutePath = path.resolve(filePath);

    const isEntry = this.entries.has(absolutePath);
    const dependents = this.getModuleDependents(absolutePath);

    if (isEntry) {
      this.processModule(absolutePath, null, new Set(), new Set(), false);
    }

    for (const dependent of dependents) {
      const depModule = this.modules.get(dependent);
      if (depModule && depModule.parsed) {
        for (const imp of depModule.parsed.imports) {
          const resolved = this.parser.resolve(imp.source, dependent);
          if (resolved === absolutePath) {
            this.processModule(absolutePath, dependent, new Set(), new Set(), false);
            break;
          }
        }
        for (const dynImp of depModule.parsed.dynamicImports) {
          const resolved = this.parser.resolve(dynImp.source, dependent);
          if (resolved === absolutePath) {
            this.processModule(absolutePath, dependent, new Set(), new Set(), true);
            break;
          }
        }
      }
    }

    this.detectCycles();
    return this;
  }
}

module.exports = ModuleGraph;
