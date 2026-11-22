import StyleDictionary from 'style-dictionary';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

StyleDictionary.registerTransform({
  name: 'color/css-hex',
  type: 'value',
  matcher: (token) => token.type === 'color',
  transformer: (token) => token.value,
});

const sd = new StyleDictionary({
  source: ['tokens/tokens.json'],
  platforms: {
    css: {
      transformGroup: 'css',
      buildPath: 'src/styles/',
      files: [
        {
          destination: 'tokens.css',
          format: 'css/variables',
          options: {
            selector: ':root',
            prefix: 'token-',
          },
        },
      ],
    },
    ts: {
      transformGroup: 'js',
      buildPath: 'src/styles/',
      files: [
        {
          destination: 'tokens.ts',
          format: 'typescript/module-deep',
          options: {
            prefix: 'token',
          },
        },
      ],
    },
  },
});

sd.buildAllPlatforms();
console.log('✅ Design tokens built to src/styles/tokens.css and src/styles/tokens.ts');