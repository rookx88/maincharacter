import { MemoryFragment, Chapter, Memoir } from '../types/memoir.js';
import MemoirModel from '../models/memoirModel.js';
import { AIService } from './aiService.js';
import { ConversationError } from '../utils/conversationError.js';

import { getChatCompletion } from '../utils/openai.js';
import { PromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "langchain/output_parsers";
import { ChatOpenAI } from "@langchain/openai";
import { RunnableSequence } from "@langchain/core/runnables";
import { MemoryService } from './memoryService.js';
import { DateRange } from '../types/common.js';

export class MemoirService {
    private aiService: AIService;
    private model: ChatOpenAI;
    private narrativeChain!: RunnableSequence;
    private memoryService: MemoryService;

    constructor() {
        this.aiService = new AIService();
        this.model = new ChatOpenAI({
            modelName: "gpt-3.5-turbo",
            temperature: 0.7
        });

        this.memoryService = new MemoryService();
        this.setupNarrativeChain();
    }

    private setupNarrativeChain() {
        const chapterParser = StructuredOutputParser.fromNamesAndDescriptions({
            title: "Chapter title",
            content: "Narrative content",
            themes: "Key themes",
            tone: "Emotional tone"
        });

        const template = `You are a memoir writing assistant. Your task is to help users craft compelling life stories based on their memories.

        Current Memory Context:
        {{context}}

        User Input: {{input}}

        Always follow these guidelines:
        1. Maintain {{perspective}} perspective
        2. Focus on {{theme}} elements
        3. Use {{style}} language`;

        const prompt = PromptTemplate.fromTemplate(template);

        this.narrativeChain = RunnableSequence.from([
            prompt,
            this.model,
            chapterParser
        ]);
    }

    async generateChapter(userId: string, timeframe: DateRange): Promise<Chapter> {
        const memories = await this.memoryService.getMemoriesInTimeframe(userId, timeframe);
        
        const result = await this.narrativeChain.invoke({
            memories: memories.map(m => m.context).join("\n\n"),
            timeframe: `${timeframe.from.toLocaleDateString()} - ${timeframe.to.toLocaleDateString()}`
        });

        return {
            title: result.title,
            content: result.content,
            themes: result.themes.split(',').map((t: string) => t.trim()),
            timeframe
        };
    }

    async createMemoir(userId: string): Promise<Memoir> {
        const timeframe = {
            from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
            to: new Date()
        };

        const chapter = await this.generateChapter(userId, timeframe);
        
        return await MemoirModel.create({
            userId,
            title: `My Story - ${new Date().getFullYear()}`,
            chapters: [chapter],
            metadata: {
                timespan: timeframe,
                mainCharacters: [],
                locations: [],
                themes: chapter.themes
            }
        });
    }

    async getMemoir(userId: string, memoirId: string): Promise<Memoir | null> {
        return await MemoirModel.findOne({ _id: memoirId, userId });
    }

    async getAllMemoirs(userId: string): Promise<Memoir[]> {
        return await MemoirModel.find({ userId });
    }

    async updateMemoir(memoirId: string, updates: Partial<Memoir>): Promise<Memoir | null> {
        return await MemoirModel.findByIdAndUpdate(memoirId, updates, { new: true });
    }
}
