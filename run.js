const path = require('path');
const bundler = process.argv[2];
const run = require(path.join(__dirname, 'dist', bundler, 'host', 'host.js'));
(run.default || run)(path.join(__dirname, 'dist', bundler, 'remote', 'remoteEntry.js'));
