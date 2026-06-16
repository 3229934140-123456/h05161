const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MagicString = require('magic-string');

const ModuleGraph = require('./module-graph');
const Optimizer = require('./optimizer');
const CodeSplitter = require('./code-splitter');
const SourceMapBuilder = require('./source-map');

class Bundler {
  constructor(options = {}) {
    this.options = {
      entry: null,
      outputDir: 'dist',
      filename: '[name].js',
      chunkFilename: '[id].[hash].js',
      sourceMap: true,
      sourceRoot: '',
      treeshake: true,
      splitChunks: true,
      minify: false,
      publicPath: '/',
      ...options
    };

    this.moduleGraph = null;
    this.optimizer = null;
    this.codeSplitter = null;
    this.sourceMapBuilder = null;
    this.outputAssets = new Map();
    this.moduleCache = new Map();
    this.chunkIdCounter = 0;
  }

  async build() {
    const startTime = Date.now();

    this.buildModuleGraph();

    if (this.options.treeshake) {
      this.optimize();
    }

    this.splitCode();

    const result = this.generate();

    await this.writeOutput(result);

    const endTime = Date.now();
    console.log(`Build completed in ${endTime - startTime}ms`);

    return result;
  }

  buildModuleGraph() {
    this.moduleGraph = new ModuleGraph(this.options);

    const entries = Array.isArray(this.options.entry)
      ? this.options.entry
      : [this.options.entry];

    for (const entry of entries) {
      const entryPath = path.resolve(entry);
      if (fs.existsSync(entryPath)) {
        this.moduleGraph.addEntry(entryPath);
      } else {
        throw new Error(`Entry file not found: ${entryPath}`);
      }
    }

    this.moduleGraph.build();

    if (this.moduleGraph.hasCycle()) {
      const cycles = this.moduleGraph.getCycles();
      console.warn(`Warning: ${cycles.length} circular dependency(ies) detected:`);
      cycles.forEach((cycle, i) => {
        console.warn(`  Cycle ${i + 1}: ${cycle.map(p => path.basename(p)).join(' -> ')}`);
      });
    }

    return this.moduleGraph;
  }

  optimize() {
    this.optimizer = new Optimizer({
      moduleGraph: this.moduleGraph,
      treeshake: this.options.treeshake,
      sideEffects: this.options.sideEffects
    });

    this.optimizer.optimize();

    const modules = this.moduleGraph.getAllModules();
    for (const module of modules) {
      const unused = this.optimizer.getUnusedExports(module);
      if (unused.length > 0) {
        console.log(`Tree-shaking: removed ${unused.length} unused export(s) from ${path.basename(module.filePath)}`);
      }
    }

    return this.optimizer;
  }

  splitCode() {
    this.codeSplitter = new CodeSplitter({
      moduleGraph: this.moduleGraph,
      splitChunks: this.options.splitChunks,
      ...this.options
    });

    this.codeSplitter.split();

    const chunks = this.codeSplitter.getChunks();
    console.log(`Code splitting: generated ${chunks.length} chunk(s)`);
    chunks.forEach(chunk => {
      console.log(`  - ${chunk.id} (${chunk.type}, ${chunk.modules.size} modules)`);
    });

    return this.codeSplitter;
  }

  generate() {
    const result = {
      chunks: [],
      assets: new Map(),
      sourceMaps: new Map(),
      stats: {}
    };

    this.sourceMapBuilder = new SourceMapBuilder({
      sourceRoot: this.options.sourceRoot,
      outputPath: this.options.outputDir
    });

    const chunks = this.codeSplitter.getChunks();

    for (const chunk of chunks) {
      const chunkResult = this.generateChunk(chunk);
      result.chunks.push(chunkResult);
      result.assets.set(chunkResult.fileName, chunkResult.code);

      if (chunkResult.sourceMap) {
        result.sourceMaps.set(chunkResult.fileName + '.map', chunkResult.sourceMap);
      }
    }

    result.stats = this.collectStats();
    return result;
  }

  generateChunk(chunk) {
    const modules = this.codeSplitter.getChunkModules(chunk.id);
    const sortedModuleIds = this.moduleGraph.topoSort()
      .filter(id => chunk.modules.has(id));

    const modulesByChunk = {};
    modules.forEach(m => {
      modulesByChunk[m.id] = m;
    });

    const outputFile = this.codeSplitter.getChunkFiles(chunk.id, {
      outputDir: '',
      filename: this.options.filename,
      chunkFilename: this.options.chunkFilename
    })[0];

    const fileName = path.basename(outputFile);

    if (this.options.sourceMap) {
      this.sourceMapBuilder.init(chunk.id, fileName);
    }

    const s = new MagicString('');
    let currentLine = 1;

    if (chunk.type === 'initial') {
      const runtime = this.generateRuntime(chunk);
      s.append(runtime);
      currentLine += runtime.split('\n').length;
    }

    s.append(`__mini_bundler_modules__.chunks["${chunk.id}"] = {\n`);
    currentLine++;

    for (let i = 0; i < sortedModuleIds.length; i++) {
      const moduleId = sortedModuleIds[i];
      const module = modulesByChunk[moduleId];
      if (!module) continue;

      const moduleStartLine = currentLine;
      const moduleWrapper = this.wrapModule(module, moduleId, currentLine, chunk.id);

      s.append(`  "${moduleId}": ${moduleWrapper.code}`);
      currentLine += moduleWrapper.lineCount;

      if (i < sortedModuleIds.length - 1) {
        s.append(',\n');
        currentLine++;
      } else {
        s.append('\n');
        currentLine++;
      }

      if (this.options.sourceMap && moduleWrapper.sourceMap) {
        this.sourceMapBuilder.applySourceMap(chunk.id, moduleWrapper.sourceMap, module.filePath);
      }

      this.sourceMapBuilder.trackModuleOffset(
        chunk.id, moduleId,
        moduleStartLine, 2,
        currentLine - 1, 0
      );
    }

    s.append('};\n');
    currentLine++;

    if (chunk.type === 'initial' && chunk.entryModule) {
      const entryCall = `\n__mini_bundler_require__("${chunk.entryModule}");\n`;
      s.append(entryCall);
      currentLine += entryCall.split('\n').length;
    }

    if (this.options.sourceMap) {
      s.append(`\n//# sourceMappingURL=${fileName}.map\n`);
    }

    const code = s.toString();

    let sourceMap = null;
    if (this.options.sourceMap) {
      sourceMap = this.sourceMapBuilder.toString(chunk.id);
    }

    return {
      chunkId: chunk.id,
      type: chunk.type,
      fileName,
      code,
      sourceMap,
      moduleCount: sortedModuleIds.length,
      hash: chunk.hash
    };
  }

  wrapModule(module, moduleId, startLine, chunkId) {
    const source = module.optimizedSource || module.parsed?.source || '';
    const s = new MagicString('');

    s.append('function(module, exports, __mini_bundler_require__) {\n');
    s.append('  "use strict";\n');

    let currentLine = startLine + 2;
    let lineCount = 2;

    const transformedSource = this.transformImports(source, module, moduleId);
    const sourceLines = transformedSource.split('\n');

    for (let i = 0; i < sourceLines.length; i++) {
      s.append('  ' + sourceLines[i] + '\n');
      lineCount++;

      if (this.options.sourceMap) {
        const originalLine = i + 1;
        const sourceFile = path.relative(
          this.options.sourceRoot || process.cwd(),
          module.filePath
        ).replace(/\\/g, '/');

        this.sourceMapBuilder.addMapping(chunkId, {
          generatedLine: currentLine,
          generatedColumn: 2,
          originalLine,
          originalColumn: 0,
          source: sourceFile,
          name: null
        });
      }

      currentLine++;
    }

    s.append('}');
    lineCount++;

    return {
      code: s.toString(),
      lineCount,
      sourceMap: null
    };
  }

  transformImports(source, module, moduleId) {
    let result = source;

    if (module.imports) {
      for (const imp of module.imports) {
        const resolved = this.moduleGraph.parser.resolve(imp.source, module.filePath);
        const depModule = this.moduleGraph.getModule(resolved);

        if (depModule) {
          const importLine = this.generateImportStatement(imp, resolved);
          const originalImportRegex = new RegExp(
            `import\\s+[^;]*from\\s+['"]${imp.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"];?`,
            'm'
          );

          result = result.replace(originalImportRegex, importLine);
        }
      }
    }

    if (module.parsed?.dynamicImports) {
      for (const dynImp of module.parsed.dynamicImports) {
        const resolved = this.moduleGraph.parser.resolve(dynImp.source, module.filePath);
        const targetModule = this.moduleGraph.getModule(resolved);

        if (targetModule && targetModule.chunkId) {
          const dynamicImport = this.generateDynamicImport(targetModule.chunkId, resolved);
          const originalRegex = new RegExp(
            `import\\s*\\(\\s*['"]${dynImp.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*\\)`,
            'g'
          );

          result = result.replace(originalRegex, dynamicImport);
        }
      }
    }

    return result;
  }

  generateImportStatement(imp, moduleId) {
    const parts = [];

    for (const spec of imp.specifiers) {
      if (spec.type === 'ImportDefaultSpecifier') {
        parts.push(`const ${spec.local} = __mini_bundler_require__("${moduleId}").default;`);
      } else if (spec.type === 'ImportSpecifier') {
        parts.push(`const ${spec.local} = __mini_bundler_require__("${moduleId}").${spec.imported};`);
      } else if (spec.type === 'ImportNamespaceSpecifier') {
        parts.push(`const ${spec.local} = __mini_bundler_require__("${moduleId}");`);
      }
    }

    return parts.join('\n');
  }

  generateDynamicImport(chunkId, moduleId) {
    return `__mini_bundler_load_chunk__("${chunkId}").then(function() { return __mini_bundler_require__("${moduleId}"); })`;
  }

  generateRuntime(chunk) {
    const publicPath = this.options.publicPath;
    const allChunks = this.codeSplitter.getChunks();
    const asyncChunks = this.codeSplitter.getAsyncChunks();

    const chunkFiles = {};
    for (const c of allChunks) {
      const files = this.codeSplitter.getChunkFiles(c.id, {
        filename: this.options.filename,
        chunkFilename: this.options.chunkFilename
      });
      chunkFiles[c.id] = path.basename(files[0]);
    }

    return `(function() {
  var __mini_bundler_modules__ = {
    installedModules: {},
    chunks: {},
    installedChunks: {
      "${chunk.id}": 0
    }
  };

  function __mini_bundler_require__(moduleId) {
    if (__mini_bundler_modules__.installedModules[moduleId]) {
      return __mini_bundler_modules__.installedModules[moduleId].exports;
    }

    var module = __mini_bundler_modules__.installedModules[moduleId] = {
      i: moduleId,
      l: false,
      exports: {}
    };

    var chunk = __mini_bundler_modules__.chunks[Object.keys(__mini_bundler_modules__.chunks)[0]];
    for (var c in __mini_bundler_modules__.chunks) {
      if (__mini_bundler_modules__.chunks[c][moduleId]) {
        chunk = __mini_bundler_modules__.chunks[c];
        break;
      }
    }

    if (chunk && chunk[moduleId]) {
      chunk[moduleId].call(module.exports, module, module.exports, __mini_bundler_require__);
    }

    module.l = true;
    return module.exports;
  }

  __mini_bundler_require__.m = __mini_bundler_modules__.chunks;
  __mini_bundler_require__.c = __mini_bundler_modules__.installedModules;

  __mini_bundler_require__.d = function(exports, name, getter) {
    if (!__mini_bundler_require__.o(exports, name)) {
      Object.defineProperty(exports, name, { enumerable: true, get: getter });
    }
  };

  __mini_bundler_require__.r = function(exports) {
    if (typeof Symbol !== 'undefined' && Symbol.toStringTag) {
      Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    }
    Object.defineProperty(exports, '__esModule', { value: true });
  };

  __mini_bundler_require__.o = function(object, property) {
    return Object.prototype.hasOwnProperty.call(object, property);
  };

  var chunkFiles = ${JSON.stringify(chunkFiles)};
  var publicPath = "${publicPath}";

  __mini_bundler_require__.e = __mini_bundler_load_chunk__;

  function __mini_bundler_load_chunk__(chunkId) {
    var installedChunkData = __mini_bundler_modules__.installedChunks[chunkId];

    if (installedChunkData === 0) {
      return Promise.resolve();
    }

    if (installedChunkData) {
      return installedChunkData[2];
    }

    var promise = new Promise(function(resolve, reject) {
      installedChunkData = __mini_bundler_modules__.installedChunks[chunkId] = [resolve, reject];
    });

    installedChunkData[2] = promise;

    var script = document.createElement('script');
    script.charset = 'utf-8';
    script.timeout = 120;

    script.src = publicPath + chunkFiles[chunkId];

    var onScriptComplete = function(event) {
      script.onerror = script.onload = null;
      clearTimeout(timeout);

      var chunk = __mini_bundler_modules__.installedChunks[chunkId];
      if (chunk !== 0) {
        if (chunk) {
          var errorType = event && (event.type === 'load' ? 'missing' : event.type);
          var realSrc = event && event.target && event.target.src;
          var error = new Error('Loading chunk ' + chunkId + ' failed.\\n(' + errorType + ': ' + realSrc + ')');
          error.type = errorType;
          error.request = realSrc;
          chunk[1](error);
        }
        __mini_bundler_modules__.installedChunks[chunkId] = undefined;
      }
    };

    var timeout = setTimeout(function() {
      onScriptComplete({ type: 'timeout', target: script });
    }, 120000);

    script.onerror = script.onload = onScriptComplete;
    document.head.appendChild(script);

    return promise;
  }
})();

`;
  }

  async writeOutput(result) {
    const outputDir = path.resolve(this.options.outputDir);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    for (const [fileName, content] of result.assets) {
      const filePath = path.join(outputDir, fileName);
      fs.writeFileSync(filePath, content, 'utf-8');
      console.log(`Output: ${filePath}`);
      this.outputAssets.set(fileName, filePath);
    }

    if (this.options.sourceMap) {
      for (const [fileName, content] of result.sourceMaps) {
        const filePath = path.join(outputDir, fileName);
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`SourceMap: ${filePath}`);
      }
    }
  }

  collectStats() {
    const modules = this.moduleGraph.getAllModules();
    const chunks = this.codeSplitter.getChunks();

    let totalOriginalSize = 0;
    let totalOptimizedSize = 0;

    for (const module of modules) {
      if (module.parsed?.source) {
        totalOriginalSize += module.parsed.source.length;
      }
      if (module.optimizedSource) {
        totalOptimizedSize += module.optimizedSource.length;
      } else if (module.parsed?.source) {
        totalOptimizedSize += module.parsed.source.length;
      }
    }

    return {
      moduleCount: modules.length,
      chunkCount: chunks.length,
      entryCount: this.moduleGraph.entries.size,
      hasCycle: this.moduleGraph.hasCycle(),
      cycles: this.moduleGraph.getCycles().length,
      totalOriginalSize,
      totalOptimizedSize,
      treeshakingSaved: totalOriginalSize - totalOptimizedSize
    };
  }

  invalidateModule(filePath) {
    const absolutePath = path.resolve(filePath);
    this.moduleGraph.rebuildModule(absolutePath);
    this.moduleCache.delete(absolutePath);

    if (this.options.treeshake) {
      this.optimizer.optimize();
    }

    this.codeSplitter.split();

    return this;
  }

  rebuildModule(filePath) {
    this.invalidateModule(filePath);
    return this.build();
  }

  getStats() {
    return this.collectStats();
  }

  getOutputAssets() {
    return this.outputAssets;
  }
}

module.exports = Bundler;
