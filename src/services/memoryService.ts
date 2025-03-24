import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "langchain/output_parsers";
import MemoryFragment, { MemoryFragmentDocument } from '../models/memoryFragmentModel.js';
import { z } from "zod";
import { DateRange } from '../types/common.js';
import { getChatCompletion } from '../utils/openai.js';
import { IConversationDocument } from '../models/conversationModel.js';
import { RawMemoryInput } from '../types/memory.js';

interface MemoryAnalysis {
    significance: number;
    topics: string;
    emotions: string;
    timePeriod: string;
    yearEstimate?: number;
}

const memoryParserSchema = z.object({
    significance: z.number(),
    topics: z.string(),
    emotions: z.string(),
    timePeriod: z.enum([
        "Childhood",
        "Teenager",
        "Young Adult",
        "Adult",
        "Older Adult"
    ]),
    yearEstimate: z.number().optional()
});

type MemoryParserOutput = z.infer<typeof memoryParserSchema>;

export class MemoryService {
    private model: ChatOpenAI;
    private memoryParser: StructuredOutputParser<typeof memoryParserSchema>;

    constructor() {
        this.model = new ChatOpenAI({
            modelName: "gpt-3.5-turbo",
            temperature: 0.7
        });

        this.memoryParser = StructuredOutputParser.fromZodSchema(memoryParserSchema);
    }

    async analyzeMemory(content: string): Promise<MemoryAnalysis> {
        const prompt = PromptTemplate.fromTemplate(`
            Analyze this memory:

            {content}

            Consider:
            1. How significant is this memory (0-1)?
            2. What topics are discussed?
            3. What emotions are present?
            4. What life period does this memory belong to?
            5. Is there a specific year or age mentioned?

            ${this.memoryParser.getFormatInstructions()}
        `.trim());

        const chain = prompt.pipe(this.model).pipe(this.memoryParser);
        const result = await chain.invoke({ content });
        
        return {
            significance: result.significance,
            topics: result.topics,
            emotions: result.emotions,
            timePeriod: result.timePeriod,
            yearEstimate: result.yearEstimate
        };
    }

    async getMemoriesInTimeframe(userId: string, timeframe: DateRange): Promise<MemoryFragmentDocument[]> {
        return MemoryFragment.find({
            'system.userId': userId,
            'date.timestamp': {
                $gte: timeframe.from,
                $lte: timeframe.to
            }
        });
    }

    async createFromConversation(conversation: IConversationDocument & { _id: unknown } & { __v: number }) {
        try {
            if ('messages' in conversation) {
                // Handle conversation document
                return this.createFromConversationDoc(conversation as IConversationDocument);
            } else {
                // Handle memory fragment
                return this.createFromMemoryFragment(conversation as MemoryFragmentDocument);
            }
        } catch (error) {
            console.error('Error creating memory from conversation:', error);
            throw error;
        }
    }

    private async createFromConversationDoc(conversation: IConversationDocument) {
        // Existing conversation processing logic
    }

    private async createFromMemoryFragment(memory: MemoryFragmentDocument) {
        // Memory fragment processing logic
    }

    private async analyzeConversation(text: string) {
        const prompt = `Analyze this conversation and extract:
        1. Key event/experience title (1-5 words)
        2. Summary (1-2 sentences)
        3. People mentioned (name, relationship)
        4. Main themes (3-5 tags)
        5. Emotional tone (3-5 adjectives)
        6. Significance (1-5 scale)
        
        Format as JSON: {
            title: string,
            summary: string,
            entities: { people: Array<{name: string, relationship: string}> },
            tags: string[],
            emotions: string[],
            themes: string[],
            significance: number
        }`;
        
        const result = await getChatCompletion(prompt, text);
        return JSON.parse(result);
    }

    async createFromRawInput(rawInput: RawMemoryInput) {
        try {
            const memory = await MemoryFragment.create({
                content: rawInput.content,
                source: rawInput.source,
                userId: rawInput.userId,
                metadata: rawInput.metadata,
                status: 'needs_processing'
            });
            return memory;
        } catch (error) {
            console.error('Error creating memory from raw input:', error);
            throw error;
        }
    }
} 