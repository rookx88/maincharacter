import { useState, useEffect } from 'react';


interface MemoryFragment {
    _id: string;
    title: string;
    date: {
        timestamp: Date;
    };
    // Add other fields as needed
}

interface MemoryEditorProps {
    memoryId: string;
}

const MemoryEditor = ({ memoryId }: MemoryEditorProps) => {
    const [memory, setMemory] = useState<MemoryFragment | null>(null);

    useEffect(() => {
        // Load memory logic here
    }, [memoryId]);

    if (!memory) return <div>Loading...</div>;

    return (
        <div>
            <input 
                value={memory.title}
                onChange={(e) => setMemory({...memory, title: e.target.value})}
            />
            <input 
                type="date"
                value={memory.date.timestamp.toISOString().split('T')[0]}
                onChange={(e) => setMemory({
                    ...memory, 
                    date: {...memory.date, timestamp: new Date(e.target.value)}
                })}
            />
        </div>
    );
};

export default MemoryEditor; 