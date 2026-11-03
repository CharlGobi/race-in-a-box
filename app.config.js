// Lets the GitHub Pages build live under /<repo-name>/ while local builds stay at /.
module.exports = ({ config }) => ({
  ...config,
  experiments: { ...config.experiments, baseUrl: process.env.EXPO_BASE_URL || '' },
});
