import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './AgentSelection.css';

// Import agent images directly
import alexRiversImg from '../assets/agents/alex-rivers.png';
import chefIsabellaImg from '../assets/agents/chef-isabella.png';
import morganChaseImg from '../assets/agents/morgan-chase.png';

// Create an image mapping
const agentImages: Record<string, string> = {
    'alex-rivers': alexRiversImg,
    'chef-isabella': chefIsabellaImg,
    'morgan-chase': morganChaseImg
};

interface Agent {
    _id: string;  // MongoDB ObjectId as string
    name: string;
    category: string;
    description: string;
    expertise: {
        topics: string[];
        specialties: string[];
        // Add other potential fields
    };
    style: {
        speaking: string[];
        tone: string[];
        patterns: string[];
    };
    traits: {
        core: string[];
        adaptive: Record<string, number>;
    };
    bio: string[];
    avatar: string;
    slug: string;
}

export default function AgentSelection() {
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const navigate = useNavigate();

    useEffect(() => {
        const fetchAgents = async () => {
            try {
                console.log('Fetching agents...');
                const response = await axios.get('/api/agents', {
                    withCredentials: true,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                console.log('API Response:', {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers,
                    data: response.data
                });
                
                if (!response.data) {
                    throw new Error('No data received from server');
                }
                
                setAgents(response.data);
            } catch (err: any) {
                console.error('Error fetching agents:', {
                    message: err.message,
                    response: err.response?.data,
                    status: err.response?.status
                });
                setError(err instanceof Error ? err.message : 'Failed to load agents');
            } finally {
                setLoading(false);
            }
        };

        fetchAgents();
    }, []);

    useEffect(() => {
        console.log('AgentSelection - Mount state:', {
            loading,
            agentsCount: agents.length,
            error
        });
    }, [loading, agents, error]);

    const handleAgentSelect = async (agent: Agent) => {
        try {
            console.log('1. Starting conversation with agent:', agent);
            const response = await axios.post('/api/conversations/start', 
                { 
                    agentSlug: agent.slug,
                }, 
                { withCredentials: true }
            );
            console.log('2. Server response:', response.data);

            // Log before navigation
            console.log('3. Navigating to:', `/conversation/${agent.slug}`);
            navigate(`/conversation/${agent.slug}`);

        } catch (error: any) {
            console.error('Start conversation error:', {
                error: error.message,
                response: error.response?.data,
                status: error.response?.status
            });
            setError('Failed to start conversation');
        }
    };

    if (loading) return <div className="loading">Loading conversation partners...</div>;
    if (error) return <div className="error">{error}</div>;

    if (!agents || agents.length === 0) {
        return <div className="error">No conversation partners available</div>;
    }

    return (
        <div className="agent-selection">
            <div className="agent-selection-content">
                <h1>People have been waiting for to meet you!</h1>
                <div className="agents-grid">
                    {agents.map((agent) => (
                        <div 
                            key={agent._id}
                            className="agent-card"
                            onClick={() => handleAgentSelect(agent)}
                        >
                            <div 
                                className="agent-card-inner"
                                style={{
                                    backgroundImage: `url(${agentImages[agent.slug]})`,
                                    backgroundSize: 'cover',
                                    backgroundPosition: 'center'
                                }}
                            >
                                <div className="agent-info">
                                    <h2>{agent.name}</h2>
                                    <p className="agent-title">{getTitleBySlug(agent.slug)}</p>
                                    <p className="teaser">{getTeaser(agent.category)}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function getTitleBySlug(slug: string): string {
    const titles: Record<string, string> = {
        'morgan-chase': 'Celebrity Fashion Stylist and Image Consultant',
        'alex-rivers': 'Engaging podcast host known for deep-diving interviews and meaningful conversations with influential people',
        'chef-isabella': 'A passionate chef who creates dishes inspired by personal stories'
    };
    return titles[slug] || '';
}

function getTeaser(category: string): string {
    const teasers: Record<string, string> = {
        "Media & Entertainment": "Ready to share your story?",
        "Culinary & Lifestyle": "Your signature menu awaits...",
        "Fashion & Style": "Let's create your iconic look"
    };
    return teasers[category] || "Your next chapter begins here";
} 