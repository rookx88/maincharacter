import { Chapter, ChapterType, ChapterTemplate } from '../types/chapter.js';
import { MemoryFragment } from '../types/memoryFragment.js';
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { TimePeriod } from '../types/common.js';

export class ChapterGeneratorService {
    private model: ChatOpenAI;
    private chapterTemplates: Map<ChapterType, ChapterTemplate>;
    private currentChapterType: ChapterType | null = null;

    constructor() {
        this.model = new ChatOpenAI({
            modelName: "gpt-3.5-turbo",
            temperature: 0.7
        });
        this.chapterTemplates = new Map();
        this.initializeTemplates();
    }

    async generateChapter(
        chapterType: ChapterType,
        memories: MemoryFragment[],
        previousChapters?: Chapter[]
    ): Promise<Chapter> {
        const template = this.chapterTemplates.get(chapterType)!;
        
        // Filter relevant memories
        let relevantMemories = this.filterRelevantMemories(
            memories, 
            template.requiredThemes
        );

        // Sort by relevance
        relevantMemories = this.sortMemoriesByRelevance(
            relevantMemories,
            chapterType
        );

        // Take top N most relevant memories
        relevantMemories = relevantMemories.slice(0, 5);

        // Generate the chapter content
        const content = await this.generateContent(
            template,
            relevantMemories,
            previousChapters
        );

        return {
            id: crypto.randomUUID(),
            title: this.generateTitle(chapterType, relevantMemories),
            type: chapterType,
            memoryFragments: relevantMemories.map(m => m.id),
            metadata: this.generateMetadata(relevantMemories),
            content
        };
    }

    private async generateContent(
        template: ChapterTemplate,
        memories: MemoryFragment[],
        previousChapters?: Chapter[]
    ): Promise<{ opening: string; body: string; closing: string }> {
        const prompt = PromptTemplate.fromTemplate(template.promptTemplate);
        
        const formattedPrompt = await prompt.format({
            memories: memories.map(m => m.description).join('\n'),
            purpose: template.purpose,
            style: template.narrativeStyle,
            previousContent: previousChapters?.map(c => c.content).join('\n')
        });

        const response = await this.model.invoke(formattedPrompt);
        const responseText = response.content.toString();
        return this.parseChapterContent(responseText);
    }

    private initializeTemplates() {
        this.chapterTemplates = new Map([
            [ChapterType.INTRODUCTION, {
                type: ChapterType.INTRODUCTION,
                purpose: "Set the stage and hook the reader",
                requiredThemes: ["pivotal", "emotional"],
                narrativeStyle: "vivid and engaging",
                promptTemplate: `
                    Create an engaging introduction that draws the reader in.
                    Use these memories as source material:
                    {memories}
                    
                    Focus on creating:
                    1. A compelling hook
                    2. Setting the emotional tone
                    3. Hinting at the journey ahead

                    Structure the response as:
                    [OPENING]
                    (Hook and scene setting)
                    [BODY]
                    (Core narrative)
                    [CLOSING]
                    (Bridge to next chapter)
                `
            }],

            [ChapterType.ROOTS, {
                type: ChapterType.ROOTS,
                purpose: "Explore early life and formative experiences",
                requiredThemes: ["childhood", "family", "origins"],
                narrativeStyle: "warm and nostalgic",
                promptTemplate: `
                    Create a chapter about early life experiences and roots.
                    Use these memories as source material:
                    {memories}

                    Focus on:
                    1. Family dynamics and early relationships
                    2. Key childhood moments
                    3. Cultural and environmental influences

                    Structure the response as:
                    [OPENING]
                    (Early memory scene)
                    [BODY]
                    (Childhood narrative)
                    [CLOSING]
                    (Connection to identity)
                `
            }],

            [ChapterType.TRIALS, {
                type: ChapterType.TRIALS,
                purpose: "Highlight struggles and achievements",
                requiredThemes: ["challenge", "growth", "perseverance"],
                narrativeStyle: "dynamic and resilient",
                promptTemplate: `
                    Create a chapter about overcoming challenges.
                    Use these memories as source material:
                    {memories}

                    Focus on:
                    1. Major challenges faced
                    2. Internal and external struggles
                    3. Moments of triumph and growth

                    Structure the response as:
                    [OPENING]
                    (Challenge introduction)
                    [BODY]
                    (Journey through adversity)
                    [CLOSING]
                    (Lessons learned)
                `
            }],

            [ChapterType.RELATIONSHIPS, {
                type: ChapterType.RELATIONSHIPS,
                purpose: "Explore significant relationships",
                requiredThemes: ["love", "connection", "family", "friendship"],
                narrativeStyle: "intimate and emotional",
                promptTemplate: `
                    Create a chapter about relationships and connections.
                    Use these memories as source material:
                    {memories}

                    Focus on:
                    1. Key relationships and their impact
                    2. Emotional growth through connections
                    3. Defining moments in relationships

                    Structure the response as:
                    [OPENING]
                    (Significant relationship moment)
                    [BODY]
                    (Relationship journey)
                    [CLOSING]
                    (Impact on life)
                `
            }],

            [ChapterType.TURNING_POINTS, {
                type: ChapterType.TURNING_POINTS,
                purpose: "Highlight life-changing moments",
                requiredThemes: ["change", "decision", "transformation"],
                narrativeStyle: "dramatic and reflective",
                promptTemplate: `
                    Create a chapter about pivotal life moments.
                    Use these memories as source material:
                    {memories}

                    Focus on:
                    1. Major life decisions
                    2. Unexpected changes
                    3. Moments of revelation

                    Structure the response as:
                    [OPENING]
                    (Pivotal moment setup)
                    [BODY]
                    (Change and impact)
                    [CLOSING]
                    (Life after change)
                `
            }],

            [ChapterType.REFLECTIONS, {
                type: ChapterType.REFLECTIONS,
                purpose: "Share wisdom and insights gained",
                requiredThemes: ["wisdom", "learning", "growth"],
                narrativeStyle: "contemplative and wise",
                promptTemplate: `
                    Create a reflective chapter about life lessons.
                    Use these memories as source material:
                    {memories}

                    Focus on:
                    1. Key life lessons
                    2. Personal philosophy
                    3. Wisdom to share

                    Structure the response as:
                    [OPENING]
                    (Wisdom context)
                    [BODY]
                    (Life lessons)
                    [CLOSING]
                    (Future hopes)
                `
            }],

            [ChapterType.CONCLUSION, {
                type: ChapterType.CONCLUSION,
                purpose: "Tie everything together and look forward",
                requiredThemes: ["legacy", "future", "hope"],
                narrativeStyle: "inspiring and forward-looking",
                promptTemplate: `
                    Create a concluding chapter that brings closure.
                    Use these memories as source material:
                    {memories}

                    Focus on:
                    1. Life's journey overview
                    2. Legacy and impact
                    3. Future aspirations

                    Structure the response as:
                    [OPENING]
                    (Journey reflection)
                    [BODY]
                    (Legacy and meaning)
                    [CLOSING]
                    (Looking forward)
                `
            }]
        ]);
    }

    private filterRelevantMemories(
        memories: MemoryFragment[],
        requiredThemes: string[]
    ): MemoryFragment[] {
        return memories.filter(memory => {
            const hasRequiredThemes = requiredThemes.some(theme => 
                memory.context.themes.includes(theme)
            );

            const isInTimeframe = this.isMemoryInChapterTimeframe(
                memory.date.timePeriod,
                memory.date.timestamp,
                this.currentChapterType || ChapterType.ROOTS
            );

            const isSignificantEnough = memory.context.significance >= 3;

            return hasRequiredThemes && isInTimeframe && isSignificantEnough;
        });
    }

    private isMemoryInChapterTimeframe(
        timePeriod: TimePeriod,
        timestamp: Date,
        chapterType: ChapterType
    ): boolean {
        // Map chapters to relevant time periods
        const chapterTimeframes: Record<ChapterType, TimePeriod[]> = {
            [ChapterType.INTRODUCTION]: [TimePeriod.Past, TimePeriod.Present],
            [ChapterType.ROOTS]: [TimePeriod.Past],
            [ChapterType.TRIALS]: [TimePeriod.Past, TimePeriod.Present],
            [ChapterType.RELATIONSHIPS]: [
                TimePeriod.Past, 
                TimePeriod.Present, 
                TimePeriod.Future
            ],
            [ChapterType.TURNING_POINTS]: [
                TimePeriod.Present, 
                TimePeriod.Future
            ],
            [ChapterType.REFLECTIONS]: [TimePeriod.Present],
            [ChapterType.CONCLUSION]: [TimePeriod.Future]
        };

        return chapterTimeframes[chapterType].includes(timePeriod);
    }

    // Add method to sort memories by relevance
    private sortMemoriesByRelevance(
        memories: MemoryFragment[],
        chapterType: ChapterType
    ): MemoryFragment[] {
        return memories.sort((a, b) => {
            // Prioritize by significance
            const significanceDiff = b.context.significance - a.context.significance;
            if (significanceDiff !== 0) return significanceDiff;

            // Then by timestamp
            return b.date.timestamp.getTime() - a.date.timestamp.getTime();
        });
    }

    private generateTitle(chapterType: ChapterType, memories: MemoryFragment[]): string {
        // Generate a title based on chapter type and memories
        const baseTitle = chapterType.toString();
        const timeframe = this.getTimeframeString(memories);
        return `${baseTitle}: ${timeframe}`;
    }

    private generateMetadata(memories: MemoryFragment[]) {
        return {
            timeframe: {
                start: new Date(Math.min(...memories.map(m => m.date.timestamp.getTime()))),
                end: new Date(Math.max(...memories.map(m => m.date.timestamp.getTime())))
            },
            themes: [...new Set(memories.flatMap(m => m.context.themes))],
            emotionalTone: [...new Set(memories.flatMap(m => m.context.emotions))],
            keyCharacters: [...new Set(memories.flatMap(m => m.people.map(p => p.name)))]
        };
    }

    private parseChapterContent(response: string): { opening: string; body: string; closing: string } {
        // Parse AI response into sections
        const sections = response.split(/\[(?:OPENING|BODY|CLOSING)\]/g)
            .map(s => s.trim())
            .filter(Boolean);

        return {
            opening: sections[0] || '',
            body: sections[1] || '',
            closing: sections[2] || ''
        };
    }

    private getTimeframeString(memories: MemoryFragment[]): string {
        const timestamps = memories.map(m => m.date.timestamp.getTime());
        const start = new Date(Math.min(...timestamps));
        const end = new Date(Math.max(...timestamps));
        
        return `${start.getFullYear()} - ${end.getFullYear()}`;
    }
} 