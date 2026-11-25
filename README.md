# rspack: Module Federation eager consumes pick non-eager share scope entries

Minimal reproduction: rspack selects a **non-eager** remote version of a shared module for the host's **eager** consume. webpack (>= 5.93.0) does not.

As a result:

- sync (initial) host consume throws `Shared module is not available for eager consumption`;
- async host consume silently switches the host to the remote's instance of the shared module.

## Quick start

Requires Node.js >= 18.

```sh
npm install
npm run all
```

`npm run all` builds and runs every scenario one by one. Each scenario can be run separately:

| Script | Bundler | Host consume of `lib` | Expected | Actual |
| --- | --- | --- | --- | --- |
| `npm run webpack` | webpack 5.101.1 | sync (single chunk) | `lib@1.0.0` | `lib@1.0.0` ✅ |
| `npm run rspack` | rspack 1.7.5 | sync (single chunk) | `lib@1.0.0` | **throws** ❌ |
| `npm run webpack:async` | webpack 5.101.1 | async (separate chunk) | `lib@1.0.0` | `lib@1.0.0` ✅ |
| `npm run rspack:async` | rspack 1.7.5 | async (separate chunk) | `lib@1.0.0` | **`lib@1.2.0`** ❌ |
| `npm run rspack:pin` | rspack 1.7.5 | sync + workaround | `lib@1.0.0` | `lib@1.0.0` ✅ |
| `npm run rspack:async:pin` | rspack 1.7.5 | async + workaround | `lib@1.0.0` | `lib@1.0.0` ✅ |

## What is inside

```
host/
  index.js               host entry: inits sharing, inits the remote container, then imports ./late
  late.js                host module consuming `lib`, required only after the remote is initialized
  node_modules/lib       lib@1.0.0, shared by the host with `eager: true`
remote/
  exposed.js             exposed module consuming `lib`
  node_modules/lib       lib@1.2.0, shared by the remote with `eager: false`
build.js                 builds host and remote with the bundler from argv (`webpack` | `rspack`)
run.js                   runs the built host: node dist/<bundler>/host/host.js
```

Both `lib` packages are just `module.exports = { version: '<version>' }`. Host and remote require `lib@^1.0.0`, so both versions satisfy both consumers.

Both builds are `target: 'node'` with `ModuleFederationPlugin` (`ModuleFederationPluginV1` for rspack). `build.js` options, set with env variables:

- default: the host build has `LimitChunkCountPlugin({ maxChunks: 1 })` (as in typical SSR server builds), so `import('./late')` is merged into the main chunk and the `lib` consume is **initial (sync)**;
- `ASYNC=1`: no `LimitChunkCountPlugin`, `late.js` is a separate chunk and the `lib` consume is **async** (loaded with the chunk);
- `PIN=1`: workaround, the host `shared.lib.requiredVersion` is pinned to the installed version (`1.0.0`).

## How to read the output

```
### rspack
share scope lib: {"1.0.0":{"from":"host","eager":true},"1.2.0":{"from":"remote","eager":false}}
FAIL: Shared module is not available for eager consumption: webpack/sharing/consume/default/lib/lib
remote: remote uses lib@1.2.0
```

1. `share scope lib` - entries of `__webpack_share_scopes__.default.lib` after `container.init()` of the remote. It is the same for all scenarios: host `1.0.0` (eager) and remote `1.2.0` (non-eager, its `get()` returns a Promise).
2. `OK: host uses lib@...` / `FAIL: ...` - what `host/late.js` got for `require('lib')`. **This is the line to look at.**
   - `OK: host uses lib@1.0.0` - correct, the host uses its own eager instance;
   - `FAIL: ... eager consumption` - sync consume selected `1.2.0` and got a Promise instead of a factory;
   - `OK: host uses lib@1.2.0` - no error, but the host switched to the remote's instance, so now there are two `lib` instances in the host.
3. `remote: remote uses lib@1.2.0` - the remote consume, `1.2.0` is expected for it (the highest satisfying version) in all scenarios.

## Where to look in the generated code

After `npm run webpack` / `npm run rspack` the bundles are in `dist/<bundler>/host/host.js`:

```sh
# webpack: eager consumes are resolved only between eager entries
npm run -s webpack >/dev/null; grep -n "eagerOnly" dist/webpack/host/host.js

# rspack: no eager filter, all entries are compared
npm run -s rspack >/dev/null; grep -n -A6 "var findValidVersion" dist/rspack/host/host.js
grep -n "consumesLoadingData = " dist/rspack/host/host.js   # `eager: true` is in consume data, but is not used
```

## Root cause

webpack fixed this in [webpack/webpack#18062](https://github.com/webpack/webpack/pull/18062) "fix: Consumption of eager shared modules", released in webpack **5.93.0** (background: [webpack discussion #18001](https://github.com/orgs/webpack/discussions/18001)). The fix has not been ported to rspack (checked 1.7.5, 1.7.12, 2.3.2 and `main` @ f9a8ef3).

In webpack, when the consume is `eager`, the version is selected only from **eager** share scope entries:

```js
// webpack/lib/sharing/ConsumeSharedRuntimeModule.js (>= 5.93.0)
var findSatisfyingVersion = function(scope, key, requiredVersion, eager) {
  var versions = eager ? eagerOnly(scope[key]) : scope[key];
  ...
```

In rspack, `consume_shared_runtime_module.rs` already passes `eager` into the consume data, but `consumesCommon.ejs` ignores it and selects from all entries:

```js
// crates/rspack_plugin_mf/src/sharing/consumesCommon.ejs
var findValidVersion = function(scope, key, requiredVersion) {
  var versions = scope[key];
  ...
```

## Suggested fix

Port webpack#18062: add `eagerOnly` and pass `data.eager` to `findValidVersion` / `findVersion` / `findSingletonVersionKey` (and the `init` wrapper), plus the webpack test cases `configCases/container/eager-shared` and `configCases/container/0-eager-shared`.

## Workaround

Pin `requiredVersion` of the host shared modules to the installed versions (see `PIN=1` in `build.js`). Remote consumes are not affected. Limitation: `requiredVersion` applies to all host consumers of the shared key, so nested copies of the package with other versions in the host dependencies tree are pinned too.
