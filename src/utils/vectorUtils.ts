export function similarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) {
        throw new Error('Vectors must be of same length');
    }
    
    const dotProduct = vec1.reduce((acc, val, i) => acc + val * vec2[i], 0);
    const mag1 = Math.sqrt(vec1.reduce((acc, val) => acc + val * val, 0));
    const mag2 = Math.sqrt(vec2.reduce((acc, val) => acc + val * val, 0));
    
    return dotProduct / (mag1 * mag2);
} 