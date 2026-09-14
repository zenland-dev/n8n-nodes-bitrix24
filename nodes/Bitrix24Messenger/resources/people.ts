import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { returnAllProperties } from '../../../shared/params';
import { rows } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { idList, optionalInt, yn } from '../../../shared/values';
import { dialogIdProperty, offsetList, readDialogId, valuesOf } from '../shared/helpers';

function searchText(ctx: IExecuteFunctions, itemIndex: number): string {
	const find = String(ctx.getNodeParameter('find', itemIndex) ?? '').trim();
	if (find.length < 2) throw new NodeOperationError(ctx.getNode(), 'Search Text needs at least 2 characters', { itemIndex });
	return find;
}

const findProperty: INodeProperties = { displayName: 'Search Text', name: 'find', type: 'string', required: true, default: '', description: 'At least 2 characters' };

function limitOf(ctx: IExecuteFunctions, itemIndex: number): number | undefined {
	return (ctx.getNodeParameter('returnAll', itemIndex) as boolean) ? undefined : (ctx.getNodeParameter('limit', itemIndex) as number);
}

const STATUS_OPTIONS = [
	{ name: 'Away', value: 'away' },
	{ name: 'Do Not Disturb', value: 'dnd', description: 'Notifications are silenced' },
	{ name: 'On a Break', value: 'break' },
	{ name: 'Online', value: 'online' },
];

export const userResource: Resource = {
	value: 'user',
	name: 'User',
	description: 'Users as the messenger sees them: profiles, status, colleagues, unread counters',
	operations: [
		{
			value: 'get',
			name: 'Get',
			action: 'Get a user',
			description: 'Retrieve the messenger profile of a user: name, position, departments, last activity, absence',
			properties: [{ displayName: 'User ID', name: 'userId', type: 'number', default: 0, description: 'Leave 0 for the webhook user' }],
			async execute(itemIndex) {
				const id = optionalInt(this.getNodeParameter('userId', itemIndex, 0));
				const body = await bitrix24Request.call(this, 'im.user.get', id === undefined ? {} : { ID: id }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get users by ID',
			description: 'Retrieve the messenger profiles of several users in one request',
			properties: [{ displayName: 'User IDs', name: 'userIds', type: 'string', required: true, default: '', placeholder: '1, 7', description: 'Comma-separated user IDs' }],
			async execute(itemIndex) {
				const ids = idList(this, this.getNodeParameter('userIds', itemIndex), 'User IDs', itemIndex);
				if (ids.length === 0) throw new NodeOperationError(this.getNode(), 'User IDs: give at least one user', { itemIndex });
				const body = await bitrix24Request.call(this, 'im.user.list.get', { ID: ids, RESULT_TYPE: 'array' }, { itemIndex });
				return valuesOf(body.result);
			},
		},
		{
			value: 'search',
			name: 'Search',
			action: 'Search users',
			description: 'Find users by name, position or department',
			properties: [
				findProperty,
				{ displayName: 'Employees Only', name: 'business', type: 'boolean', default: false, description: 'Whether to search only among business users, leaving out extranet and others' },
				...returnAllProperties('users'),
			],
			async execute(itemIndex) {
				const params: IDataObject = { FIND: searchText(this, itemIndex) };
				if (this.getNodeParameter('business', itemIndex, false) === true) params.BUSINESS = 'Y';
				return await offsetList.call(this, 'im.search.user.list', params, { pageSize: 50, limit: limitOf(this, itemIndex), itemIndex });
			},
		},
		{
			value: 'getColleagues',
			name: 'Get Colleagues',
			action: 'Get the colleagues of the webhook user',
			description: 'List the colleagues of the webhook user; for a head of department, subordinates and superiors',
			properties: [...returnAllProperties('colleagues'), { displayName: 'IDs Only', name: 'idsOnly', type: 'boolean', default: false, description: 'Whether to return only user IDs instead of profiles' }],
			async execute(itemIndex) {
				const idsOnly = this.getNodeParameter('idsOnly', itemIndex, false) === true;
				const found = await offsetList.call(this, 'im.department.colleagues.list', { USER_DATA: yn(!idsOnly) }, { pageSize: 50, limit: limitOf(this, itemIndex), itemIndex });
				return idsOnly ? found.map((row) => ({ userId: Number(row.value) })) : found;
			},
		},
		{
			value: 'getStatus',
			name: 'Get Status',
			action: 'Get the status of the webhook user',
			description: 'Read the status the webhook user has set: online, do not disturb, away or on a break',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'im.user.status.get', {}, { itemIndex });
				return { status: body.result === false ? null : (body.result as string) };
			},
		},
		{
			value: 'setStatus',
			name: 'Set Status',
			action: 'Set the status of the webhook user',
			description: 'Set the status of the webhook user. The new messenger shows only Online; the others silence or mark the user all the same.',
			properties: [{ displayName: 'Status', name: 'status', type: 'options', default: 'online', options: STATUS_OPTIONS }],
			async execute(itemIndex) {
				const status = this.getNodeParameter('status', itemIndex) as string;
				await bitrix24Request.call(this, 'im.user.status.set', { STATUS: status }, { itemIndex });
				return { status };
			},
		},
		{
			value: 'setAway',
			name: 'Set Away',
			action: 'Mark the webhook user as away',
			description: 'Turn on the automatic "away" state of the webhook user, as if idle for some minutes',
			properties: [{ displayName: 'Minutes Ago', name: 'ago', type: 'number', typeOptions: { minValue: 1 }, default: 10, description: 'How long ago the user went idle' }],
			async execute(itemIndex) {
				const ago = optionalInt(this.getNodeParameter('ago', itemIndex, 10)) ?? 10;
				await bitrix24Request.call(this, 'im.user.status.idle.start', { AGO: ago }, { itemIndex });
				return { away: true, minutesAgo: ago };
			},
		},
		{
			value: 'clearAway',
			name: 'Clear Away',
			action: 'Clear the away state of the webhook user',
			description: 'Turn off the automatic "away" state of the webhook user',
			async execute(itemIndex) {
				await bitrix24Request.call(this, 'im.user.status.idle.end', {}, { itemIndex });
				return { away: false };
			},
		},
		{
			value: 'getCounters',
			name: 'Get Unread Counters',
			action: 'Get unread counters of the webhook user',
			description: 'Count the unread messages and notifications of the webhook user, in total and per chat',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'im.counters.get', {}, { itemIndex });
				return rows(body.result);
			},
		},
	],
};

const departmentIdsProperty: INodeProperties = { displayName: 'Department IDs', name: 'departmentIds', type: 'string', required: true, default: '', placeholder: '1, 3', description: 'Comma-separated department IDs' };

function departmentIds(ctx: IExecuteFunctions, itemIndex: number): number[] {
	const ids = idList(ctx, ctx.getNodeParameter('departmentIds', itemIndex), 'Department IDs', itemIndex);
	if (ids.length === 0) throw new NodeOperationError(ctx.getNode(), 'Department IDs: give at least one department', { itemIndex });
	return ids;
}

/** `{"3": [users], "7": [users]}` into one row per person with the department on it. */
function perDepartment(result: unknown, idsOnly: boolean): IDataObject[] {
	const out: IDataObject[] = [];
	for (const [departmentId, people] of Object.entries((result ?? {}) as IDataObject)) {
		for (const person of Array.isArray(people) ? people : []) {
			if (idsOnly || person === null || typeof person !== 'object') out.push({ departmentId: Number(departmentId), userId: Number(person) });
			else out.push({ departmentId: Number(departmentId), ...(person as IDataObject) });
		}
	}
	return out;
}

const idsOnlyProperty: INodeProperties = { displayName: 'IDs Only', name: 'idsOnly', type: 'boolean', default: false, description: 'Whether to return only user IDs instead of profiles' };

export const departmentResource: Resource = {
	value: 'department',
	name: 'Department',
	description: 'Departments of the company structure, with their heads and employees',
	operations: [
		{
			value: 'get',
			name: 'Get',
			action: 'Get departments',
			description: 'Retrieve departments by ID with their full names and heads',
			properties: [departmentIdsProperty, { displayName: 'Include Head Profile', name: 'userData', type: 'boolean', default: false, description: 'Whether to add the profile of the head of each department' }],
			async execute(itemIndex) {
				const params = { ID: departmentIds(this, itemIndex), USER_DATA: yn(this.getNodeParameter('userData', itemIndex, false)) };
				const body = await bitrix24Request.call(this, 'im.department.get', params, { itemIndex });
				return valuesOf(body.result);
			},
		},
		{
			value: 'getEmployees',
			name: 'Get Employees',
			action: 'Get the employees of departments',
			description: 'List the employees of departments, one item per person with the department ID on it',
			properties: [departmentIdsProperty, idsOnlyProperty],
			async execute(itemIndex) {
				const idsOnly = this.getNodeParameter('idsOnly', itemIndex, false) === true;
				const body = await bitrix24Request.call(this, 'im.department.employees.get', { ID: departmentIds(this, itemIndex), USER_DATA: yn(!idsOnly) }, { itemIndex });
				return perDepartment(body.result, idsOnly);
			},
		},
		{
			value: 'getHeads',
			name: 'Get Heads',
			action: 'Get the heads of departments',
			description: 'List the heads of departments, one item per person with the department ID on it',
			properties: [departmentIdsProperty, idsOnlyProperty],
			async execute(itemIndex) {
				const idsOnly = this.getNodeParameter('idsOnly', itemIndex, false) === true;
				const body = await bitrix24Request.call(this, 'im.department.managers.get', { ID: departmentIds(this, itemIndex), USER_DATA: yn(!idsOnly) }, { itemIndex });
				return perDepartment(body.result, idsOnly);
			},
		},
		{
			value: 'search',
			name: 'Search',
			action: 'Search departments',
			description: 'Find departments whose full name has a word starting with the text',
			properties: [findProperty, { displayName: 'Include Head Profile', name: 'userData', type: 'boolean', default: false, description: 'Whether to add the profile of the head of each department' }, ...returnAllProperties('departments')],
			async execute(itemIndex) {
				const params = { FIND: searchText(this, itemIndex), USER_DATA: yn(this.getNodeParameter('userData', itemIndex, false)) };
				return await offsetList.call(this, 'im.search.department.list', params, { pageSize: 50, limit: limitOf(this, itemIndex), itemIndex });
			},
		},
	],
};

export const searchHistoryResource: Resource = {
	value: 'searchHistory',
	name: 'Search History',
	description: 'The "recent search" list of the webhook user in the messenger search box',
	operations: [
		{
			value: 'add',
			name: 'Add',
			action: 'Add a conversation to the search history',
			description: 'Put a chat or user at the top of the recent search list of the webhook user',
			properties: [dialogIdProperty()],
			async execute(itemIndex) {
				const dialogId = readDialogId(this, itemIndex);
				await bitrix24Request.call(this, 'im.search.last.add', { DIALOG_ID: dialogId }, { itemIndex });
				return { dialogId, added: true };
			},
		},
		{
			value: 'remove',
			name: 'Remove',
			action: 'Remove a conversation from the search history',
			description: 'Take a chat or user out of the recent search list of the webhook user',
			properties: [dialogIdProperty()],
			async execute(itemIndex) {
				const dialogId = readDialogId(this, itemIndex);
				await bitrix24Request.call(this, 'im.search.last.delete', { DIALOG_ID: dialogId }, { itemIndex });
				return { dialogId, removed: true };
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get the search history',
			description: 'List the chats and users in the recent search list of the webhook user',
			properties: [
				{
					displayName: 'Filters',
					name: 'filters',
					type: 'collection',
					placeholder: 'Add Filter',
					default: {},
					options: [
						{ displayName: 'Skip Group Chats', name: 'skipChat', type: 'boolean', default: true },
						{ displayName: 'Skip Open Channels', name: 'skipOpenLines', type: 'boolean', default: true },
						{ displayName: 'Skip Private Dialogs', name: 'skipDialog', type: 'boolean', default: true },
					],
				},
			],
			async execute(itemIndex) {
				const f = (this.getNodeParameter('filters', itemIndex, {}) ?? {}) as IDataObject;
				const params: IDataObject = {};
				if (f.skipChat !== undefined) params.SKIP_CHAT = yn(f.skipChat);
				if (f.skipDialog !== undefined) params.SKIP_DIALOG = yn(f.skipDialog);
				if (f.skipOpenLines !== undefined) params.SKIP_OPENLINES = yn(f.skipOpenLines);
				const body = await bitrix24Request.call(this, 'im.search.last.get', params, { itemIndex });
				return valuesOf(body.result);
			},
		},
	],
};
