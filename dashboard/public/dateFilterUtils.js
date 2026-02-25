/**
 * Returns a UTC { start, end } date-string range for the given filter value,
 * or null when the filter is 'all' (no filtering required).
 *
 * @param {string} filter  One of: 'all' | 'current_week' | 'last_week' |
 *                         'current_month' | 'last_month' | 'last_3_months'
 * @returns {{ start: string, end: string } | null}
 */
export function getDateFilterRange(filter) {
    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    if (filter === 'current_week') {
        const dayOfWeek = todayUTC.getUTCDay();
        const monday = new Date(todayUTC);
        monday.setUTCDate(todayUTC.getUTCDate() - ((dayOfWeek + 6) % 7));
        return { start: monday.toISOString().split('T')[0], end: todayUTC.toISOString().split('T')[0] };
    }

    if (filter === 'last_week') {
        const dayOfWeek = todayUTC.getUTCDay();
        const thisMonday = new Date(todayUTC);
        thisMonday.setUTCDate(todayUTC.getUTCDate() - ((dayOfWeek + 6) % 7));
        const lastMonday = new Date(thisMonday);
        lastMonday.setUTCDate(thisMonday.getUTCDate() - 7);
        const lastSunday = new Date(thisMonday);
        lastSunday.setUTCDate(thisMonday.getUTCDate() - 1);
        return { start: lastMonday.toISOString().split('T')[0], end: lastSunday.toISOString().split('T')[0] };
    }

    if (filter === 'current_month') {
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        return { start: monthStart.toISOString().split('T')[0], end: todayUTC.toISOString().split('T')[0] };
    }

    if (filter === 'last_month') {
        const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
        return { start: lastMonthStart.toISOString().split('T')[0], end: lastMonthEnd.toISOString().split('T')[0] };
    }

    if (filter === 'last_3_months') {
        const threeMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, now.getUTCDate()));
        return { start: threeMonthsAgo.toISOString().split('T')[0], end: todayUTC.toISOString().split('T')[0] };
    }

    return null;
}

/**
 * Filters a processed-data object (as returned by processAllocations) to only
 * include records within the date range for the given filter, then recomputes
 * all derived aggregates.
 *
 * @param {object} data    Processed data with a `summaries` array
 * @param {string} filter  Date filter value (see getDateFilterRange)
 * @returns {object}       Filtered & recomputed data object
 */
export function filterDataByDateRange(data, filter) {
    const range = getDateFilterRange(filter);
    if (!range) return data;

    const filteredSummaries = data.summaries.filter(s => s.date >= range.start && s.date <= range.end);

    const totalCount = filteredSummaries.reduce((sum, s) => sum + s.count, 0);
    const grandTotalAmount = filteredSummaries.reduce((sum, s) => sum + s.totalAmount, 0);

    const deviceGroups = {};
    filteredSummaries.forEach(s => {
        if (!deviceGroups[s.licenseAlias]) deviceGroups[s.licenseAlias] = { total: 0, count: 0 };
        deviceGroups[s.licenseAlias].total += s.totalAmount;
        deviceGroups[s.licenseAlias].count += 1;
    });
    const perDevice = Object.entries(deviceGroups).map(([name, d]) => ({
        licenseAlias: name,
        averageAmount: d.count > 0 ? d.total / d.count : 0,
        totalAmount: d.total
    })).sort((a, b) => b.averageAmount - a.averageAmount);

    const dayGroups = {};
    filteredSummaries.forEach(s => {
        if (!dayGroups[s.date]) dayGroups[s.date] = { total: 0, count: 0, recordCount: 0 };
        dayGroups[s.date].total += s.totalAmount;
        dayGroups[s.date].count += 1;
        dayGroups[s.date].recordCount += s.count;
    });
    const perDay = Object.entries(dayGroups).map(([date, d]) => ({
        date,
        count: d.recordCount,
        deviceCount: d.count,
        totalAmount: d.total,
        averageAmount: d.count > 0 ? d.total / d.count : 0,
        averagePerReward: d.recordCount > 0 ? d.total / d.recordCount : 0
    })).sort((a, b) => a.date.localeCompare(b.date));

    let totalDailyDeviceAverages = 0;
    let dailyDeviceCount = 0;
    filteredSummaries.forEach(s => {
        if (s.count > 0) {
            totalDailyDeviceAverages += s.averageAmount;
            dailyDeviceCount++;
        }
    });
    const dailyByDevice = dailyDeviceCount > 0 ? totalDailyDeviceAverages / dailyDeviceCount : 0;

    return {
        ...data,
        summaries: filteredSummaries,
        totals: { count: totalCount, totalAmount: grandTotalAmount },
        averages: { perDevice, perDay, dailyByDevice }
    };
}
