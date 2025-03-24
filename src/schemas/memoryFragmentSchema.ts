import { z } from "zod";

// Enum validation
export const TimePeriodSchema = z.enum([
    "Childhood",
    "Teenager", 
    "Young Adult",
    "Adult",
    "Older Adult"
]);

// Memory Fragment Schema
export const MemoryFragmentSchema = z.object({
    // Core Metadata
    id: z.string().uuid().default(() => crypto.randomUUID()),
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(5000),
    date: z.object({
        timestamp: z.date(),
        approximateDate: z.string().optional(),
        timePeriod: TimePeriodSchema
    }),
    location: z.object({
        name: z.string().min(1),
        coordinates: z.object({
            latitude: z.number().min(-90).max(90),
            longitude: z.number().min(-180).max(180)
        }).optional()
    }),

    // Relational Metadata
    people: z.array(z.object({
        name: z.string().min(1),
        relationship: z.string().optional()
    })),
    tags: z.array(z.string()),
    media: z.array(z.object({
        type: z.enum(['photo', 'video', 'audio']),
        url: z.string().url(),
        caption: z.string().optional()
    })).optional(),

    // Contextual Metadata
    context: z.object({
        emotions: z.array(z.string()),
        significance: z.number().min(1).max(5).int(),
        themes: z.array(z.string())
    }),

    // System Metadata
    system: z.object({
        userId: z.string(),
        createdAt: z.date(),
        updatedAt: z.date(),
        version: z.number().int().positive()
    })
});

// Type inference
export type ValidatedMemoryFragment = z.infer<typeof MemoryFragmentSchema>;

// Partial schema for updates
export const MemoryFragmentUpdateSchema = MemoryFragmentSchema.partial().omit({
    id: true,
    system: true
}); 