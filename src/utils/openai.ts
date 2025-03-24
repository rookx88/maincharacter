import OpenAI from 'openai';
import dotenv from 'dotenv';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

dotenv.config();

// Singleton OpenAI instance
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

export async function getChatCompletion(
    systemPrompt: string,
    userInput: string
): Promise<string> {
    const response = await openai.chat.completions.create({
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userInput }
        ],
        model: "gpt-3.5-turbo",
    });

    return response.choices[0]?.message?.content || '';
}

// Export the OpenAI instance for other uses
export { openai };