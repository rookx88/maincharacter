import { TimePeriod } from '../types/common.js';

export function getTimeBasedGreeting(): string {
    const hour = new Date().getHours();
    
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
}

export function getTimePeriod(date: Date): TimePeriod {
    const now = new Date();
    const yearDiff = now.getFullYear() - date.getFullYear();
    
    if (yearDiff > 2) return TimePeriod.Past;
    if (yearDiff < -1) return TimePeriod.Future;
    return TimePeriod.Present;
} 