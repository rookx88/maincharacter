import '@testing-library/jest-dom';
import 'jest-canvas-mock';  // Add this for canvas operations

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}; 