import type { IDataObject, INodeProperties } from 'n8n-workflow';

import { listAllV3 } from '../../../shared/list';
import { returnAllProperties } from '../../../shared/params';
import { positiveInt } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import {
	entryFilter,
	entryFilterProperty,
	eventLogDate,
	filterJsonProperty,
	selectEntryProperty,
	selectFields,
	v3Item,
} from '../shared/helpers';

const sortByProperty: INodeProperties = {
	displayName: 'Sort By',
	name: 'sortBy',
	type: 'options',
	default: 'id',
	description: 'Field the entries come back ordered by',
	options: [
		{ name: 'Entry ID', value: 'id' },
		{ name: 'Event Type', value: 'auditTypeId' },
		{ name: 'Guest ID', value: 'guestId' },
		{ name: 'Time', value: 'timestampX' },
		{ name: 'User ID', value: 'userId' },
	],
};

const sortDirectionProperty: INodeProperties = {
	displayName: 'Sort Direction',
	name: 'sortDirection',
	type: 'options',
	default: 'DESC',
	description: 'Whether the newest or the oldest entries come first',
	options: [
		{ name: 'Ascending', value: 'ASC' },
		{ name: 'Descending', value: 'DESC' },
	],
};

export const entryResource: Resource = {
	value: 'entry',
	name: 'Entry',
	description: 'Records of the event log: who signed in, what changed, what the portal refused',
	operations: [
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many event log entries',
			description: 'Read entries of the event log for a period or an event type',
			properties: [
				...returnAllProperties('entries'),
				entryFilterProperty,
				filterJsonProperty,
				sortByProperty,
				sortDirectionProperty,
				selectEntryProperty,
			],
			async execute(itemIndex) {
				const params: IDataObject = {
					order: {
						[String(this.getNodeParameter('sortBy', itemIndex, 'id'))]: String(
							this.getNodeParameter('sortDirection', itemIndex, 'DESC'),
						),
					},
				};

				const filter = entryFilter(this, itemIndex);
				if (filter.length > 0) params.filter = filter;
				const select = selectFields(this, itemIndex);
				if (select !== undefined) params.select = select;

				const returnAll = this.getNodeParameter('returnAll', itemIndex, false) === true;
				const limit = returnAll ? undefined : Number(this.getNodeParameter('limit', itemIndex, 50)) || 50;

				return await listAllV3.call(this, 'main.eventlog.list', params, { limit, itemIndex });
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get an event log entry',
			description: 'Read one entry of the event log by its ID',
			properties: [
				{
					displayName: 'Entry ID',
					name: 'entryId',
					type: 'number',
					required: true,
					default: 0,
					description: 'ID of the log entry, the one Get Many returns',
				},
				selectEntryProperty,
			],
			async execute(itemIndex) {
				const params: IDataObject = { id: positiveInt(this, 'entryId', itemIndex, 'Entry ID') };
				const select = selectFields(this, itemIndex);
				if (select !== undefined) params.select = select;

				const body = await bitrix24Request.call(this, 'main.eventlog.get', params, { v3: true, itemIndex });
				return v3Item(body, 'item');
			},
		},
		{
			value: 'getNew',
			name: 'Get New',
			action: 'Get new event log entries',
			description:
				'Read the entries that appeared after a value the last run kept, for polling the log without re-reading it',
			properties: [
				{
					displayName: 'Cursor Field',
					name: 'cursorField',
					type: 'options',
					default: 'id',
					description: 'Field the cursor counts from. The ID grows with every entry and never repeats.',
					options: [
						{ name: 'Entry ID', value: 'id' },
						{ name: 'Time', value: 'timestampX' },
					],
				},
				{
					displayName: 'After',
					name: 'cursorValue',
					type: 'string',
					default: '0',
					placeholder: '446325',
					description:
						'Value the last run stopped at: the ID of the last entry it saw, or a time as 2026-09-01T00:00:00+03:00. Entries from there on come back.',
				},
				{
					displayName: 'Direction',
					name: 'cursorOrder',
					type: 'options',
					default: 'ASC',
					description: 'Whether to walk forward from the value or back from it',
					options: [
						{ name: 'Ascending', value: 'ASC' },
						{ name: 'Descending', value: 'DESC' },
					],
				},
				{
					displayName: 'Limit',
					name: 'limit',
					type: 'number',
					typeOptions: { minValue: 1 },
					default: 50,
					description: 'Max number of results to return',
				},
				entryFilterProperty,
				filterJsonProperty,
				selectEntryProperty,
			],
			async execute(itemIndex) {
				const field = String(this.getNodeParameter('cursorField', itemIndex, 'id'));
				const raw = String(this.getNodeParameter('cursorValue', itemIndex, '0')).trim();
				const params: IDataObject = {
					cursor: {
						field,
						order: String(this.getNodeParameter('cursorOrder', itemIndex, 'ASC')),
						// A time cursor goes through the same date rule as the filter: the log
						// refuses milliseconds, and a value built in a workflow usually carries them.
						value: field === 'id' ? Number(raw) || 0 : eventLogDate(this, raw, 'After', itemIndex),
						limit: Number(this.getNodeParameter('limit', itemIndex, 50)) || 50,
					},
				};

				const filter = entryFilter(this, itemIndex);
				if (filter.length > 0) params.filter = filter;
				const select = selectFields(this, itemIndex);
				if (select !== undefined) params.select = select;

				const body = await bitrix24Request.call(this, 'main.eventlog.tail', params, { v3: true, itemIndex });
				return v3Item(body, 'items');
			},
		},
	],
};

