import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDateFilterRange, filterDataByDateRange } from '../public/dateFilterUtils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a YYYY-MM-DD string to a UTC midnight Date. */
function utcDate(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

/** Format a UTC Date (or timestamp) as YYYY-MM-DD. */
function toDateStr(date) {
    return new Date(date).toISOString().split('T')[0];
}

/** Return the ISO-week Monday (UTC) for the given UTC Date. */
function isoWeekMonday(date) {
    const d = new Date(date);
    const day = d.getUTCDay(); // 0 = Sun … 6 = Sat
    d.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
    return d;
}

// ---------------------------------------------------------------------------
// Minimal sample data used by filterDataByDateRange tests
// ---------------------------------------------------------------------------

function makeSummary(date, licenseAlias, count, totalAmount) {
    return {
        date,
        licenseId: `license-${licenseAlias}`,
        licenseAlias,
        count,
        totalAmount,
        averageAmount: count > 0 ? totalAmount / count : 0
    };
}

const SAMPLE_SUMMARIES = [
    makeSummary('2025-10-01', 'DeviceA', 3, 3.0),
    makeSummary('2025-11-15', 'DeviceA', 2, 2.0),
    makeSummary('2025-11-15', 'DeviceB', 4, 4.0),
    makeSummary('2025-12-01', 'DeviceB', 5, 5.0),
    makeSummary('2026-01-10', 'DeviceA', 1, 1.0),
    makeSummary('2026-02-20', 'DeviceA', 6, 6.0),
    makeSummary('2026-02-24', 'DeviceB', 2, 2.0),
];

const SAMPLE_DATA = {
    summaries: SAMPLE_SUMMARIES,
    totals: { count: 23, totalAmount: 23.0 },
    averages: { perDevice: [], perDay: [], dailyByDevice: 0 },
    meta: { generatedAtUtc: '2026-02-25T00:00:00.000Z' }
};

// ---------------------------------------------------------------------------
// getDateFilterRange — tests for each filter value
// ---------------------------------------------------------------------------

describe('getDateFilterRange', () => {
    // We freeze time to a known Wednesday so week/month boundaries are predictable.
    // Wednesday 2026-02-25 UTC
    const FIXED_DATE = new Date('2026-02-25T12:00:00.000Z');

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(FIXED_DATE);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns null for filter "all"', () => {
        expect(getDateFilterRange('all')).toBeNull();
    });

    it('returns null for an unrecognised filter', () => {
        expect(getDateFilterRange('unknown')).toBeNull();
    });

    it('returns null for an empty string filter', () => {
        expect(getDateFilterRange('')).toBeNull();
    });

    // --- current_week ---
    describe('current_week', () => {
        it('end date is today (2026-02-25)', () => {
            const range = getDateFilterRange('current_week');
            expect(range.end).toBe('2026-02-25');
        });

        it('start date is the ISO-week Monday (2026-02-23)', () => {
            // 2026-02-25 is a Wednesday → Monday is 2026-02-23
            const range = getDateFilterRange('current_week');
            expect(range.start).toBe('2026-02-23');
        });

        it('start is a Monday (getUTCDay() === 1)', () => {
            const range = getDateFilterRange('current_week');
            expect(utcDate(range.start).getUTCDay()).toBe(1);
        });

        it('start ≤ end', () => {
            const range = getDateFilterRange('current_week');
            expect(range.start <= range.end).toBe(true);
        });
    });

    // Edge case: filter called on a Monday itself
    describe('current_week when today is Monday', () => {
        it('start equals today', () => {
            vi.setSystemTime(new Date('2026-03-02T06:00:00.000Z')); // Monday
            const range = getDateFilterRange('current_week');
            expect(range.start).toBe('2026-03-02');
            expect(range.end).toBe('2026-03-02');
        });
    });

    // Edge case: filter called on a Sunday
    describe('current_week when today is Sunday', () => {
        it('start is the Monday 6 days earlier', () => {
            vi.setSystemTime(new Date('2026-03-01T06:00:00.000Z')); // Sunday
            const range = getDateFilterRange('current_week');
            expect(range.start).toBe('2026-02-23');
            expect(range.end).toBe('2026-03-01');
        });
    });

    // --- last_week ---
    describe('last_week', () => {
        it('end date is the Sunday before the current week (2026-02-22)', () => {
            const range = getDateFilterRange('last_week');
            expect(range.end).toBe('2026-02-22');
        });

        it('start date is the Monday before the current week (2026-02-16)', () => {
            const range = getDateFilterRange('last_week');
            expect(range.start).toBe('2026-02-16');
        });

        it('start is a Monday', () => {
            const range = getDateFilterRange('last_week');
            expect(utcDate(range.start).getUTCDay()).toBe(1);
        });

        it('end is a Sunday', () => {
            const range = getDateFilterRange('last_week');
            expect(utcDate(range.end).getUTCDay()).toBe(0);
        });

        it('start ≤ end', () => {
            const range = getDateFilterRange('last_week');
            expect(range.start <= range.end).toBe(true);
        });

        it('spans exactly 7 days', () => {
            const range = getDateFilterRange('last_week');
            const diff = utcDate(range.end) - utcDate(range.start);
            expect(diff).toBe(6 * 24 * 60 * 60 * 1000);
        });
    });

    // --- current_month ---
    describe('current_month', () => {
        it('end date is today (2026-02-25)', () => {
            const range = getDateFilterRange('current_month');
            expect(range.end).toBe('2026-02-25');
        });

        it('start date is the first of the current month (2026-02-01)', () => {
            const range = getDateFilterRange('current_month');
            expect(range.start).toBe('2026-02-01');
        });

        it('start ≤ end', () => {
            const range = getDateFilterRange('current_month');
            expect(range.start <= range.end).toBe(true);
        });
    });

    // Edge case: first day of month
    describe('current_month when today is the 1st', () => {
        it('start equals today', () => {
            vi.setSystemTime(new Date('2026-03-01T00:30:00.000Z'));
            const range = getDateFilterRange('current_month');
            expect(range.start).toBe('2026-03-01');
            expect(range.end).toBe('2026-03-01');
        });
    });

    // --- last_month ---
    describe('last_month', () => {
        it('start date is the first of January 2026 (2026-01-01)', () => {
            const range = getDateFilterRange('last_month');
            expect(range.start).toBe('2026-01-01');
        });

        it('end date is the last day of January 2026 (2026-01-31)', () => {
            const range = getDateFilterRange('last_month');
            expect(range.end).toBe('2026-01-31');
        });

        it('start ≤ end', () => {
            const range = getDateFilterRange('last_month');
            expect(range.start <= range.end).toBe(true);
        });

        it('handles crossing a year boundary (today = 2026-01-15)', () => {
            vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));
            const range = getDateFilterRange('last_month');
            expect(range.start).toBe('2025-12-01');
            expect(range.end).toBe('2025-12-31');
        });

        it('handles February in a leap year correctly (today = 2024-03-15)', () => {
            vi.setSystemTime(new Date('2024-03-15T12:00:00.000Z'));
            const range = getDateFilterRange('last_month');
            expect(range.start).toBe('2024-02-01');
            expect(range.end).toBe('2024-02-29'); // 2024 is a leap year
        });
    });

    // --- last_3_months ---
    describe('last_3_months', () => {
        it('end date is today (2026-02-25)', () => {
            const range = getDateFilterRange('last_3_months');
            expect(range.end).toBe('2026-02-25');
        });

        it('start date is exactly 3 calendar months back (2025-11-25)', () => {
            const range = getDateFilterRange('last_3_months');
            expect(range.start).toBe('2025-11-25');
        });

        it('start ≤ end', () => {
            const range = getDateFilterRange('last_3_months');
            expect(range.start <= range.end).toBe(true);
        });

        it('handles crossing a year boundary (today = 2026-02-01)', () => {
            vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));
            const range = getDateFilterRange('last_3_months');
            expect(range.start).toBe('2025-11-01');
            expect(range.end).toBe('2026-02-01');
        });
    });
});

// ---------------------------------------------------------------------------
// filterDataByDateRange
// ---------------------------------------------------------------------------

describe('filterDataByDateRange', () => {
    // Freeze time to 2026-02-25 (Wednesday)
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-25T12:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns the original data unchanged when filter is "all"', () => {
        const result = filterDataByDateRange(SAMPLE_DATA, 'all');
        expect(result).toBe(SAMPLE_DATA);
    });

    it('returns the original data unchanged for an unknown filter', () => {
        const result = filterDataByDateRange(SAMPLE_DATA, 'bogus');
        expect(result).toBe(SAMPLE_DATA);
    });

    // current_week (2026-02-23 – 2026-02-25)
    it('current_week includes only 2026-02-24 record', () => {
        const result = filterDataByDateRange(SAMPLE_DATA, 'current_week');
        const dates = result.summaries.map(s => s.date);
        expect(dates).toContain('2026-02-24');
        expect(dates).not.toContain('2026-02-20');
        expect(dates).not.toContain('2026-01-10');
    });

    it('current_week returns empty summaries when no data falls in range', () => {
        const noRecentData = { ...SAMPLE_DATA, summaries: SAMPLE_DATA.summaries.filter(s => s.date < '2026-02-23') };
        const result = filterDataByDateRange(noRecentData, 'current_week');
        expect(result.summaries).toHaveLength(0);
        expect(result.totals.totalAmount).toBe(0);
        expect(result.totals.count).toBe(0);
    });

    // last_week (2026-02-16 – 2026-02-22)
    it('last_week includes records from Mon 2026-02-16 to Sun 2026-02-22', () => {
        const result = filterDataByDateRange(SAMPLE_DATA, 'last_week');
        const dates = result.summaries.map(s => s.date);
        // 2026-02-20 (Friday) is within last_week range → included
        expect(dates).toContain('2026-02-20');
        // 2026-02-24 is this week → excluded
        expect(dates).not.toContain('2026-02-24');
        // 2026-01-10 is before last week → excluded
        expect(dates).not.toContain('2026-01-10');
    });

    // current_month (2026-02-01 – 2026-02-25)
    it('current_month includes all February 2026 records', () => {
        const result = filterDataByDateRange(SAMPLE_DATA, 'current_month');
        const dates = result.summaries.map(s => s.date);
        expect(dates).toContain('2026-02-20');
        expect(dates).toContain('2026-02-24');
        expect(dates).not.toContain('2026-01-10');
    });

    // last_month (2026-01-01 – 2026-01-31)
    it('last_month includes only January 2026 records', () => {
        const result = filterDataByDateRange(SAMPLE_DATA, 'last_month');
        const dates = result.summaries.map(s => s.date);
        expect(dates).toContain('2026-01-10');
        expect(dates).not.toContain('2026-02-20');
        expect(dates).not.toContain('2025-12-01');
    });

    // last_3_months (2025-11-25 – 2026-02-25)
    it('last_3_months includes records from Nov 2025 onward', () => {
        const result = filterDataByDateRange(SAMPLE_DATA, 'last_3_months');
        const dates = result.summaries.map(s => s.date);
        expect(dates).toContain('2025-12-01');
        expect(dates).toContain('2026-01-10');
        expect(dates).toContain('2026-02-20');
        expect(dates).toContain('2026-02-24');
        // 2025-11-15 is before 2025-11-25 start → excluded
        expect(dates).not.toContain('2025-11-15');
        expect(dates).not.toContain('2025-10-01');
    });

    // Totals recomputation
    it('recomputes totals correctly for last_month', () => {
        // Only 2026-01-10 DeviceA: count=1, totalAmount=1.0
        const result = filterDataByDateRange(SAMPLE_DATA, 'last_month');
        expect(result.totals.count).toBe(1);
        expect(result.totals.totalAmount).toBeCloseTo(1.0);
    });

    // perDevice recomputation
    it('recomputes perDevice averages for current_month', () => {
        // Feb 2026: DeviceA (2026-02-20, count=6, total=6.0) + DeviceB (2026-02-24, count=2, total=2.0)
        const result = filterDataByDateRange(SAMPLE_DATA, 'current_month');
        const deviceMap = Object.fromEntries(result.averages.perDevice.map(d => [d.licenseAlias, d]));
        expect(deviceMap['DeviceA'].totalAmount).toBeCloseTo(6.0);
        expect(deviceMap['DeviceB'].totalAmount).toBeCloseTo(2.0);
    });

    // perDay recomputation
    it('recomputes perDay sorted by date for current_month', () => {
        const result = filterDataByDateRange(SAMPLE_DATA, 'current_month');
        const dates = result.averages.perDay.map(d => d.date);
        expect(dates).toEqual([...dates].sort());
    });

    // Does not mutate input
    it('does not mutate the original data object', () => {
        const originalLength = SAMPLE_DATA.summaries.length;
        filterDataByDateRange(SAMPLE_DATA, 'current_week');
        expect(SAMPLE_DATA.summaries).toHaveLength(originalLength);
    });

    // Preserves non-summaries fields (meta)
    it('preserves meta field from original data', () => {
        const result = filterDataByDateRange(SAMPLE_DATA, 'current_month');
        expect(result.meta).toEqual(SAMPLE_DATA.meta);
    });

    // dailyByDevice calculation
    it('calculates dailyByDevice as average of per-summary averageAmounts', () => {
        // current_month: DeviceA (avg=1.0) + DeviceB (avg=1.0) → dailyByDevice = 1.0
        const result = filterDataByDateRange(SAMPLE_DATA, 'current_month');
        expect(result.averages.dailyByDevice).toBeCloseTo(1.0);
    });
});
