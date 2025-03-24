export enum TimePeriod {
    Childhood = 'childhood',
    Adolescence = 'adolescence',
    EarlyAdulthood = 'early_adulthood',
    MiddleAdulthood = 'middle_adulthood',
    LateAdulthood = 'late_adulthood'
}

export interface DateRange {
    from: Date;
    to: Date;
} 