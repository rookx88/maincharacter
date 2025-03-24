// Existing test data
export const TEST_MEMORY = {
    title: "Test Memory",
    //...
};

// Proposed structure
export const MemoryFactory = {
    create(overrides = {}) {
        return { 
            status: 'complete',
            ...overrides
        };
    }
}; 