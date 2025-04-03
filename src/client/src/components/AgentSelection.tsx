import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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

    useEffect(() => {
        const fetchAgents = async () => {
            try {
                console.log('Fetching agents...');
                const response = await axios.get('/api/agents', { withCredentials: true });
                console.log('Agents response:', response.data);
                
                if (Array.isArray(response.data) && response.data.length > 0) {
                    console.log('Setting agents:', response.data);
                    setAgents(response.data);
                } else {
                    console.error('No agents returned from API');
                    setError('No agents available');
                }
                setLoading(false);
            } catch (err) {
                console.error('Error fetching agents:', err);
                setError('Failed to load agents. Please try again later.');
                setLoading(false);
            }
        };

        fetchAgents();
    }, []);

    if (loading) {
        return <div className="loading">Loading agents...</div>;
    }

    if (error) {
        return <div className="error">{error}</div>;
    }

    return (
        <div className="agent-selection">
            <h1>Characters</h1>
            
            <div className="agents-grid">
                {agents.length > 0 ? (
                    agents.map((agent) => {
                        console.log('Rendering agent link:', `/chat/${agent.slug}`);
                        return (
                            <Link 
                                to={`/chat/${agent.slug}`} 
                                key={agent._id} 
                                className="agent-card"
                            >
                                <div className="agent-card-inner" style={{ 
                                    backgroundImage: `url(${agentImages[agent.slug] || '/placeholder.png'})` 
                                }}>
                                    <div className="agent-info">
                                        <div className="agent-text">
                                            <h2>{agent.name}</h2>
                                            <div className="agent-title">{agent.category}</div>
                                        </div>
                                        <div className="agent-teaser">
                                            <div className="teaser">{getTeaser(agent.category)}</div>
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        );
                    })
                ) : (
                    <div className="no-agents">
                        <p>No agents available at the moment.</p>
                    </div>
                )}
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