import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { extractRows } from '../../../shared/list';
import { compact, returnAllProperties } from '../../../shared/params';
import { numberProperty, stringProperty } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { calendarTarget, COMPANY_TYPE, GROUP_TYPE, ownerIdProperty, USER_TYPE } from '../shared/helpers';

/** Only a user or a group owns a calendar that can be created, changed or deleted. */
const ownTypeProperty: INodeProperties = {
	displayName: 'Calendar Type',
	name: 'calendarType',
	type: 'options',
	default: USER_TYPE,
	options: [
		{ name: 'Group', value: GROUP_TYPE, description: 'A calendar of a workgroup or project' },
		{ name: 'User', value: USER_TYPE, description: 'A personal calendar of an employee' },
	],
	description: 'Whose calendar it is. The company calendar cannot be added or removed over REST.',
};

const calendarIdProperty = numberProperty('Calendar ID', 'sectionId', 'ID of the calendar, as Get Many returns it in ID');

const exportProperties: INodeProperties[] = [
	{
		displayName: 'Allow Export',
		name: 'exportAllow',
		type: 'boolean',
		default: false,
		description: 'Whether the calendar can be subscribed to from outside Bitrix24 by an iCal link',
	},
	{
		displayName: 'Export Period',
		name: 'exportPeriod',
		type: 'options',
		default: '3_9',
		displayOptions: { show: { exportAllow: [true] } },
		options: [
			{ name: '3 Months Back, 9 Ahead', value: '3_9' },
			{ name: '6 Months Back, 12 Ahead', value: '6_12' },
			{ name: 'Everything', value: 'all' },
		],
		description: 'How much of the calendar the link gives out',
	},
];

function readExport(ctx: IExecuteFunctions, itemIndex: number): IDataObject | undefined {
	const allow = ctx.getNodeParameter('exportAllow', itemIndex, false) as boolean;
	if (!allow) return undefined;
	return { ALLOW: true, SET: String(ctx.getNodeParameter('exportPeriod', itemIndex, '3_9')) };
}

const lookProperties: INodeProperties[] = [
	{
		displayName: 'Color',
		name: 'color',
		type: 'color',
		default: '',
		description: 'Colour of the events of this calendar in the grid',
	},
	{
		displayName: 'Text Color',
		name: 'textColor',
		type: 'color',
		default: '',
		description: 'Colour of the event titles of this calendar',
	},
];

export const calendarResource: Resource = {
	value: 'calendar',
	name: 'Calendar',
	description: 'The calendars of a user or a workgroup, the grids events are put into',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Create a calendar',
			description:
				'Add a calendar to a user or a workgroup. A webhook made by an ordinary user can only add calendars to itself.',
			properties: [
				ownTypeProperty,
				ownerIdProperty,
				stringProperty('Name', 'name', 'Name of the calendar', true),
				stringProperty('Description', 'description', 'What the calendar is for'),
				...lookProperties,
				...exportProperties,
			],
			async execute(itemIndex) {
				const params: IDataObject = compact({
					...(await calendarTarget(this, itemIndex)),
					name: this.getNodeParameter('name', itemIndex),
					description: this.getNodeParameter('description', itemIndex, ''),
					color: this.getNodeParameter('color', itemIndex, ''),
					text_color: this.getNodeParameter('textColor', itemIndex, ''),
					export: readExport(this, itemIndex),
				});
				const body = await bitrix24Request.call(this, 'calendar.section.add', params, { itemIndex });
				return { id: Number(body.result) };
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a calendar',
			description: 'Rename a calendar, recolour it or change how it is exported',
			properties: [
				ownTypeProperty,
				ownerIdProperty,
				calendarIdProperty,
				stringProperty('Name', 'name', 'New name of the calendar'),
				stringProperty('Description', 'description', 'What the calendar is for'),
				...lookProperties,
				...exportProperties,
			],
			async execute(itemIndex) {
				const params: IDataObject = compact({
					...(await calendarTarget(this, itemIndex)),
					id: this.getNodeParameter('sectionId', itemIndex),
					name: this.getNodeParameter('name', itemIndex, ''),
					description: this.getNodeParameter('description', itemIndex, ''),
					color: this.getNodeParameter('color', itemIndex, ''),
					text_color: this.getNodeParameter('textColor', itemIndex, ''),
					export: readExport(this, itemIndex),
				});
				const body = await bitrix24Request.call(this, 'calendar.section.update', params, { itemIndex });
				return { id: Number(body.result) };
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a calendar',
			description: 'Remove a calendar together with the events kept in it',
			properties: [ownTypeProperty, ownerIdProperty, calendarIdProperty],
			async execute(itemIndex) {
				await bitrix24Request.call(
					this,
					'calendar.section.delete',
					{ ...(await calendarTarget(this, itemIndex)), id: this.getNodeParameter('sectionId', itemIndex) },
					{ itemIndex },
				);
				return undefined;
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many calendars',
			description: 'List the calendars of a user, a workgroup, the company or the meeting rooms',
			properties: [
				{
					displayName: 'Calendar Type',
					name: 'calendarType',
					type: 'options',
					default: USER_TYPE,
					options: [
						{ name: 'Company', value: COMPANY_TYPE, description: 'The calendars everyone on the portal sees' },
						{ name: 'Group', value: GROUP_TYPE, description: 'The calendars of a workgroup or project' },
						{
							name: 'Meeting Room',
							value: 'location',
							description: 'The meeting room calendars, which have owner 0',
						},
						{ name: 'User', value: USER_TYPE, description: 'The calendars of an employee' },
					],
					description: 'Which kind of calendars to list',
				},
				{
					...ownerIdProperty,
					displayOptions: { show: { calendarType: [USER_TYPE, GROUP_TYPE] } },
				},
				...returnAllProperties('calendars'),
			],
			async execute(itemIndex) {
				const type = String(this.getNodeParameter('calendarType', itemIndex));
				const params: IDataObject =
					type === USER_TYPE || type === GROUP_TYPE
						? await calendarTarget(this, itemIndex)
						: { type, ownerId: 0 };

				const body = await bitrix24Request.call(this, 'calendar.section.get', params, { itemIndex });
				const rows = extractRows(body.result);
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				return returnAll ? rows : rows.slice(0, this.getNodeParameter('limit', itemIndex) as number);
			},
		},
	],
};
