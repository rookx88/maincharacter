import React, { useState, useEffect } from 'react';
import { MemoryFragment } from '../types/memoryFragment';
import { TimePeriod } from '../types/common';
import './MemoryViewer.css';
import axios from 'axios';

interface MemoryViewerProps {
    userId: string;
}

interface FilterOptions {
    timePeriod?: TimePeriod;
    searchTerm?: string;
    tags?: string[];
}

type ViewMode = 'grid' | 'timeline';

const MemoryViewer: React.FC<MemoryViewerProps> = ({ userId }) => {
    const [memories, setMemories] = useState<MemoryFragment[]>([]);
    const [filters, setFilters] = useState<FilterOptions>({});
    const [viewMode, setViewMode] = useState<ViewMode>('grid');
    const [filteredMemories, setFilteredMemories] = useState<MemoryFragment[]>([]);

    useEffect(() => {
        if (!userId) {
            console.log('No userId available, skipping fetch');
            return;
        }
        fetchMemories();
    }, [userId]);

    useEffect(() => {
        let result = [...memories];
        
        if (filters.searchTerm) {
            const searchLower = filters.searchTerm.toLowerCase();
            result = result.filter(memory => 
                memory.title.toLowerCase().includes(searchLower) ||
                memory.description.toLowerCase().includes(searchLower) ||
                memory.people.some(person => 
                    person.name.toLowerCase().includes(searchLower)
                )
            );
        }
        
        if (filters.timePeriod) {
            result = result.filter(memory => 
                memory.date.timePeriod === filters.timePeriod
            );
        }
        
        setFilteredMemories(result);
    }, [memories, filters]);

    const fetchMemories = async () => {
        try {
            console.log('Fetching memories for userId:', userId);
            if (!userId) {
                console.error('Cannot fetch memories: no userId provided');
                return;
            }
            const response = await axios.get(`/api/memories/user/${userId}/memories`);
            console.log('API Response:', response.data);
            const data = Array.isArray(response.data) ? response.data : [];
            setMemories(data);
        } catch (error: any) {
            console.error('Error details:', error.response?.data || error.message);
            setMemories([]);
        }
    };

    const renderMemoryCard = (memory: MemoryFragment) => (
        <div key={memory.id} className="memory-card">
            <h3>{memory.title}</h3>
            <div className="memory-date">
                <span>{new Date(memory.date.timestamp).toLocaleDateString()}</span>
                <span className="time-period">{memory.date.timePeriod}</span>
            </div>
            <p className="memory-description">{memory.description}</p>
            {memory.people.length > 0 && (
                <div className="memory-people">
                    <strong>People: </strong>
                    {memory.people.map(p => p.name).join(', ')}
                </div>
            )}
            {memory.tags.length > 0 && (
                <div className="memory-tags">
                    {memory.tags.map(tag => (
                        <span key={tag} className="tag">{tag}</span>
                    ))}
                </div>
            )}
        </div>
    );

    const renderTimelineItem = (memory: MemoryFragment) => (
        <div key={memory.id} className="timeline-item">
            <div className="timeline-date">
                <span className="date">{new Date(memory.date.timestamp).toLocaleDateString()}</span>
                <span className="time-period">{memory.date.timePeriod}</span>
            </div>
            <div className="timeline-content">
                {renderMemoryCard(memory)}
            </div>
        </div>
    );

    return (
        <div className="memory-viewer">
            <div className="memory-controls">
                <div className="view-toggle">
                    <button 
                        className={viewMode === 'grid' ? 'active' : ''}
                        onClick={() => setViewMode('grid')}
                    >
                        Grid View
                    </button>
                    <button 
                        className={viewMode === 'timeline' ? 'active' : ''}
                        onClick={() => setViewMode('timeline')}
                    >
                        Timeline View
                    </button>
                </div>
                <div className="memory-filters">
                    <input
                        type="text"
                        placeholder="Search memories..."
                        onChange={(e) => setFilters(prev => ({ 
                            ...prev, 
                            searchTerm: e.target.value 
                        }))}
                    />
                    <select
                        onChange={(e) => setFilters(prev => ({ 
                            ...prev, 
                            timePeriod: e.target.value as TimePeriod 
                        }))}
                    >
                        <option value="">All Time Periods</option>
                        {Object.values(TimePeriod).map(period => (
                            <option key={period} value={period}>{period}</option>
                        ))}
                    </select>
                </div>
            </div>

            {viewMode === 'grid' ? (
                <div className="memory-grid">
                    {filteredMemories.map(renderMemoryCard)}
                </div>
            ) : (
                <div className="memory-timeline">
                    {filteredMemories.map(renderTimelineItem)}
                </div>
            )}
        </div>
    );
};

export default MemoryViewer; 