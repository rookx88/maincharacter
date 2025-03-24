type AgentImageKey = 'barber' | 'columnist' | 'anchorperson' | 'placeholder';

const normalizeAgentName = (name: string): AgentImageKey => {
    // Map full names to image keys
    const nameMap: Record<string, AgentImageKey> = {
        'The Friendly Barber': 'barber',
        'The Sharp Anchorperson': 'anchorperson',
        'The Nostalgic Columnist': 'columnist'
    };

    // Use direct mapping if available
    if (name in nameMap) {
        return nameMap[name];
    }

    // Fallback to normalized string
    return name.toLowerCase().replace(/[^a-z]/g, '') as AgentImageKey;
};

export const agentImages: Record<AgentImageKey, string> = {
    barber: '/images/agents/barber.jpg',
    columnist: '/images/agents/columnist.jpg',
    anchorperson: '/images/agents/anchor.jpg',
    placeholder: '/images/agents/placeholder.svg'
};

export const getAgentImage = (name: string): string => {
    const key = normalizeAgentName(name);
    console.log('Getting image for:', name, 'with key:', key);
    const image = agentImages[key] || agentImages.placeholder;
    console.log('Resolved image path:', image);
    return image;
}; 