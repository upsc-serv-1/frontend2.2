const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Force Metro to resolve modules from the root node_modules
config.resolver.nodeModulesPaths = [
  require('path').resolve(__dirname, 'node_modules'),
];

module.exports = config;
