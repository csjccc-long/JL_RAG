import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': [
      'babel-jest',
      {
        configFile: false,
        babelrc: false,
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          '@babel/preset-typescript',
          ['@babel/preset-react', { runtime: 'automatic' }],
        ],
        plugins: ['./jest/babel-plugin-vite-env.cjs'],
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^human-id$': '<rootDir>/__mocks__/human-id.js',
    '\\.(css|less|scss|sass)$': '<rootDir>/__mocks__/styleMock.js',
    '\\.(jpg|jpeg|png|gif|svg|webp)$': '<rootDir>/__mocks__/fileMock.js',
  },
  setupFilesAfterEnv: ['<rootDir>/jest-setup.ts'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx,js,jsx}',
    '!src/.umi/**',
    '!src/.umi-test/**',
    '!src/.umi-production/**',
    '!**/*.d.ts',
    '!coverage/**',
    '!dist/**',
    '!config/**',
    '!mock/**',
  ],
  coverageThreshold: {
    global: {
      lines: 1,
    },
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};

export default config;
