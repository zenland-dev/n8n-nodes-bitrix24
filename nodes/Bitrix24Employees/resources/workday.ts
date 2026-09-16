import type { IDataObject, INodeProperties } from 'n8n-workflow';

import { compact } from '../../../shared/params';
import { numberProperty } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { atomTime, optionalId, optionalUserIdProperty, requiredId } from '../shared/helpers';

/** Open and Close take a time of their own, and then a reason for the change. */
const timeProperties: INodeProperties[] = [
	{
		displayName: 'Time',
		name: 'time',
		type: 'dateTime',
		default: '',
		description:
			'When it happened, if not now. Open takes a time of the current day only, Close a time of the day the shift started.',
	},
	{
		displayName: 'Reason',
		name: 'report',
		type: 'string',
		default: '',
		description:
			'Why the time differs from the real one. Bitrix24 requires it whenever Time is set and the employee has no flexible schedule.',
	},
];

const placeProperties: INodeProperties[] = [
	{
		displayName: 'Latitude',
		name: 'lat',
		type: 'number',
		default: 0,
		description: 'Where the employee was, for portals that record the place of a shift',
	},
	{
		displayName: 'Longitude',
		name: 'lon',
		type: 'number',
		default: 0,
		description: 'Where the employee was, for portals that record the place of a shift',
	},
];

function shiftParams(
	ctx: Parameters<typeof atomTime>[0],
	itemIndex: number,
	withTime: boolean,
): IDataObject {
	const lat = Number(ctx.getNodeParameter('lat', itemIndex, 0)) || 0;
	const lon = Number(ctx.getNodeParameter('lon', itemIndex, 0)) || 0;
	return compact({
		USER_ID: optionalId(ctx, 'userId', itemIndex),
		TIME: withTime ? atomTime(ctx, ctx.getNodeParameter('time', itemIndex, ''), 'Time', itemIndex) : undefined,
		REPORT: withTime ? ctx.getNodeParameter('report', itemIndex, '') : undefined,
		LAT: lat !== 0 ? lat : undefined,
		LON: lon !== 0 ? lon : undefined,
	});
}

export const workdayResource: Resource = {
	value: 'workday',
	name: 'Working Day',
	description: 'Clocking in and out, breaks, and what the portal expects of a working day',
	operations: [
		{
			value: 'open',
			name: 'Open',
			action: 'Open a working day',
			description:
				'Start the working day of an employee. It shows up in their time report as any other shift would.',
			properties: [optionalUserIdProperty, ...timeProperties, ...placeProperties],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'timeman.open', shiftParams(this, itemIndex, true), { itemIndex });
				return (body.result ?? {}) as IDataObject;
			},
		},
		{
			value: 'close',
			name: 'Close',
			action: 'Close a working day',
			description: 'End the working day of an employee and record how long it lasted',
			properties: [optionalUserIdProperty, ...timeProperties, ...placeProperties],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'timeman.close', shiftParams(this, itemIndex, true), { itemIndex });
				return (body.result ?? {}) as IDataObject;
			},
		},
		{
			value: 'pause',
			name: 'Pause',
			action: 'Pause a working day',
			description: 'Put the working day on a break. Open continues it afterwards.',
			properties: [optionalUserIdProperty],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(
					this,
					'timeman.pause',
					compact({ USER_ID: optionalId(this, 'userId', itemIndex) }),
					{ itemIndex },
				);
				return (body.result ?? {}) as IDataObject;
			},
		},
		{
			value: 'getStatus',
			name: 'Get Status',
			action: 'Get the status of a working day',
			description:
				'Read whether the day is open, paused, closed or expired, since when, and how long the breaks were',
			properties: [optionalUserIdProperty],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(
					this,
					'timeman.status',
					compact({ USER_ID: optionalId(this, 'userId', itemIndex) }),
					{ itemIndex },
				);
				return (body.result ?? {}) as IDataObject;
			},
		},
		{
			value: 'getSettings',
			name: 'Get Settings',
			action: 'Get the working day settings of an employee',
			description:
				'Read whether time tracking is on for the employee, whether the schedule is flexible, and the limits a day has to keep',
			properties: [optionalUserIdProperty],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(
					this,
					'timeman.settings',
					compact({ USER_ID: optionalId(this, 'userId', itemIndex) }),
					{ itemIndex },
				);
				return (body.result ?? {}) as IDataObject;
			},
		},
		{
			value: 'getSchedule',
			name: 'Get Schedule',
			action: 'Get a work schedule',
			description:
				'Retrieve a work schedule by ID: its type, the report period and the devices it allows. The API has no method that lists schedules — the ID comes from the portal, under Employees.',
			properties: [numberProperty('Schedule ID', 'scheduleId', 'ID of the work schedule as the portal shows it')],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(
					this,
					'timeman.schedule.get',
					{ id: requiredId(this, 'scheduleId', itemIndex, 'Schedule ID') },
					{ itemIndex },
				);
				return (body.result ?? {}) as IDataObject;
			},
		},
	],
};
