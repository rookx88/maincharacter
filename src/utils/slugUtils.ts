export function generateSlug(name: string, existingSlugs: string[]): string {
    const baseSlug = name
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, '') // Remove special chars
        .replace(/\s+/g, '-')       // Spaces to hyphens
        .replace(/-+/g, '-')        // Collapse multiple hyphens
        .substring(0, 50);           // Limit length

    let finalSlug = baseSlug;
    let counter = 1;

    while (existingSlugs.includes(finalSlug)) {
        finalSlug = `${baseSlug}-${counter}`;
        counter++;
    }

    return finalSlug;
} 