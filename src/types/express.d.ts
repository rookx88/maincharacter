import { AgentIdentity } from '../services/agentService.js';

declare global {
  namespace Express {

    interface Request {
      agent?: AgentIdentity;
    }
  }
} 