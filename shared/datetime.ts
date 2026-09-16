/**
 * Wall-clock conversions.
 *
 * Bitrix24 modules disagree about time zones: Drive filters compare a value as local
 * time of the webhook user and ignore offsets, the calendar takes either a full
 * ISO-8601 string or a simple date next to a zone name. Both need the same thing —
 * one instant written as it reads on the clock in a given zone.
 */

export interface WallParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

/** How `date` reads on a clock in `timeZone`. Throws on a zone name Node.js does not know. */
export function wallParts(date: Date, timeZone: string): WallParts {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-GB', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hourCycle: 'h23',
		})
			.formatToParts(date)
			.map((p) => [p.type, p.value]),
	);
	return {
		year: +parts.year,
		month: +parts.month,
		day: +parts.day,
		hour: +parts.hour,
		minute: +parts.minute,
		second: +parts.second,
	};
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** 2026-09-16 */
export const wallDate = (p: WallParts): string => `${p.year}-${pad(p.month)}-${pad(p.day)}`;

/** 2026-09-16 14:30:00 */
export const wallDateTime = (p: WallParts): string =>
	`${wallDate(p)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;

/** An instant from the value of a dateTime parameter; a value without an offset is in `timeZone`. */
export function instantOf(value: string, timeZone: string): Date | undefined {
	if (/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? undefined : date;
	}
	const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
	if (!m) return undefined;
	const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
	const seen = wallParts(new Date(guess), timeZone);
	const offset =
		Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second) - guess;
	return new Date(guess - offset);
}

/** Whether Node.js knows this IANA zone name. */
export function isTimeZone(name: string): boolean {
	try {
		new Intl.DateTimeFormat('en-GB', { timeZone: name });
		return true;
	} catch {
		return false;
	}
}
