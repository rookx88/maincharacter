import { Request, Response } from "express";
import Conversation from "../models/conversationModel.js";
import { AIService } from '../services/aiService.js';
import { agentService } from '../services/agentService.js';
import { ConversationError, handleError } from '../utils/errorHandler.js';
import { ConversationService } from '../services/conversationService.js';
import { MemoryService } from '../services/memoryService.js';
import { AgentType } from '../types/conversation.js';
import { services } from '../services/index.js';
import AgentModel from '../models/agentModel.js';
import { ConversationNodeType } from '../types/conversation.js';
import { AIMemoryService } from '../services/aiMemoryService.js';

// Create the required services
const aiMemoryService = new AIMemoryService();
const aiService = new AIService();

// Create an instance of ConversationService with proper dependencies
const conversationService = new ConversationService(aiService, aiMemoryService);

const isValidAgent = async (agent: string | undefined): Promise<boolean> => {
    console.log('isValidAgent called with:', agent);
    
    if (!agent) {
        console.log('Agent is undefined');
        return false;
    }
    
    try {
        const agents = await agentService.listProfiles();
        console.log('Available agents:', agents);
        
        const normalizedInput = agent.toLowerCase().replace(/[^a-z]/g, '');
        console.log('Normalized input:', normalizedInput);
        
        const result = agents.some(a => {
            const normalizedName = (a.name || '').toLowerCase().replace(/[^a-z]/g, '');
            console.log('Comparing:', normalizedInput, 'with:', normalizedName);
            return normalizedName === normalizedInput;
        });
        
        console.log('Validation result:', result);
        return result;
    } catch (error) {
        console.error('Error in isValidAgent:', error);
        return false;
    }
};

export class ConversationController {
    constructor() {}

    async getAgents(req: Request, res: Response) {
        try {
            console.log('Getting agents...');
            const agents = await services.conversationService.getAgents();
            res.json(agents);
        } catch (error) {
            console.error('Error getting agents:', error);
            res.status(500).json({ error: 'Failed to get agents' });
        }
    }

    async startConversation(req: Request, res: Response) {
        try {
            const { agentSlug } = req.body;
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            console.log(`Starting conversation - User: ${userId}, Agent: ${agentSlug}`);
            
            const agent = await agentService.getAgentBySlug(agentSlug);
            if (!agent) {
                return res.status(404).json({ error: 'Agent not found' });
            }

            const conversation = await conversationService.startConversation(
                userId,
                agent._id.toString(),
                agentSlug
            );
            
            console.log(`Conversation started - ID: ${conversation._id}`);
            console.log(`Initial message: "${conversation.messages[0]?.content}"`);
            console.log(`Returning ${conversation.messages.length} messages to client`);
            
            // Return the full conversation object including messages
            return res.status(200).json(conversation);
        } catch (error) {
            console.error('Error starting conversation:', error);
            return res.status(500).json({ error: 'Failed to start conversation' });
        }
    }

    async retrieveConversations(req: Request, res: Response) {
        const { userId } = req.params;
        try {
            const conversations = await Conversation.find({ userId });
            res.json(conversations);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            res.status(500).json({ error: "Failed to retrieve conversations", details: message });
        }
    }

    async chat(req: Request, res: Response) {
        try {
            const { message, agentSlug } = req.body;
            const userId = req.user.id;
            
            const response = await services.conversationService.processMessage(
                userId,
                message,
                agentSlug
            );

            return res.json({ response });
        } catch (error) {
            console.error("Controller error:", error);
            res.status(500).json({ error: 'Failed to process message' });
        }
    }

    async getMessages(req: Request, res: Response) {
        try {
            const { userId } = req.query;
            const { agentId } = req.params;

            const conversation = await Conversation.findOne({
                userId,
                agent: agentId,
                active: true
            }).sort({ 'messages.timestamp': -1 });

            if (!conversation) {
                res.json({ messages: [] });
                return;
            }

            res.json({ messages: conversation.messages });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch messages' });
        }
    }

    async endConversation(req: Request, res: Response) {
        try {
            const conversation = await Conversation.findByIdAndUpdate(
                req.params.id,
                { active: false },
                { new: true }
            );
            
            // Check if conversation exists
            if (!conversation) {
                throw new ConversationError('Conversation not found', 404);
            }
            
            
            const memoryService = new MemoryService();
            await memoryService.createFromConversation(conversation);
            
            res.json(conversation);
        } catch (error) {
            handleError(res, error);
        }
    }

    async deleteConversation(req: Request, res: Response) {
        try {
            const { agentSlug } = req.params;
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            console.log(`Deleting conversation - User: ${userId}, Agent: ${agentSlug}`);
            
            await Conversation.deleteMany({ userId, agentSlug });
            
            return res.status(200).json({ message: 'Conversation deleted successfully' });
        } catch (error) {
            console.error('Error deleting conversation:', error);
            return res.status(500).json({ error: 'Failed to delete conversation' });
        }
    }
}

export const processMessage = async (req: Request, res: Response) => {
    try {
        const { message, agentId, userId } = req.body;

        if (!message || !agentId || !userId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const response = await aiService.processMessageWithGraph(
            userId, 
            message, 
            agentId,
            ConversationNodeType.CASUAL_CONVERSATION
        );
        res.json({ response });
    } catch (error) {
        console.error('Error processing message:', error);
        res.status(500).json({ error: 'Failed to process message' });
    }
};

export const startChat = async (req: Request, res: Response) => {
    try {
        const { agentSlug, userId } = req.body;

        if (!agentSlug || !userId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const agent = await agentService.getAgentBySlug(agentSlug);
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const response = await aiService.chat(agent._id.toString(), userId, "Hello!");
        res.json({ response });
    } catch (error) {
        console.error('Error starting chat:', error);
        res.status(500).json({ error: 'Failed to start chat' });
    }
};

export const findAgentByName = async (req: Request, res: Response) => {
    try {
        const { name } = req.params;
        const normalizedInput = name.toLowerCase().replace(/[^a-z]/g, '');
        
        const agents = await AgentModel.find({});
        const result = agents.some(a => {
            const normalizedName = (a.name || '').toLowerCase().replace(/[^a-z]/g, '');
            console.log('Comparing:', normalizedInput, 'with:', normalizedName);
            return normalizedName === normalizedInput;
        });

        if (!result) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        res.json({ found: true });
    } catch (error) {
        console.error('Error finding agent:', error);
        res.status(500).json({ error: 'Failed to find agent' });
    }
};

export const sendMessage = async (req: Request, res: Response) => {
    try {
        const { message, agentSlug } = req.body;
        const userId = req.user.id;
        
        const result = await conversationService.processMessage(
            userId,
            message,
            agentSlug
        );
        
        // Make sure we're sending a string message
        const responseMessage = typeof result.response === 'string' 
            ? result.response 
            : JSON.stringify(result.response);
        
        // Add detailed debugging
        console.log('Sending response to client:', {
            message: responseMessage,
            conversationEnded: result.metadata?.conversationEnded || false,
            fullResult: JSON.stringify(result),
            metadata: result.metadata,
            hasMetadata: !!result.metadata,
            metadataKeys: result.metadata ? Object.keys(result.metadata) : []
        });
        
        // Create the response object
        const responseObj = {
            message: responseMessage,
            conversationEnded: result.metadata?.conversationEnded || false
        };
        
        console.log('Final response object:', responseObj);
        
        res.status(200).json(responseObj);
    } catch (error) {
        console.error('Error processing message:', error);
        res.status(500).json({ error: 'Failed to process message' });
    }
};

export default new ConversationController(); 