import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { listAll } from '../../../shared/list';
import { jsonParameter, returnAllProperties, stringList } from '../../../shared/params';
import { numberProperty, positiveInt, rows } from '../../../shared/props';
import type { Resource } from '../../../shared/spec';
import { bitrix24Request } from '../../../shared/transport';
import { idList, optionalInt, workgroupProperty, yn } from '../shared/helpers';

const group = workgroupProperty('groupId', 'Group Name or ID', 'Workgroup, project or scrum');

function groupId(ctx: IExecuteFunctions, itemIndex: number): number {
	return positiveInt(ctx, 'groupId', itemIndex, 'Group');
}

function groupOptions(forUpdate: boolean): INodeProperties[] {
	const options: INodeProperties[] = [
		{ displayName: 'Archived', name: 'closed', type: 'boolean', default: true, description: 'Whether the group is in the archive' },
		{ displayName: 'Description', name: 'description', type: 'string', typeOptions: { rows: 3 }, default: '' },
		{ displayName: 'Image Drive File ID', name: 'imageFileId', type: 'number', default: 0, description: 'Drive file to use as the group avatar' },
		{ displayName: 'Keywords', name: 'keywords', type: 'string', default: '', description: 'Comma-separated keywords' },
		{ displayName: 'Open to Join', name: 'opened', type: 'boolean', default: false, description: 'Whether anyone may join without an invitation or approval' },
		{ displayName: 'Owner User ID', name: 'ownerId', type: 'number', default: 0, description: 'Only a portal administrator may set another owner; for anyone else the webhook user owns the group' },
		{ displayName: 'Project End', name: 'projectDateFinish', type: 'dateTime', default: '' },
		{ displayName: 'Project Start', name: 'projectDateStart', type: 'dateTime', default: '' },
		{ displayName: 'Visible in List', name: 'visible', type: 'boolean', default: true, description: 'Whether the group shows in the list of groups' },
		{
			displayName: 'Who Can Invite',
			name: 'initiatePerms',
			type: 'options',
			default: 'K',
			options: [
				{ name: 'All Members', value: 'K' },
				{ name: 'Owner and Moderators', value: 'E' },
				{ name: 'Owner Only', value: 'A' },
			],
		},
	];
	if (forUpdate) {
		options.push({ displayName: 'Name', name: 'name', type: 'string', default: '' });
	} else {
		options.push(
			{ displayName: 'Is Project', name: 'project', type: 'boolean', default: true, description: 'Whether to create a project, with start and end dates, rather than a group' },
			{ displayName: 'Scrum Master User ID', name: 'scrumMasterId', type: 'number', default: 0, description: 'By the documentation, a scrum master makes the project a scrum. On the test portal Bitrix24 ignored it and created a collab; there, create scrums in Bitrix24 itself.' },
			{ displayName: 'Subject ID', name: 'subjectId', type: 'number', default: 0, description: 'Group subject (category) set up on the portal' },
		);
	}
	return options.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function groupFields(o: IDataObject): IDataObject {
	const fields: IDataObject = {};
	if (o.name !== undefined && o.name !== '') fields.NAME = o.name as string;
	if (o.description !== undefined) fields.DESCRIPTION = o.description as string;
	if (o.keywords !== undefined) fields.KEYWORDS = o.keywords as string;
	if (o.initiatePerms !== undefined) fields.INITIATE_PERMS = o.initiatePerms as string;
	if (o.projectDateStart) fields.PROJECT_DATE_START = o.projectDateStart as string;
	if (o.projectDateFinish) fields.PROJECT_DATE_FINISH = o.projectDateFinish as string;
	for (const [key, field] of [
		['visible', 'VISIBLE'],
		['opened', 'OPENED'],
		['closed', 'CLOSED'],
		['project', 'PROJECT'],
	] as const) {
		if (o[key] !== undefined) fields[field] = yn(o[key]);
	}
	for (const [key, field] of [
		['ownerId', 'OWNER_ID'],
		['scrumMasterId', 'SCRUM_MASTER_ID'],
		['subjectId', 'SUBJECT_ID'],
		['imageFileId', 'IMAGE_FILE_ID'],
	] as const) {
		if (optionalInt(o[key]) !== undefined) fields[field] = Number(o[key]);
	}
	return fields;
}

const DEFAULT_SELECT = ['ID', 'NAME', 'DESCRIPTION', 'TYPE', 'PROJECT', 'CLOSED', 'OPENED', 'VISIBLE', 'OWNER_ID', 'NUMBER_OF_MEMBERS', 'SCRUM_MASTER_ID', 'PROJECT_DATE_START', 'PROJECT_DATE_FINISH', 'DATE_CREATE', 'DATE_ACTIVITY'];

const EXTRA_DATA = [
	{ name: 'Actions Available to Webhook User', value: 'ACTIONS' },
	{ name: 'Avatar', value: 'AVATAR' },
	{ name: 'Counters', value: 'COUNTERS' },
	{ name: 'Departments', value: 'DEPARTMENTS' },
	{ name: 'Efficiency', value: 'EFFICIENCY' },
	{ name: 'Features', value: 'FEATURES' },
	{ name: 'Members', value: 'LIST_OF_MEMBERS' },
	{ name: 'Members Awaiting Approval', value: 'LIST_OF_MEMBERS_AWAITING_INVITE' },
	{ name: 'Owner', value: 'OWNER_DATA' },
	{ name: 'Role of Webhook User', value: 'USER_DATA' },
	{ name: 'Subject', value: 'SUBJECT_DATA' },
	{ name: 'Tags', value: 'TAGS' },
];

export const workgroupResource: Resource = {
	value: 'workgroup',
	name: 'Workgroup',
	description: 'Workgroups, projects and scrums that tasks live in',
	operations: [
		{
			value: 'create',
			name: 'Create',
			action: 'Create a workgroup',
			description: 'Create a workgroup, project or scrum; the webhook user becomes its owner',
			properties: [
				{ displayName: 'Name', name: 'name', type: 'string', required: true, default: '' },
				{ displayName: 'Additional Fields', name: 'additionalFields', type: 'collection', placeholder: 'Add Field', default: {}, options: groupOptions(false) },
			],
			async execute(itemIndex) {
				const o = { ...((this.getNodeParameter('additionalFields', itemIndex, {}) ?? {}) as IDataObject), name: this.getNodeParameter('name', itemIndex) as string };
				const body = await bitrix24Request.call(this, 'sonet_group.create', groupFields(o), { itemIndex });
				return { id: body.result as number, name: o.name };
			},
		},
		{
			value: 'get',
			name: 'Get',
			action: 'Get a workgroup',
			description: 'Retrieve a workgroup, project or scrum, optionally with its members, owner and features',
			properties: [
				group,
				{ displayName: 'Include', name: 'include', type: 'multiOptions', default: [], options: EXTRA_DATA, description: 'Extra data to read along with the group' },
			],
			async execute(itemIndex) {
				const params: IDataObject = { groupId: groupId(this, itemIndex) };
				const include = this.getNodeParameter('include', itemIndex, []) as string[];
				if (include.length > 0) params.select = include;
				const body = await bitrix24Request.call(this, 'socialnetwork.api.workgroup.get', { params }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get many workgroups',
			description: 'List the workgroups, projects and scrums the webhook user can see',
			properties: [
				...returnAllProperties('workgroups'),
				{
					displayName: 'Filters',
					name: 'filters',
					type: 'collection',
					placeholder: 'Add Filter',
					default: {},
					options: [
						{ displayName: 'Archived', name: 'closed', type: 'boolean', default: false, description: 'Whether to return archived groups (on) or active ones (off)' },
						{ displayName: 'Owner User ID', name: 'ownerId', type: 'number', default: 0 },
						{ displayName: 'Projects Only', name: 'project', type: 'boolean', default: true, description: 'Whether to return only projects (on) or only groups (off)' },
					],
				},
				{ displayName: 'Filter (JSON)', name: 'filterJson', type: 'json', default: '{}', description: 'Extra filter merged over Filters, e.g. {"&gt;DATE_ACTIVITY": "2026-09-01"}' },
				{
					displayName: 'Fields to Return',
					name: 'select',
					type: 'string',
					default: '',
					placeholder: 'ID, NAME, TYPE',
					description: 'Comma-separated fields. Leave empty for ID, name, description, type, flags, owner, member count and dates.',
				},
			],
			async execute(itemIndex) {
				const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
				const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex) as number);
				const f = (this.getNodeParameter('filters', itemIndex, {}) ?? {}) as IDataObject;
				const filter: IDataObject = {};
				if (f.closed !== undefined) filter.CLOSED = yn(f.closed);
				if (f.project !== undefined) filter.PROJECT = yn(f.project);
				if (optionalInt(f.ownerId) !== undefined) filter.OWNER_ID = Number(f.ownerId);
				const select = stringList(this.getNodeParameter('select', itemIndex, ''));
				const params = {
					filter: { ...filter, ...jsonParameter<IDataObject>(this, 'filterJson', itemIndex, {}) },
					select: select.length > 0 ? select : DEFAULT_SELECT,
				};
				return await listAll.call(this, 'socialnetwork.api.workgroup.list', params, { itemsKey: 'workgroups', limit, itemIndex });
			},
		},
		{
			value: 'getMine',
			name: 'Get My Groups',
			action: 'Get the groups of the webhook user',
			description: 'List the groups and projects the webhook user is a member of, with their role in each',
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'sonet_group.user.groups', {}, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'update',
			name: 'Update',
			action: 'Update a workgroup',
			description: 'Change the name, description, flags or dates of a workgroup',
			properties: [group, { displayName: 'Update Fields', name: 'updateFields', type: 'collection', placeholder: 'Add Field', default: {}, options: groupOptions(true) }],
			async execute(itemIndex) {
				const id = groupId(this, itemIndex);
				const fields = groupFields((this.getNodeParameter('updateFields', itemIndex, {}) ?? {}) as IDataObject);
				if (Object.keys(fields).length === 0) throw new NodeOperationError(this.getNode(), 'Nothing to update: add at least one field', { itemIndex });
				await bitrix24Request.call(this, 'sonet_group.update', { GROUP_ID: id, ...fields }, { itemIndex });
				return { id, updated: true };
			},
		},
		{
			value: 'delete',
			name: 'Delete',
			action: 'Delete a workgroup',
			description: 'Delete a workgroup or project',
			properties: [group],
			async execute(itemIndex) {
				const id = groupId(this, itemIndex);
				await bitrix24Request.call(this, 'sonet_group.delete', { GROUP_ID: id }, { itemIndex });
				return { id, deleted: true };
			},
		},
		{
			value: 'setOwner',
			name: 'Set Owner',
			action: 'Change the owner of a workgroup',
			description: 'Make another user the owner of a workgroup',
			properties: [group, numberProperty('User ID', 'userId', 'New owner')],
			async execute(itemIndex) {
				const params = { GROUP_ID: groupId(this, itemIndex), USER_ID: positiveInt(this, 'userId', itemIndex, 'User ID') };
				await bitrix24Request.call(this, 'sonet_group.setowner', params, { itemIndex });
				return { id: params.GROUP_ID, ownerId: params.USER_ID };
			},
		},
		{
			value: 'checkFeatureAccess',
			name: 'Check Feature Access',
			action: 'Check access to a workgroup feature',
			description: 'Answer whether the webhook user may do something in a group, e.g. view all tasks or create tasks',
			properties: [
				group,
				{
					displayName: 'Feature',
					name: 'feature',
					type: 'options',
					default: 'tasks',
					options: [
						{ name: 'Calendar', value: 'calendar' },
						{ name: 'Drive', value: 'files' },
						{ name: 'Feed', value: 'blog' },
						{ name: 'Photos', value: 'photo' },
						{ name: 'Tasks', value: 'tasks' },
					],
				},
				{
					displayName: 'Operation',
					name: 'featureOperation',
					type: 'string',
					required: true,
					default: 'create_tasks',
					description: 'Tasks: view, view_all, sort, create_tasks, edit_tasks, delete_tasks. Calendar, Drive, Photos: view, write. Feed: view_post, write_post, moderate_post, full_post and the same for comment.',
				},
			],
			async execute(itemIndex) {
				const params = { GROUP_ID: groupId(this, itemIndex), FEATURE: this.getNodeParameter('feature', itemIndex) as string, OPERATION: this.getNodeParameter('featureOperation', itemIndex) as string };
				const body = await bitrix24Request.call(this, 'sonet_group.feature.access', params, { itemIndex });
				return { groupId: params.GROUP_ID, feature: params.FEATURE, operation: params.OPERATION, allowed: body.result === true };
			},
		},
	],
};

const userIds: INodeProperties = { displayName: 'User IDs', name: 'userIds', type: 'string', required: true, default: '', placeholder: '12, 34', description: 'Comma-separated user IDs' };

function members(ctx: IExecuteFunctions, itemIndex: number): { GROUP_ID: number; USER_ID: number[] } {
	const ids = idList(ctx, ctx.getNodeParameter('userIds', itemIndex), 'User IDs', itemIndex);
	if (ids.length === 0) throw new NodeOperationError(ctx.getNode(), 'User IDs: give at least one user', { itemIndex });
	return { GROUP_ID: groupId(ctx, itemIndex), USER_ID: ids };
}

function affected(result: unknown, groupIdValue: number): IDataObject[] {
	return (Array.isArray(result) ? result : []).map((id) => ({ groupId: groupIdValue, userId: Number(id) }));
}

export const workgroupMemberResource: Resource = {
	value: 'workgroupMember',
	name: 'Workgroup Member',
	description: 'Who is in a workgroup and with what role',
	operations: [
		{
			value: 'add',
			name: 'Add',
			action: 'Add users to a workgroup',
			description: 'Add users to a group straight away, without an invitation; returns the users actually added',
			properties: [group, userIds],
			async execute(itemIndex) {
				const params = members(this, itemIndex);
				const body = await bitrix24Request.call(this, 'sonet_group.user.add', params, { itemIndex });
				return affected(body.result, params.GROUP_ID);
			},
		},
		{
			value: 'invite',
			name: 'Invite',
			action: 'Invite users to a workgroup',
			description: 'Send users an invitation they have to accept',
			properties: [group, userIds, { displayName: 'Message', name: 'message', type: 'string', typeOptions: { rows: 3 }, default: '' }],
			async execute(itemIndex) {
				const params: IDataObject = { ...members(this, itemIndex) };
				const message = this.getNodeParameter('message', itemIndex, '') as string;
				if (message !== '') params.MESSAGE = message;
				const body = await bitrix24Request.call(this, 'sonet_group.user.invite', params, { itemIndex });
				return affected(body.result, params.GROUP_ID as number);
			},
		},
		{
			value: 'requestToJoin',
			name: 'Request to Join',
			action: 'Ask to join a workgroup',
			description: 'Send a request from the webhook user to join a group. Refused when the webhook user is already a member.',
			properties: [group, { displayName: 'Message', name: 'message', type: 'string', typeOptions: { rows: 3 }, default: '' }],
			async execute(itemIndex) {
				const params: IDataObject = { GROUP_ID: groupId(this, itemIndex) };
				// A request from a member, the owner included, takes that member out of the group and
				// answers true (seen on a live portal, 14.09.2026). Refuse it for members.
				const mine = await bitrix24Request.call(this, 'sonet_group.user.groups', {}, { itemIndex });
				const membership = (Array.isArray(mine.result) ? (mine.result as IDataObject[]) : []).find((g) => Number(g.GROUP_ID) === params.GROUP_ID);
				if (membership !== undefined) {
					throw new NodeOperationError(this.getNode(), `The webhook user is already in group ${params.GROUP_ID as number} (role ${String(membership.ROLE)})`, {
						itemIndex,
						description: 'Bitrix24 would take the user out of the group instead of adding a request.',
					});
				}
				const message = this.getNodeParameter('message', itemIndex, '') as string;
				if (message !== '') params.MESSAGE = message;
				const body = await bitrix24Request.call(this, 'sonet_group.user.request', params, { itemIndex });
				return { groupId: params.GROUP_ID, requested: body.result === true };
			},
		},
		{
			value: 'getMany',
			name: 'Get Many',
			action: 'Get the members of a workgroup',
			description: 'List the active members of a group with their roles: A owner, E moderator, K member',
			properties: [group],
			async execute(itemIndex) {
				const body = await bitrix24Request.call(this, 'sonet_group.user.get', { ID: groupId(this, itemIndex) }, { itemIndex });
				return rows(body.result);
			},
		},
		{
			value: 'setRole',
			name: 'Set Role',
			action: 'Change the role of workgroup members',
			description: 'Make members moderators or plain members; the owner role is changed by Workgroup → Set Owner',
			properties: [
				group,
				userIds,
				{
					displayName: 'Role',
					name: 'role',
					type: 'options',
					default: 'E',
					options: [
						{ name: 'Member', value: 'K' },
						{ name: 'Moderator', value: 'E' },
					],
				},
			],
			async execute(itemIndex) {
				const params = { ...members(this, itemIndex), ROLE: this.getNodeParameter('role', itemIndex) as string };
				const body = await bitrix24Request.call(this, 'sonet_group.user.update', params, { itemIndex });
				return affected(body.result, params.GROUP_ID).map((row) => ({ ...row, role: params.ROLE }));
			},
		},
		{
			value: 'remove',
			name: 'Remove',
			action: 'Remove users from a workgroup',
			description: 'Remove members from a group. The owner is refused: change the owner with Workgroup → Set Owner first.',
			properties: [group, userIds],
			async execute(itemIndex) {
				const params = members(this, itemIndex);
				// A group that loses its owner from the member list breaks: tasks.task.add in it answered
				// a PHP error on a live portal (14.09.2026). Never let Remove be the way that happens.
				const current = await bitrix24Request.call(this, 'sonet_group.user.get', { ID: params.GROUP_ID }, { itemIndex });
				const owners = (Array.isArray(current.result) ? (current.result as IDataObject[]) : []).filter((m) => m.ROLE === 'A').map((m) => Number(m.USER_ID));
				const refused = params.USER_ID.filter((id) => owners.includes(id));
				if (refused.length > 0) {
					throw new NodeOperationError(this.getNode(), `User ${refused.join(', ')} owns group ${params.GROUP_ID} and is not removed`, {
						itemIndex,
						description: 'Make someone else the owner with Workgroup → Set Owner, then remove the former owner.',
					});
				}
				const body = await bitrix24Request.call(this, 'sonet_group.user.delete', params, { itemIndex });
				return affected(body.result, params.GROUP_ID);
			},
		},
	],
};
