/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads this config through CommonJS. */
const packageJson = require("../package.json");

const baseConfig = packageJson.build;
const developmentBuild = process.env.TASKFISH_DEV_BUILD === "1";

module.exports = {
  ...baseConfig,
  extraResources: developmentBuild ? [] : baseConfig.extraResources,
};
