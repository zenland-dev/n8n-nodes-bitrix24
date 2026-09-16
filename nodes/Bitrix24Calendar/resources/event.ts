import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { extractRows } from '../../../shared/list';
import { compact, returnAllProperties } from '../../../shared/params';
import { numberProperty, positiveInt, stringProperty } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { idList, yn } from '../../../shared/values';
import {
	ACCESSIBILITY_OPTIONS,
	calendarTarget,
	calendarTypeProperty,
	COMPANY_TYPE,
	dayOf,
	eventMoment,
	GROUP_TYPE,
	IMPORTANCE_OPTIONS,
	meetingSettingsProperty,
	optionalDay,
	ownerIdProperty,
	readAttendees,
	readCrmRecords,
	readMeetingSettings,
	readReminders,
	readRecurrence,
	readSection,
	recurrenceProperty,
	remindersProperty,
	sectionIdProperty,
	sectionModeProperty,
	timeZoneProperty,
	USER_TYPE,
	zoneOf,
} from '../shared/helpers';

const eventIdProperty = numberProperty('Event ID', 'eventId', 'ID of the event, as Get Many returns it in ID');

/** The answer of add and update: an ID, or the description of a new series for a recurring event. */
function eventWritten(result: unknown): IDataObject {
	if (result !== null && typeof result === 'object' && !Array.isArray(result)) return result as IDataObject;
	return { id: Number(result) };
}

/** Fields shared by Create and Update, read from wherever that operation keeps them. */
function eventFields(
	ctx: IExecuteFunctions,
	itemIndex: number,
	source: IDataObject,
	allDay: boolean,
	zone: string,
	startWallTime?: string,
): IDataObject {
	const attendees = readAttendees(ctx, source.attendees, itemIndex);
	return compact({
		description: source.description,
		color: source.color,
		text_color: source.textColor,
		accessibility: source.accessibility,
		importance: source.importance,
		private_event: yn(source.private),
		location: source.location,
		attendees,
		// Without is_meeting an attendee list is stored but nobody is invited.
		is_meeting: attendees === undefined ? undefined : 'Y',
		meeting: readMeetingSettings(ctx, itemIndex),
		remind: readReminders(ctx, itemIndex),
		rrule: readRecurrence(ctx, itemIndex, startWallTime),
		crm_fields: readCrmRecords(ctx, source.crmRecords, itemIndex),
		timezone_from: allDay ? undefined : zone,
		timezone_to: allDay ? undefined : zone,
	});
}

const createFields: INodeProperties = {
	displayName: 'Additional Fields',
	name: 'additionalFields',
	type: 'collection',
	placeholder: 'Add Field',
	default: {},
	options: [
		{
			displayName: 'Accessibility',
			name: 'accessibility',
			type: 'options',
			default: 'busy',
			options: ACCESSIBILITY_OPTIONS,
			description: 'How the participants look to others while the event lasts',
		},
		{
			displayName: 'Color',
			name: 'color',
			type: 'color',
			default: '',
			description: 'Background colour of the event in the calendar grid',
		},
		{
			displayName: 'CRM Records',
			name: 'crmRecords',
			type: 'string',
			default: '',
			placeholder: 'D_10, C_7',
			description: 'Comma-separated CRM records to link: L_ lead, D_ deal, C_ contact, CO_ company',
		},
		{
			displayName: 'Description',
			name: 'description',
			type: 'string',
			typeOptions: { rows: 4 },
			default: '',
			description: 'Text of the event',
		},
		{
			displayName: 'Importance',
			name: 'importance',
			type: 'options',
			default: 'normal',
			options: IMPORTANCE_OPTIONS,
		},
		{
			displayName: 'Location',
			name: 'location',
			type: 'string',
			default: '',
			description: 'Where it takes place, as free text',
		},
		{
			displayName: 'Private',
			name: 'private',
			type: 'boolean',
			default: false,
			description: 'Whether others see only that the time is taken, without the details',
		},
		{
			displayName: 'Text Color',
			name: 'textColor',
			type: 'color',
			default: '',
			description: 'Colour of the event title in the calendar grid',
		},
		timeZoneProperty,
	],
};

const updateFields: INodeProperties = {
	displayName: 'Update Fields',
	name: 'updateFields',
	type: 'collection',
	placeholder: 'Add Field',
	default: {},
	options: [
		{
			displayName: 'Accessibility',
			name: 'accessibility',
			type: 'options',
			default: 'busy',
			options: ACCESSIBILITY_OPTIONS,
			description: 'How the participants look to others while the event lasts',
		},
		{
			displayName: 'All Day',
			name: 'allDay',
			type: 'boolean',
			default: false,
			description: 'Whether the event takes the whole day, with no time of its own',
		},
		{
			displayName: 'Attendee User IDs',
			name: 'attendees',
			type: 'string',
			default: '',
			placeholder: '12, 34',
			description: 'Comma-separated IDs of the people invited. The list replaces the current one.',
		},
		{
			displayName: 'Calendar ID',
			name: 'sectionId',
			type: 'number',
			default: 0,
			description: 'Move the event into another calendar of the same owner',
		},
		{
			displayName: 'Color',
			name: 'color',
			type: 'color',
			default: '',
			description: 'Background colour of the event in the calendar grid',
		},
		{
			displayName: 'CRM Records',
			name: 'crmRecords',
			type: 'string',
			default: '',
			placeholder: 'D_10, C_7',
			description: 'Comma-separated CRM records to link: L_ lead, D_ deal, C_ contact, CO_ company',
		},
		{
			displayName: 'Description',
			name: 'description',
			type: 'string',
			typeOptions: { rows: 4 },
			default: '',
			description: 'Text of the event',
		},
		{
			displayName: 'End',
			name: 'to',
			type: 'dateTime',
			default: '',
			description: 'New end of the event. Set it together with Start.',
		},
		{
			displayName: 'Importance',
			name: 'importance',
			type: 'options',
			default: 'normal',
			options: IMPORTANCE_OPTIONS,
		},
		{
			displayName: 'Location',
			name: 'location',
			type: 'string',
			default: '',
			description: 'Where it takes place, as free text',
		},
		{
			displayName: 'Name',
			name: 'name',
			type: 'string',
			default: '',
			description: 'Title of the event',
		},
		{
			displayName: 'Organizer User ID',
			name: 'host',
			type: 'number',
			default: 0,
			description:
				'The current organizer, needed when the webhook user is not the one who created the meeting. It does not hand the event over to someone else.',
		},
		{
			displayName: 'Private',
			name: 'private',
			type: 'boolean',
			default: false,
			description: 'Whether others see only that the time is taken, without the details',
		},
		{
			displayName: 'Start',
			name: 'from',
			type: 'dateTime',
			default: '',
			description: 'New start of the event. Set it together with End.',
		},
		{
			displayName: 'Text Color',
			name: 'textColor',
			type: 'color',
			default: '',
			description: 'Colour of the event title in the calendar grid',
		},
		timeZoneProperty,
	],
};

export const eventResource: Resource = {
	value: 'event',
	name: 'Event',
	description: 'Meetings and appointments in a user, group or company calendar',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Create a calendar event',
			description: 'Add an event to a calendar, with participants, reminders and a recurrence rule',
			properties: [
				calendarTypeProperty,
				ownerIdProperty,
				stringProperty('Name', 'name', 'Title of the event', true),
				{
					displayName: 'Start',
					name: 'from',
					type: 'dateTime',
					required: true,
					default: '',
					description: 'When the event begins',
				},
				{
					displayName: 'End',
					name: 'to',
					type: 'dateTime',
					required: true,
					default: '',
					description: 'When the event ends',
				},
				{
					displayName: 'All Day',
					name: 'allDay',
					type: 'boolean',
					default: false,
					description: 'Whether the event takes the whole day, with no time of its own',
				},
				sectionModeProperty,
				sectionIdProperty,
				{
					displayName: 'Attendee User IDs',
					name: 'attendees',
					type: 'string',
					default: '',
					placeholder: '12, 34',
					description:
						'Comma-separated IDs of the people to invite. They get an invitation to answer; leave it empty for an event only the owner sees.',
				},
				createFields,
				remindersProperty,
				recurrenceProperty,
				meetingSettingsProperty,
			],
			async execute(itemIndex) {
				const allDay = this.getNodeParameter('allDay', itemIndex) as boolean;
				const extra = (this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject;
				const zone = zoneOf(this, extra.timeZone, itemIndex);
				const source: IDataObject = { ...extra, attendees: this.getNodeParameter('attendees', itemIndex, '') };

				const from = eventMoment(this, this.getNodeParameter('from', itemIndex), 'Start', itemIndex, zone, allDay);
				const params: IDataObject = {
					...(await calendarTarget(this, itemIndex)),
					...readSection(this, itemIndex),
					name: this.getNodeParameter('name', itemIndex),
					from,
					to: eventMoment(this, this.getNodeParameter('to', itemIndex), 'End', itemIndex, zone, allDay),
					skip_time: allDay ? 'Y' : 'N',
					...eventFields(this, itemIndex, source, allDay, zone, from),
				};

				const body = await bitrix24Request.call(this, 'calendar.event.add', params, { itemIndex });
				return eventWritten(body.result);
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a calendar event',
			description: 'Change an event. Only the fields you fill in are sent.',
			properties: [
				eventIdProperty,
				calendarTypeProperty,
				ownerIdProperty,
				updateFields,
				remindersProperty,
				recurrenceProperty,
				meetingSettingsProperty,
				{
					displayName: 'Change',
					name: 'recurrenceMode',
					type: 'options',
					default: '',
					options: [
						{ name: 'All Events in the Series', value: 'all' },
						{ name: 'Only This Event', value: 'this' },
						{ name: 'This and Following Events', value: 'next' },
						{ name: 'Whole Event', value: '' },
					],
					description:
						'Which part of a recurring event to change. Whole Event is for events that do not repeat.',
				},
				{
					displayName: 'Date of This Occurrence',
					name: 'currentDateFrom',
					type: 'dateTime',
					default: '',
					required: true,
					displayOptions: { show: { recurrenceMode: ['this', 'next'] } },
					description: 'Start date of the occurrence being changed, as the series shows it',
				},
			],
			async execute(itemIndex) {
				const fields = (this.getNodeParameter('updateFields', itemIndex, {}) ?? {}) as IDataObject;
				const allDay = fields.allDay === true;
				const zone = zoneOf(this, fields.timeZone, itemIndex);
				const mode = String(this.getNodeParameter('recurrenceMode', itemIndex, ''));

				const from =
					fields.from === undefined ? undefined : eventMoment(this, fields.from, 'Start', itemIndex, zone, allDay);

				const params: IDataObject = compact({
					id: positiveInt(this, 'eventId', itemIndex, 'Event ID'),
					...(await calendarTarget(this, itemIndex)),
					name: fields.name,
					section: Number(fields.sectionId ?? 0) > 0 ? Number(fields.sectionId) : undefined,
					host: Number(fields.host ?? 0) > 0 ? Number(fields.host) : undefined,
					from,
					to:
						fields.to === undefined ? undefined : eventMoment(this, fields.to, 'End', itemIndex, zone, allDay),
					skip_time: yn(fields.allDay),
					recurrence_mode: mode === '' ? undefined : mode,
					current_date_from:
						mode === 'this' || mode === 'next'
							? dayOf(this, this.getNodeParameter('currentDateFrom', itemIndex), 'Date of This Occurrence', itemIndex)
							: undefined,
					...eventFields(this, itemIndex, fields, allDay, zone, from),
				});

				const body = await bitrix24Request.call(this, 'calendar.event.update', params, { itemIndex });
				return eventWritten(body.result);
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a calendar event',
			description: 'Remove an event from the calendar. A recurring event goes with its whole series.',
			properties: [eventIdProperty],
			async execute(itemIndex) {
				await bitrix24Request.call(
					this,
					'calendar.event.delete',
					{ id: positiveInt(this, 'eventId', itemIndex, 'Event ID') },
					{ itemIndex },
				);
				return undefined;
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get a calendar event',
			description: 'Retrieve one event by ID, with its participants, reminders and recurrence rule',
			properties: [eventIdProperty],
			async execute(itemIndex) {
				const id = positiveInt(this, 'eventId', itemIndex, 'Event ID');
				const body = await bitrix24Request.call(this, 'calendar.event.getbyid', { id }, { itemIndex });
				const event = (body.result ?? {}) as IDataObject;
				// A deleted or unknown event answers an empty object rather than an error.
				if (Object.keys(event).length === 0) {
					throw new NodeOperationError(this.getNode(), `Bitrix24 has no event ${id}`, {
						itemIndex,
						description: 'It was deleted, or the webhook user cannot see the calendar it is in.',
					});
				}
				return event;
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many calendar events',
			description:
				'List the events of one calendar owner over a period. Bitrix24 returns them all at once, from a month back to three months ahead by default.',
			properties: [
				calendarTypeProperty,
				ownerIdProperty,
				...returnAllProperties('events'),
				{
					displayName: 'From',
					name: 'from',
					type: 'dateTime',
					default: '',
					description: 'Start of the period. Bitrix24 takes one month before today when it is empty.',
				},
				{
					displayName: 'To',
					name: 'to',
					type: 'dateTime',
					default: '',
					description:
						'End of the period, not counted in itself. Bitrix24 takes three months after today when it is empty; the same day in From and To returns nothing.',
				},
				{
					displayName: 'Calendar IDs',
					name: 'sectionIds',
					type: 'string',
					default: '',
					placeholder: '4, 7',
					description: 'Comma-separated IDs of the calendars to read. Empty reads every calendar of the owner.',
				},
			],
			async execute(itemIndex) {
				const sections = idList(this, this.getNodeParameter('sectionIds', itemIndex, ''), 'Calendar IDs', itemIndex);
				const params: IDataObject = compact({
					...(await calendarTarget(this, itemIndex)),
					from: optionalDay(this, this.getNodeParameter('from', itemIndex, ''), 'From', itemIndex),
					to: optionalDay(this, this.getNodeParameter('to', itemIndex, ''), 'To', itemIndex),
					section: sections.length > 0 ? sections : undefined,
				});

				const body = await bitrix24Request.call(this, 'calendar.event.get', params, { itemIndex });
				const rows = extractRows(body.result);
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				return returnAll ? rows : rows.slice(0, this.getNodeParameter('limit', itemIndex) as number);
			},
		},
		{
			value: 'getUpcoming',
			name: 'Get Upcoming',
			action: 'Get upcoming calendar events',
			description: 'List the events of the days ahead, across the calendars the webhook user follows',
			properties: [
				...returnAllProperties('events'),
				{
					displayName: 'Options',
					name: 'options',
					type: 'collection',
					placeholder: 'Add Option',
					default: {},
					options: [
						{
							displayName: 'Calendar Type',
							name: 'type',
							type: 'options',
							default: USER_TYPE,
							options: [
								{ name: 'Company', value: COMPANY_TYPE },
								{ name: 'Group', value: GROUP_TYPE },
								{ name: 'User', value: USER_TYPE },
							],
							description: 'Read one kind of calendar instead of every calendar of the user',
						},
						{
							displayName: 'Days Ahead',
							name: 'days',
							type: 'number',
							typeOptions: { minValue: 1 },
							default: 60,
							description: 'How far ahead to look. Bitrix24 takes 60 days when it is empty.',
						},
						{
							displayName: 'For the Webhook User',
							name: 'forCurrentUser',
							type: 'boolean',
							default: true,
							description: 'Whether to list only the events the webhook user takes part in',
						},
						{
							displayName: 'Owner ID',
							name: 'ownerId',
							type: 'number',
							default: 0,
							description: 'Owner of the calendar to read, together with Calendar Type',
						},
					],
				},
			],
			async execute(itemIndex) {
				const options = (this.getNodeParameter('options', itemIndex, {}) ?? {}) as IDataObject;
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);

				const params: IDataObject = compact({
					type: options.type,
					ownerId: Number(options.ownerId ?? 0) > 0 ? Number(options.ownerId) : undefined,
					days: Number(options.days ?? 0) > 0 ? Number(options.days) : undefined,
					forCurrentUser: options.forCurrentUser,
					maxEventsCount: limit,
				});

				const body = await bitrix24Request.call(this, 'calendar.event.get.nearest', params, { itemIndex });
				const rows = extractRows(body.result);
				return limit === undefined ? rows : rows.slice(0, limit);
			},
		},
		{
			value: 'getMeetingStatus',
			name: 'Get Meeting Status',
			action: 'Get the participation status of the webhook user',
			description:
				'Read whether the webhook user accepted, declined or has yet to answer an invitation. An event with no participants has no status, and Bitrix24 answers with an error.',
			properties: [eventIdProperty],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(
					this,
					'calendar.meeting.status.get',
					{ eventId: positiveInt(this, 'eventId', itemIndex, 'Event ID') },
					{ itemIndex },
				);
				return { status: body.result };
			},
		},
		{
			value: 'setMeetingStatus',
			name: 'Set Meeting Status',
			action: 'Set the participation status of the webhook user',
			description:
				'Accept or decline an invitation on behalf of the user the webhook acts as. On an event with no participants Bitrix24 answers success and stores nothing.',
			properties: [
				eventIdProperty,
				{
					displayName: 'Status',
					name: 'status',
					type: 'options',
					default: 'Y',
					options: [
						{ name: 'Accepted', value: 'Y' },
						{ name: 'Declined', value: 'N' },
						{ name: 'Not Answered Yet', value: 'Q' },
					],
					description: 'The answer to record for the webhook user',
				},
			],
			async execute(itemIndex) {
				await bitrix24Request.call(
					this,
					'calendar.meeting.status.set',
					{
						eventId: positiveInt(this, 'eventId', itemIndex, 'Event ID'),
						status: this.getNodeParameter('status', itemIndex),
					},
					{ itemIndex },
				);
				return undefined;
			},
		},
		{
			value: 'getAvailability',
			name: 'Get Availability',
			action: 'Get the availability of users',
			description:
				'Find when people are busy over a period, to pick a time that suits everyone. Only events that take up time count; one marked free does not.',
			properties: [
				{
					displayName: 'User IDs',
					name: 'userIds',
					type: 'string',
					required: true,
					default: '',
					placeholder: '12, 34',
					description: 'Comma-separated IDs of the people to check',
				},
				{
					displayName: 'From',
					name: 'from',
					type: 'dateTime',
					required: true,
					default: '',
					description: 'First day of the period',
				},
				{
					displayName: 'To',
					name: 'to',
					type: 'dateTime',
					required: true,
					default: '',
					description: 'Last day of the period',
				},
			],
			async execute(itemIndex) {
				const users = idList(this, this.getNodeParameter('userIds', itemIndex), 'User IDs', itemIndex);
				const body = await bitrix24Request.call(
					this,
					'calendar.accessibility.get',
					{
						users,
						from: dayOf(this, this.getNodeParameter('from', itemIndex), 'From', itemIndex),
						to: dayOf(this, this.getNodeParameter('to', itemIndex), 'To', itemIndex),
					},
					{ itemIndex },
				);

				// One row per user, so a user with nothing booked is in the output too.
				const busy = (body.result ?? {}) as IDataObject;
				return users.map((userId) => ({ userId, events: extractRows(busy[String(userId)]) }));
			},
		},
	],
};
