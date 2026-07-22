const config = {
  testDir: "./",
  timeout: 120000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.DEMO_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry" as const,
    video: "on" as const,
    viewport: { width: 1920, height: 1080 },
  },
};

export default config;
