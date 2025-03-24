import Conversation from '../models/conversationModel.js';
import MemoryFragment from '../models/memoryFragmentModel.js';
import { MemoryService } from './memoryService.js';
import { parseDate, extractPeople, detectMissingFields } from '../utils/memoryUtils.js';
import { getTimePeriod } from '../utils/timeUtils.js';
import { AIMemoryService } from './aiMemoryService.js';
import { AIService } from './aiService.js';
import AgentModel from '../models/agentModel.js';

import { ConversationNodeType } from '../types/conversation.js';
import { agentService } from './agentService.js';


const memoryService = new MemoryService();

interface RawMemoryInput {
  content: string;
  source: string;
  userId: string;
  metadata: {
    agent: string;
  };
}

async function saveConversationMemory(conversation: any) {
  const lastMessages = conversation.messages.slice(-3); // Get context
  
  const rawInput: RawMemoryInput = {
    content: lastMessages.map((m: { content: string }) => m.content).join('\n'),
    source: 'conversation',
    userId: conversation.userId,
    metadata: {
      agent: conversation.agentId.toString()
    }
  };

  await memoryService.createFromRawInput(rawInput);
}

async function handleMemoryCompletion(
  userId: string, 
  memoryId: string,
  response: string
) {
  const memory = await MemoryFragment.findById(memoryId);
  if (!memory) throw new Error('Memory not found');
  
  const field = memory.missingFields?.[0];
  if (!field) throw new Error('No missing fields to complete');
  
  // Update based on field type
  switch(field) {
    case 'date':
      const parsedDate = parseDate(response);
      memory.date = {
        timestamp: parsedDate,
        timePeriod: getTimePeriod(parsedDate)
      };
      break;
    case 'people':
      memory.people.push(...extractPeople(response));
      break;
  }
  
  // Re-check completeness
  const newMissing = detectMissingFields(memory);
  memory.status = newMissing.length ? 'needs_details' : 'complete';
  memory.missingFields = newMissing;
  
  await memory.save();
}

export class ConversationService {
    constructor(
        private aiService: AIService,
        private memoryService: AIMemoryService
    ) {}

    async processMessage(userId: string, message: string, agentSlug: string) {
        console.log('\n=== ConversationService: Starting Message Processing ===');
        
        try {
            let conversation = await Conversation.findOne({ userId, agentSlug });
            if (!conversation) {
                const agent = await AgentModel.findOne({ slug: agentSlug });
                if (!agent) throw new Error('Agent not found');
                conversation = await this.startConversation(userId, agent._id.toString(), agentSlug);
            }
            
            // Process through AI service with LangGraph
            const result = await this.aiService.processMessageWithGraph(
                userId,
                message,
                agentSlug,
                conversation.currentNode as ConversationNodeType
            );
            
            // Let the graph handle state updates
            await Conversation.findOneAndUpdate(
                { userId, agentSlug },
                { 
                    $set: { 
                        currentNode: result.nextNode,
                        state: result.updatedState
                    }
                },
                { new: true }
            );
            
            return {
                response: result.response,
                state: result.updatedState
            };
            
        } catch (error) {
            console.error('Error processing message:', error);
            throw error;
        }
    }

    async startConversation(
        userId: string, 
        agentId: string,
        agentSlug: string
    ) {
        try {
            const conversation = await Conversation.create({
                userId,
                agentId,
                agentSlug,
                messages: [],
                currentNode: ConversationNodeType.ENTRY
            });
            
            return conversation;
        } catch (error) {
            console.error('Error in startConversation:', error);
            throw error;
        }
    }

    async getConversations(userId: string) {
        return await Conversation.find({ userId })
            .sort({ updatedAt: -1 });
    }

    async getAgents() {
        return await agentService.listProfiles();
    }
} 