module.exports = async function run(remotePath) {
  await __webpack_init_sharing__('default');
  const container = __non_webpack_require__(remotePath);
  await container.init(__webpack_share_scopes__.default);
  const versions = Object.fromEntries(Object.entries(__webpack_share_scopes__.default.lib).map(([v, e]) => [v, { from: e.from, eager: !!e.eager }]));
  console.log('share scope lib:', JSON.stringify(versions));
  try {
    const late = await import('./late');
    console.log('OK:', late.default || late);
  } catch (e) {
    console.log('FAIL:', e.message);
  }
  const exposed = (await container.get('./exposed'))();
  console.log('remote:', exposed());
};
