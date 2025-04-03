// Create a centralized logging system
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

export class Logger {
    private static instance: Logger;
    private currentLevel: LogLevel = LogLevel.INFO;
    
    private constructor() {}
    
    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }
    
    setLevel(level: LogLevel): void {
        this.currentLevel = level;
    }
    
    debug(message: string, context?: any): void {
        if (this.currentLevel <= LogLevel.DEBUG) {
            console.log(`[DEBUG] ${message}`, context || '');
        }
    }
    
    info(message: string, context?: any): void {
        if (this.currentLevel <= LogLevel.INFO) {
            console.log(`[INFO] ${message}`, context || '');
        }
    }
    
    warn(message: string, context?: any): void {
        if (this.currentLevel <= LogLevel.WARN) {
            console.warn(`[WARN] ${message}`, context || '');
        }
    }
    
    error(message: string, error?: any): void {
        if (this.currentLevel <= LogLevel.ERROR) {
            console.error(`[ERROR] ${message}`, error || '');
        }
    }
}

export const logger = Logger.getInstance(); 