// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    rules: {
      // eslint-plugin-react-hooks v6 (new in SDK 57) added an `immutability` rule that
      // false-positives on Reanimated shared-value writes (`sharedValue.value = ...`),
      // which are the library's intended API. Reanimated is a core dependency here.
      'react-hooks/immutability': 'off',
    },
  },
]);
