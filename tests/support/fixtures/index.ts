import { test as base, expect } from "@playwright/test";

/**
 * Merged fixtures for E2E tests.
 * Add project-specific fixtures here as the test suite grows.
 * When @seontechnologies/playwright-utils is installed, compose with mergeTests.
 */
export const test = base;
export { expect };
