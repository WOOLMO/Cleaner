import type { CleanerApi } from "./types";
import { mockApi } from "./mock";

// The real engine through the preload bridge, or sample data in demo mode and in a plain browser.
export const api: CleanerApi = window.cleaner ?? mockApi;
export const isDemo = !window.cleaner;
