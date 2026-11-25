const path = require('path');
const bundler = process.argv[2];
const lib = bundler === 'rspack' ? require('@rspack/core') : require('webpack');
const MF = bundler === 'rspack' ? lib.container.ModuleFederationPluginV1 : lib.container.ModuleFederationPlugin;
const common = (dir) => ({ mode: 'development', devtool: false, target: 'node', context: path.join(__dirname, dir), optimization: { minimize: false } });
// ASYNC=1 - do not merge chunks, `import('./late')` becomes a separate chunk with async consume
// PIN=1 - workaround, pin host `requiredVersion` to the installed `lib` version
const ASYNC = process.env.ASYNC === '1';
const PIN = process.env.PIN === '1';
const hostLib = { eager: true, ...(PIN ? { requiredVersion: require('./host/node_modules/lib/package.json').version } : {}) };
const out = path.join(__dirname, 'dist', bundler);
const configs = [
  { ...common('remote'), name: 'remote', entry: './index.js',
    output: { path: path.join(out, 'remote'), filename: 'remote.js', library: { type: 'commonjs2' }, uniqueName: 'remote' },
    plugins: [new MF({ name: 'remote', library: { type: 'commonjs2' }, filename: 'remoteEntry.js', exposes: { './exposed': './exposed.js' }, shared: { lib: { eager: false } } })] },
  { ...common('host'), name: 'host', entry: './index.js',
    output: { path: path.join(out, 'host'), filename: 'host.js', library: { type: 'commonjs2' }, uniqueName: 'host' },
    plugins: [new MF({ name: 'host', shared: { lib: hostLib } }), ...(ASYNC ? [] : [new lib.optimize.LimitChunkCountPlugin({ maxChunks: 1 })])] },
];
lib(configs, (err, stats) => {
  if (err) throw err;
  if (stats.hasErrors()) { console.log(stats.toString('errors-only')); process.exit(1); }
  console.log(bundler, 'built');
});
