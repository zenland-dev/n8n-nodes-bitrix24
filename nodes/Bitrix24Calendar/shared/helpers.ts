import type { IDataObject, IExecuteFunctions, ILoadOptionsFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { cached, CONFIG_TTL_MS } from '../../../shared/cache';
import { instantOf, isTimeZone, wallDate, wallDateTime, wallParts } from '../../../shared/datetime';
import { compact, stringList } from '../../../shared/params';
import { bitrix24Request, portalKey } from '../../../shared/transport';
import { idList } from '../../../shared/values';

export type CalendarContext = IExecuteFunctions | ILoadOptionsFunctions;

// ── Whose calendar ─────────────────────────────────────────────────────────

export const USER_TYPE = 'user';
export const GROUP_TYPE = 'group';
export const COMPANY_TYPE = 'company_calendar';

/** Calendars an event can live in. The company calendar has owner 0. */
export const calendarTypeProperty: INodeProperties = {
	displayName: 'Calendar Type',
	name: 'calendarType',
	type: 'options',
	default: USER_TYPE,
	options: [
		{ name: 'Company', value: COMPANY_TYPE, description: 'The calendar everyone on the portal sees' },
		{ name: 'Group', value: GROUP_TYPE, description: 'The calendar of a workgroup or project' },
		{ name: 'User', value: USER_TYPE, description: 'The personal calendar of an employee' },
	],
	description: 'Whose calendar to work with',
};

export const ownerIdProperty: INodeProperties = {
	displayName: 'Owner ID',
	name: 'ownerId',
	type: 'number',
	default: 0,
	displayOptions: { show: { calendarType: [USER_TYPE, GROUP_TYPE] } },
	description: 'ID of the user or of the workgroup whose calendar it is',
	hint: 'Leave 0 for the user the webhook acts as',
};

/** The ID of the user the webhook acts as, memoised per portal. */
export async function webhookUserId(ctx: CalendarContext, itemIndex?: number): Promise<number> {
	const portal = await portalKey.call(ctx);
	return await cached(
		`calendar:profile:${portal}`,
		async () => {
			const body = await bitrix24Request.call(ctx, 'profile', {}, { itemIndex });
			const id = Number((body.result as IDataObject | null)?.ID ?? 0);
			if (!Number.isInteger(id) || id <= 0) {
				throw new NodeOperationError(ctx.getNode(), 'Bitrix24 did not say which user the webhook acts as', {
					itemIndex,
					description: 'The profile method answered without an ID. Check that the webhook is still valid.',
				});
			}
			return id;
		},
		CONFIG_TTL_MS,
	);
}

/**
 * `type` and `ownerId` as the calendar methods want them.
 *
 * A group calendar has no default owner, so 0 there is a mistake worth naming. For a user
 * calendar 0 means the webhook user, and the ID is read from `profile`: `calendar.event.add`
 * lists `ownerId` as required.
 */
export async function calendarTarget(ctx: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const type = String(ctx.getNodeParameter('calendarType', itemIndex));
	if (type === COMPANY_TYPE) return { type, ownerId: 0 };

	const ownerId = Number(ctx.getNodeParameter('ownerId', itemIndex, 0)) || 0;
	if (ownerId > 0) return { type, ownerId };

	if (type === GROUP_TYPE) {
		throw new NodeOperationError(ctx.getNode(), 'Owner ID is the workgroup a group calendar belongs to', {
			itemIndex,
			description: 'Fill in the ID of the workgroup or project. Bitrix24 has no default owner for a group calendar.',
		});
	}
	return { type, ownerId: await webhookUserId(ctx, itemIndex) };
}

// ── Which calendar inside it ───────────────────────────────────────────────

export const sectionModeProperty: INodeProperties = {
	displayName: 'Calendar',
	name: 'sectionMode',
	type: 'options',
	default: 'auto',
	options: [
		{ name: 'Auto-Detect', value: 'auto', description: 'Let Bitrix24 pick the calendar of that owner' },
		{ name: 'By ID', value: 'id', description: 'Put the event into one named calendar' },
	],
	description: 'Which calendar of the owner the event goes into',
};

export const sectionIdProperty: INodeProperties = {
	displayName: 'Calendar Name or ID',
	name: 'sectionId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getSections', loadOptionsDependsOn: ['calendarType', 'ownerId'] },
	default: '',
	displayOptions: { show: { sectionMode: ['id'] } },
	description:
		'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	hint: 'The list holds the calendars of the owner above',
};

/** `section` and `auto_detect_section` from the two parameters above. */
export function readSection(ctx: IExecuteFunctions, itemIndex: number): IDataObject {
	const mode = String(ctx.getNodeParameter('sectionMode', itemIndex, 'auto'));
	if (mode !== 'id') return { auto_detect_section: 'Y' };

	const section = Number(ctx.getNodeParameter('sectionId', itemIndex, 0));
	if (!Number.isInteger(section) || section <= 0) {
		throw new NodeOperationError(ctx.getNode(), 'Pick a calendar or switch to Auto-Detect', { itemIndex });
	}
	return { section, auto_detect_section: 'N' };
}

// ── Dates ──────────────────────────────────────────────────────────────────

export const timeZoneProperty: INodeProperties = {
	displayName: 'Time Zone',
	name: 'timeZone',
	type: 'string',
	default: '',
	placeholder: 'Europe/Riga',
	description: 'IANA time zone the event is held in. Defaults to the time zone of the workflow.',
};

/** The zone to write the event in: the parameter, or the workflow's own. */
export function zoneOf(ctx: IExecuteFunctions, value: unknown, itemIndex: number): string {
	const text = String(value ?? '').trim();
	if (text === '') return ctx.getTimezone();
	if (!isTimeZone(text)) {
		throw new NodeOperationError(ctx.getNode(), `"${text}" is not a time zone name`, {
			itemIndex,
			description: 'Write it as Europe/Riga or America/New_York.',
		});
	}
	return text;
}

function instant(ctx: IExecuteFunctions, value: unknown, label: string, itemIndex: number): Date {
	const text = String(value ?? '').trim();
	const date = text === '' ? undefined : instantOf(text, ctx.getTimezone());
	if (date === undefined) {
		throw new NodeOperationError(ctx.getNode(), `${label} is not a date`, {
			itemIndex,
			description: 'Give a date such as 2026-09-16, or a date and time, or an expression that returns one.',
		});
	}
	return date;
}

/**
 * An event date as Bitrix24 reads it best: plain local time next to `timezone_from`.
 *
 * A full ISO-8601 string with an offset also works, and then the zone parameters are
 * ignored — but the event keeps whichever zone the portal picks rather than the one asked
 * for. An all-day event takes the date alone.
 */
export function eventMoment(
	ctx: IExecuteFunctions,
	value: unknown,
	label: string,
	itemIndex: number,
	zone: string,
	allDay: boolean,
): string {
	const parts = wallParts(instant(ctx, value, label, itemIndex), zone);
	return allDay ? wallDate(parts) : wallDateTime(parts);
}

/** A plain date for the methods that select a period: they take YYYY-MM-DD. */
export function dayOf(ctx: IExecuteFunctions, value: unknown, label: string, itemIndex: number): string {
	return wallDate(wallParts(instant(ctx, value, label, itemIndex), ctx.getTimezone()));
}

export function optionalDay(
	ctx: IExecuteFunctions,
	value: unknown,
	label: string,
	itemIndex: number,
): string | undefined {
	return String(value ?? '').trim() === '' ? undefined : dayOf(ctx, value, label, itemIndex);
}

// ── Event parts ────────────────────────────────────────────────────────────

export const remindersProperty: INodeProperties = {
	displayName: 'Reminders',
	name: 'reminders',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	placeholder: 'Add Reminder',
	default: {},
	description: 'When to remind the participants. On Update the list replaces the current one.',
	options: [
		{
			displayName: 'Reminder',
			name: 'reminder',
			values: [
				{
					displayName: 'Before the Event',
					name: 'count',
					type: 'number',
					typeOptions: { minValue: 0 },
					default: 15,
					description: 'How many units before the start of the event to remind',
				},
				{
					displayName: 'Unit',
					name: 'type',
					type: 'options',
					default: 'min',
					options: [
						{ name: 'Days', value: 'day' },
						{ name: 'Hours', value: 'hour' },
						{ name: 'Minutes', value: 'min' },
					],
				},
			],
		},
	],
};

export function readReminders(ctx: IExecuteFunctions, itemIndex: number): IDataObject[] | undefined {
	const entries = (ctx.getNodeParameter('reminders.reminder', itemIndex, []) ?? []) as IDataObject[];
	if (entries.length === 0) return undefined;
	return entries.map((e) => ({ type: String(e.type ?? 'min'), count: Number(e.count ?? 0) }));
}

export const recurrenceProperty: INodeProperties = {
	displayName: 'Recurrence',
	name: 'recurrence',
	type: 'fixedCollection',
	default: {},
	placeholder: 'Add Recurrence',
	description: 'Repeat the event. Leave it out for a one-off event.',
	options: [
		{
			displayName: 'Rule',
			name: 'rule',
			values: [
				{
					displayName: 'Every',
					name: 'interval',
					type: 'number',
					typeOptions: { minValue: 1 },
					default: 1,
					description: 'Interval between repeats, counted in the unit above',
				},
				{
					displayName: 'On Days',
					name: 'byDay',
					type: 'multiOptions',
					default: [],
					description:
						'Weekdays the event falls on. Left empty, it repeats on the weekday it starts on; Bitrix24 on its own would fall back to Monday and then leave the event out of every list.',
					displayOptions: { show: { freq: ['WEEKLY'] } },
					options: [
						{ name: 'Friday', value: 'FR' },
						{ name: 'Monday', value: 'MO' },
						{ name: 'Saturday', value: 'SA' },
						{ name: 'Sunday', value: 'SU' },
						{ name: 'Thursday', value: 'TH' },
						{ name: 'Tuesday', value: 'TU' },
						{ name: 'Wednesday', value: 'WE' },
					],
				},
				{
					displayName: 'Repeat Count',
					name: 'count',
					type: 'number',
					typeOptions: { minValue: 0 },
					default: 0,
					description: 'How many times the event repeats. 0 leaves the count open.',
				},
				{
					displayName: 'Repeat Until',
					name: 'until',
					type: 'dateTime',
					default: '',
					description: 'Last day the event repeats on',
				},

				{
					displayName: 'Repeats',
					name: 'freq',
					type: 'options',
					default: 'WEEKLY',
					options: [
						{ name: 'Daily', value: 'DAILY' },
						{ name: 'Monthly', value: 'MONTHLY' },
						{ name: 'Weekly', value: 'WEEKLY' },
						{ name: 'Yearly', value: 'YEARLY' },
					],
				},
			],
		},
	],
};

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** The weekday of a start already written as wall time, `2026-09-25 10:00:00`. */
function weekdayOf(wallTime: string): string | undefined {
	const m = wallTime.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!m) return undefined;
	return WEEKDAY_CODES[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
}

/**
 * The repeat rule, with one correction: a weekly rule always names its weekdays.
 *
 * A WEEKLY rule with no BYDAY is stored with `{MO: MO}` whatever day the event starts on, and
 * such an event then never comes back from `calendar.event.get` — created, readable by ID,
 * invisible in every list (seen on a live portal, 16.09.2026). Naming the weekday of the start
 * is both what the user means and what makes the event show up.
 */
export function readRecurrence(
	ctx: IExecuteFunctions,
	itemIndex: number,
	startWallTime?: string,
): IDataObject | undefined {
	const rule = (ctx.getNodeParameter('recurrence.rule', itemIndex, {}) ?? {}) as IDataObject;
	if (Object.keys(rule).length === 0) return undefined;

	const freq = String(rule.freq ?? 'WEEKLY');
	let byDay = stringList(rule.byDay);
	if (freq === 'WEEKLY' && byDay.length === 0 && startWallTime !== undefined) {
		const weekday = weekdayOf(startWallTime);
		if (weekday !== undefined) byDay = [weekday];
	}

	return compact({
		FREQ: freq,
		INTERVAL: Number(rule.interval ?? 1) || 1,
		COUNT: Number(rule.count ?? 0) > 0 ? Number(rule.count) : undefined,
		BYDAY: byDay.length > 0 ? byDay : undefined,
		UNTIL: optionalDay(ctx, rule.until, 'Repeat Until', itemIndex),
	});
}

export const meetingSettingsProperty: INodeProperties = {
	displayName: 'Meeting Settings',
	name: 'meetingSettings',
	type: 'collection',
	placeholder: 'Add Setting',
	default: {},
	description: 'How the event behaves for the people invited to it',
	options: [
		{
			displayName: 'Guests May Invite Others',
			name: 'allow_invite',
			type: 'boolean',
			default: false,
			description: 'Whether a participant may invite more people to the event',
		},
		{
			displayName: 'Hide Guest List',
			name: 'hide_guests',
			type: 'boolean',
			default: false,
			description: 'Whether participants see who else was invited',
		},
		{
			displayName: 'Notify Organizer of Answers',
			name: 'notify',
			type: 'boolean',
			default: false,
			description: 'Whether the organizer is told when someone accepts or declines',
		},
		{
			displayName: 'Re-Ask After an Edit',
			name: 'reinvite',
			type: 'boolean',
			default: false,
			description: 'Whether participants confirm again after the event is changed',
		},
	],
};

export function readMeetingSettings(ctx: IExecuteFunctions, itemIndex: number): IDataObject | undefined {
	const settings = (ctx.getNodeParameter('meetingSettings', itemIndex, {}) ?? {}) as IDataObject;
	return Object.keys(settings).length === 0 ? undefined : settings;
}

export function readAttendees(ctx: IExecuteFunctions, value: unknown, itemIndex: number): number[] | undefined {
	const ids = idList(ctx, value, 'Attendee User IDs', itemIndex);
	return ids.length === 0 ? undefined : ids;
}

/** CRM records an event is linked to, written as L_1, D_2, C_3, CO_4. */
export function readCrmRecords(
	ctx: IExecuteFunctions,
	value: unknown,
	itemIndex: number,
): string[] | undefined {
	const records = stringList(value);
	if (records.length === 0) return undefined;
	for (const record of records) {
		if (!/^(L|D|C|CO)_\d+$/i.test(record)) {
			throw new NodeOperationError(ctx.getNode(), `"${record}" is not a CRM record of an event`, {
				itemIndex,
				description: 'Write the type before the ID: L_1 lead, D_2 deal, C_3 contact, CO_4 company.',
			});
		}
	}
	return records.map((r) => r.toUpperCase());
}

export const ACCESSIBILITY_OPTIONS = [
	{ name: 'Absent', value: 'absent' },
	{ name: 'Busy', value: 'busy' },
	{ name: 'Free', value: 'free' },
	{ name: 'Tentative', value: 'quest' },
];

export const IMPORTANCE_OPTIONS = [
	{ name: 'High', value: 'high' },
	{ name: 'Low', value: 'low' },
	{ name: 'Normal', value: 'normal' },
];
