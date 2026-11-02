/** @type {import('jest').Config} */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { useESM: true }],
  },
  extensionsToTreatAsEsm: [".ts"],
  moduleFileExtensions: ["ts", "js", "json", "node"],
  // Co-located unit tests under src/, fixture-driven acceptance tests under test/
  setupFiles: ["<rootDir>/test/setup-env.ts"],
  testMatch: ["<rootDir>/src/**/*.test.ts", "<rootDir>/test/**/*.test.ts"],
  collectCoverage: false,
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.test.ts",
    // Bootstrap / infra wiring with no unit logic
    "!src/server.ts",
    "!src/migrate.ts",
    "!src/scripts/**",
    "!src/app.ts",
    "!src/config/**",
  ],
  coverageDirectory: "coverage",
  // Source imports say ".ts"; ts-jest compiles with rewriteRelativeImportExtensions, so the compiled
  // test asks for ".js". Point those back at the .ts source.
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};
