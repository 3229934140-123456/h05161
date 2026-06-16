const Bundler = require('./bundler');
const DependencyParser = require('./parser');
const ModuleGraph = require('./module-graph');
const Optimizer = require('./optimizer');
const CodeSplitter = require('./code-splitter');
const SourceMapBuilder = require('./source-map');
const BuildCache = require('./cache');

module.exports = {
  Bundler,
  DependencyParser,
  ModuleGraph,
  Optimizer,
  CodeSplitter,
  SourceMapBuilder,
  BuildCache,

  build: async function(options) {
    const bundler = new Bundler(options);
    return bundler.build();
  }
};
